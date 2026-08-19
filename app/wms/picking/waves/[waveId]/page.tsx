"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { resolveGroup, type PickingGroup } from "@/lib/wms/picking-wave/grouping";
import { proposeShortageAllocation, sumFulfilledQuantity } from "@/lib/wms/picking-wave/allocate";
import { buildBasketDisplayNames } from "@/lib/wms/picking-wave/basket-display";
import type { PickingWave, PickingWaveItem, PickingAllocationResult } from "@/lib/wms/picking-wave/types";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsWarnButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
import { cleanDisplayProductName } from "@/lib/wms/display-name";
import ProductInfoEditSheet from "./ProductInfoEditSheet";

interface SectionGroup {
  sectionId: string;
  sectionLabel: string;
  groups: { group: PickingGroup; items: PickingWaveItem[] }[];
}

/** 섹션(카테고리) → 그룹(모델) → 아이템 순서로 정렬해 구성한다. 컴포넌트 상태와 분리된 순수 함수로
 *  둬서, 자동 다음 그룹 이동 시 stale한 useMemo 결과 대신 최신 items로 바로 계산할 수 있게 한다. */
function buildSections(items: PickingWaveItem[]): SectionGroup[] {
  const sorted = [...items].sort((a, b) => resolveGroup(a).sortKey.localeCompare(resolveGroup(b).sortKey));
  const sectionOrder: string[] = [];
  const sectionMap = new Map<string, SectionGroup>();

  for (const item of sorted) {
    const group = resolveGroup(item);
    let section = sectionMap.get(group.sectionId);
    if (!section) {
      section = { sectionId: group.sectionId, sectionLabel: group.sectionLabel, groups: [] };
      sectionMap.set(group.sectionId, section);
      sectionOrder.push(group.sectionId);
    }
    let bucket = section.groups.find(g => g.group.groupId === group.groupId);
    if (!bucket) {
      bucket = { group, items: [] };
      section.groups.push(bucket);
    }
    bucket.items.push(item);
  }

  return sectionOrder.map(id => sectionMap.get(id)!);
}

/**
 * 통합 피킹 실행 화면. 카테고리(섹션) → 모델(그룹) → SKU 1개씩 순서로 진행한다
 * (창고 위치가 생기면 lib/wms/picking-wave/grouping.ts의 모드만 바뀌고 이 화면은 그대로 쓴다).
 */
export default function WmsPickingWaveDetailPage({ params }: { params: { waveId: string } }) {
  const router = useRouter();
  const waveRepository = usePickingWaveRepository();

  const [wave, setWave] = useState<PickingWave | null>(null);
  const [items, setItems] = useState<PickingWaveItem[]>([]);
  const [basketDisplayNames, setBasketDisplayNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedProductCode, setSelectedProductCode] = useState<string | null>(null);

  const [showPartialInput, setShowPartialInput] = useState(false);
  const [partialTotalValue, setPartialTotalValue] = useState("");
  const [allocationDraft, setAllocationDraft] = useState<PickingAllocationResult[] | null>(null);
  const [showProductInfoSheet, setShowProductInfoSheet] = useState(false);

  async function reload() {
    const [loadedWave, loadedItems, loadedBaskets] = await Promise.all([
      waveRepository.getWave(params.waveId),
      waveRepository.listItems(params.waveId),
      waveRepository.listBaskets(params.waveId),
    ]);
    if (!loadedWave) {
      setLoadError("해당 통합 피킹 작업을 찾을 수 없습니다.");
      setLoading(false);
      return;
    }
    setWave(loadedWave);
    setItems(loadedItems);
    setBasketDisplayNames(buildBasketDisplayNames(loadedBaskets));
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.waveId]);

  // 섹션(카테고리) → 그룹(모델) → 아이템 순서로 정렬해 구성한다.
  const sections: SectionGroup[] = useMemo(() => buildSections(items), [items]);

  const allGroups = useMemo(() => sections.flatMap(section => section.groups), [sections]);
  const totalGroups = allGroups.length;
  const doneGroupCount = wave ? allGroups.filter(g => wave.completedGroupIds.includes(g.group.groupId)).length : 0;

  const selectedBucket = allGroups.find(g => g.group.groupId === selectedGroupId);
  const selectedItem = selectedBucket?.items.find(item => item.productCode === selectedProductCode) ?? null;

  async function persistItem(item: PickingWaveItem, patch: Partial<PickingWaveItem>) {
    const updated: PickingWaveItem = { ...item, ...patch, updatedAt: new Date().toISOString() };
    await waveRepository.saveItem(updated);
    const nextItems = items.map(existing => (existing.id === updated.id ? updated : existing));
    setItems(nextItems);
    await afterDecision(updated, nextItems);
  }

  async function afterDecision(updated: PickingWaveItem, nextItems: PickingWaveItem[]) {
    if (!wave) return;
    const group = resolveGroup(updated);
    const groupItems = nextItems.filter(item => resolveGroup(item).groupId === group.groupId);
    const nextPending = groupItems.find(item => item.status === "pending");

    if (nextPending) {
      setSelectedProductCode(nextPending.productCode);
      return;
    }

    // 그룹 내 모든 아이템 처리 완료 — 중간 확인화면 없이 바로 다음 그룹으로 이동한다
    // (2026-08-19 사용자 확정: 전량찾음 등 한 번의 클릭으로 다음 그룹까지 자동 진행).
    setSelectedProductCode(null);
    if (wave.completedGroupIds.includes(group.groupId)) return;

    const nextCompletedGroupIds = [...wave.completedGroupIds, group.groupId];
    const allGroupsNow = buildSections(nextItems).flatMap(section => section.groups);
    const nextGroup = allGroupsNow.find(g => !nextCompletedGroupIds.includes(g.group.groupId));

    if (nextGroup) {
      const updatedWave: PickingWave = { ...wave, completedGroupIds: nextCompletedGroupIds, updatedAt: new Date().toISOString() };
      await waveRepository.saveWave(updatedWave);
      setWave(updatedWave);
      setSelectedGroupId(nextGroup.group.groupId);
      setSelectedProductCode(nextGroup.items.length === 1 ? nextGroup.items[0].productCode : null);
      return;
    }

    // 마지막 그룹까지 전부 완료 — 웨이브 전체 완료 처리 후 완료 화면으로 이동
    const completedWave: PickingWave = {
      ...wave,
      completedGroupIds: nextCompletedGroupIds,
      status: "completed",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await waveRepository.saveWave(completedWave);
    setWave(completedWave);
    router.push(`/wms/picking/waves/${wave.id}/complete`);
  }

  function handleFull(item: PickingWaveItem) {
    const allocations: PickingAllocationResult[] = item.sources.map(source => ({
      purchaseOrderNumber: source.purchaseOrderNumber,
      basketNumber: source.basketNumber,
      requestedQuantity: source.requestedQuantity,
      fulfilledQuantity: source.requestedQuantity,
      shortageQuantity: 0,
    }));
    void persistItem(item, { status: "full", pickedQuantity: item.totalQuantity, shortageQuantity: 0, allocations });
  }

  function handleNotFound(item: PickingWaveItem) {
    const allocations: PickingAllocationResult[] = item.sources.map(source => ({
      purchaseOrderNumber: source.purchaseOrderNumber,
      basketNumber: source.basketNumber,
      requestedQuantity: source.requestedQuantity,
      fulfilledQuantity: 0,
      shortageQuantity: source.requestedQuantity,
    }));
    void persistItem(item, { status: "notfound", pickedQuantity: 0, shortageQuantity: item.totalQuantity, allocations });
  }

  /** ProductInfoEditSheet에서 저장이 끝난 뒤 호출된다 — 이 화면의 아이템 상태에도 반영하고,
   *  제품DB 재조회로 실제로 반영됐는지 확인한다 (2026-08-19 사용자 확정 절차). */
  async function handleProductInfoSaved(item: PickingWaveItem, patch: Partial<PickingWaveItem>) {
    const updatedItem: PickingWaveItem = { ...item, ...patch, updatedAt: new Date().toISOString() };
    await waveRepository.saveItem(updatedItem);
    setItems(prev => prev.map(existing => (existing.id === updatedItem.id ? updatedItem : existing)));
    setShowProductInfoSheet(false);

    try {
      const verifyRes = await fetch("/api/wms/product-catalog", { cache: "no-store" });
      const verifyData = await verifyRes.json();
      const verifiedItem = (verifyData.items || []).find((catalogItem: { skuId: string }) => catalogItem.skuId === item.productCode);
      const matches = verifiedItem && (verifiedItem.productName || "") === (updatedItem.productName || "");
      if (!matches) {
        window.alert("저장은 됐지만, 제품DB 재조회 결과가 방금 저장한 값과 다릅니다. 새로고침 후 다시 확인해주세요.");
      }
    } catch {
      // 확인 조회 실패는 저장 자체의 실패가 아니므로 조용히 넘어간다.
    }
  }

  function startPartial() {
    setShowPartialInput(true);
    setPartialTotalValue("");
  }

  function confirmPartialTotal(item: PickingWaveItem) {
    const pickedTotal = Math.max(0, Math.min(item.totalQuantity, Number(partialTotalValue) || 0));
    setAllocationDraft(proposeShortageAllocation(item.sources, pickedTotal));
    setShowPartialInput(false);
  }

  function updateAllocationDraftRow(index: number, fulfilledQuantity: number) {
    setAllocationDraft(prev => {
      if (!prev) return prev;
      const next = [...prev];
      const row = next[index];
      const clamped = Math.max(0, Math.min(row.requestedQuantity, fulfilledQuantity));
      next[index] = { ...row, fulfilledQuantity: clamped, shortageQuantity: row.requestedQuantity - clamped };
      return next;
    });
  }

  function confirmPartialAllocation(item: PickingWaveItem) {
    if (!allocationDraft) return;
    const pickedTotal = sumFulfilledQuantity(allocationDraft);
    void persistItem(item, {
      status: "partial",
      pickedQuantity: pickedTotal,
      shortageQuantity: item.totalQuantity - pickedTotal,
      allocations: allocationDraft,
    });
    setAllocationDraft(null);
    setPartialTotalValue("");
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <p style={{ color: wmsColors.muted }}>불러오는 중...</p>
      </main>
    );
  }

  if (loadError || !wave) {
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: "18px" }}>통합 피킹</h1>
        <p style={{ color: "#c0392b" }}>{loadError}</p>
        <a href="/wms/picking/waves" style={{ color: wmsColors.green, fontWeight: 700 }}>
          목록으로
        </a>
      </main>
    );
  }

  // 화면: 섹션 → 그룹 목록
  if (!selectedBucket) {
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: "18px", margin: "0 0 2px" }}>통합 피킹</h1>
        <p style={{ color: wmsColors.muted, fontSize: "13px", margin: "0 0 4px" }}>
          {wave.id} · 발주서 {wave.sourcePurchaseOrderNumbers.length}건
        </p>
        <p style={{ color: wmsColors.green, fontSize: "13px", fontWeight: 700, margin: "0 0 16px" }}>
          전체 그룹 진행률 {doneGroupCount} / {totalGroups}
        </p>

        {sections.map(section => (
          <div key={section.sectionId} style={{ marginBottom: "20px" }}>
            <h2 style={{ fontSize: "13px", color: wmsColors.muted, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {section.sectionLabel}
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {section.groups.map(({ group, items: groupItems }) => {
                const done = groupItems.filter(item => item.status !== "pending").length;
                const total = groupItems.length;
                const isDone = wave.completedGroupIds.includes(group.groupId);
                return (
                  <button
                    key={group.groupId}
                    onClick={() => {
                      setSelectedGroupId(group.groupId);
                      setSelectedProductCode(groupItems.length === 1 ? groupItems[0].productCode : null);
                    }}
                    style={{
                      ...wmsSecondaryButton,
                      minHeight: "64px",
                      width: "100%",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 16px",
                      background: isDone ? wmsColors.greenSoft : "#ffffff",
                      border: isDone ? `2px solid ${wmsColors.green}` : `1px solid ${wmsColors.border}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                      <ItemThumbnail imageUrl={groupItems[0]?.imageUrl} size={40} />
                      <span style={{ fontWeight: 800, fontSize: "16px", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {group.groupLabel}
                      </span>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: "15px", flexShrink: 0 }}>
                      {done} / {total}
                      {isDone && <span style={{ marginLeft: "6px", color: wmsColors.greenDark }}>완료</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </main>
    );
  }

  // 화면: 선택한 그룹의 아이템(SKU) 목록
  if (!selectedItem) {
    const doneInGroup = selectedBucket.items.filter(item => item.status !== "pending").length;
    return (
      <main style={pageStyle}>
        <button onClick={() => setSelectedGroupId(null)} style={{ ...wmsGhostButton, marginBottom: "12px" }}>
          ← 그룹 목록으로
        </button>
        <div style={{ textAlign: "center", margin: "8px 0 4px" }}>
          <div style={{ fontSize: "26px", fontWeight: 900 }}>{selectedBucket.group.groupLabel}</div>
          <div style={{ fontSize: "13px", color: wmsColors.muted }}>{selectedBucket.group.sectionLabel}</div>
        </div>
        <p style={{ textAlign: "center", color: wmsColors.green, fontWeight: 700, fontSize: "14px", margin: "8px 0 16px" }}>
          이 그룹 {doneInGroup} / {selectedBucket.items.length}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {selectedBucket.items.map(item => {
            const isDone = item.status !== "pending";
            return (
              <button
                key={item.productCode}
                onClick={() => setSelectedProductCode(item.productCode)}
                style={{
                  ...wmsSecondaryButton,
                  height: "auto",
                  minHeight: "60px",
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  textAlign: "left",
                  background: isDone ? wmsColors.greenSoft : "#ffffff",
                  border: isDone ? `2px solid ${wmsColors.green}` : `1px solid ${wmsColors.border}`,
                }}
              >
                <ItemThumbnail imageUrl={item.imageUrl} size={44} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "13px", whiteSpace: "normal", wordBreak: "keep-all", lineHeight: 1.3 }}>
                    {cleanDisplayProductName(item.productName)}
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: wmsColors.greenDark }}>{item.optionLabel || "옵션 없음"}</div>
                  <div style={{ fontSize: "10px", color: wmsColors.muted }}>SKU {item.productCode}</div>
                </div>
                <div style={{ fontSize: "13px", fontWeight: 700, flexShrink: 0 }}>
                  {item.pickedQuantity} / {item.totalQuantity}개
                  {isDone && <div style={{ fontSize: "10px", color: wmsColors.greenDark, textAlign: "right" }}>완료</div>}
                </div>
              </button>
            );
          })}
        </div>
      </main>
    );
  }

  // 화면: 부족 배분 확인 (부분찾음)
  if (allocationDraft) {
    const sum = sumFulfilledQuantity(allocationDraft);
    const pickedTotal = Math.max(0, Math.min(selectedItem.totalQuantity, Number(partialTotalValue) || sum));
    const matches = sum === pickedTotal;

    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: "16px", margin: "0 0 4px" }}>부족 배분 확인</h1>
        <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 12px" }}>
          {selectedItem.productName} · 찾은 수량 {pickedTotal}개 — 발주서/바구니별 배정수량을 확인하거나 직접 고쳐주세요.
        </p>
        <div style={{ overflowX: "auto", marginBottom: "12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: `1px solid ${wmsColors.border}` }}>
                <th>물류센터(발주서)</th>
                <th>요청수량</th>
                <th>배정수량</th>
                <th>부족수량</th>
              </tr>
            </thead>
            <tbody>
              {allocationDraft.map((row, index) => (
                <tr key={row.purchaseOrderNumber} style={{ borderBottom: "1px solid #eee" }}>
                  <td>
                    {basketDisplayNames[row.basketNumber] || `바구니 ${row.basketNumber}`}
                    <span style={{ color: wmsColors.muted, fontSize: "11px" }}> (발주서 {row.purchaseOrderNumber})</span>
                  </td>
                  <td>{row.requestedQuantity}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={row.requestedQuantity}
                      value={row.fulfilledQuantity}
                      onChange={event => updateAllocationDraftRow(index, Number(event.target.value) || 0)}
                      style={{ width: "56px", textAlign: "center" }}
                    />
                  </td>
                  <td style={{ color: row.shortageQuantity > 0 ? wmsColors.warn : wmsColors.ink, fontWeight: 700 }}>
                    {row.shortageQuantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: "13px", fontWeight: 700, color: matches ? wmsColors.greenDark : wmsColors.warn, marginBottom: "12px" }}>
          배정수량 합계 {sum} / 실제 찾은 수량 {pickedTotal} {matches ? "일치" : "— 합계를 맞춰주세요"}
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={() => setAllocationDraft(null)} style={{ ...wmsGhostButton, flex: 1 }}>
            취소
          </button>
          <button
            onClick={() => confirmPartialAllocation(selectedItem)}
            disabled={!matches}
            style={{ ...wmsPrimaryButton, flex: 2, opacity: matches ? 1 : 0.5 }}
          >
            확인
          </button>
        </div>
      </main>
    );
  }

  // 화면: 아이템(SKU) 상세 — 스크롤 없이 한 화면 안에서 버튼까지 보이도록 구성
  // (2026-08-19 사용자 확정). 위치/거래처/창고번호 등 상세 정보는 "상품 정보 수정" 시트로 이동.
  return (
    <main style={{ ...pageStyle, display: "flex", flexDirection: "column", height: "100vh", paddingBottom: "12px" }}>
      <button onClick={() => setSelectedProductCode(null)} style={{ ...wmsGhostButton, marginBottom: "8px", flexShrink: 0 }}>
        ← 그룹 안 목록으로
      </button>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <button
          onClick={() => setShowProductInfoSheet(true)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "center" }}
        >
          {selectedItem.imageUrl ? (
            <img
              src={selectedItem.imageUrl}
              alt={selectedItem.productName}
              style={{ borderRadius: "12px", width: "100%", maxWidth: "180px", maxHeight: "34vh", height: "auto", objectFit: "cover", margin: "0 auto" }}
            />
          ) : (
            <div
              style={{
                width: "140px",
                height: "140px",
                margin: "0 auto",
                borderRadius: "12px",
                background: wmsColors.surfaceBeige,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: wmsColors.muted,
                fontSize: "12px",
              }}
            >
              이미지 없음
            </div>
          )}
        </button>

        <button
          onClick={() => setShowProductInfoSheet(true)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "center", width: "100%" }}
        >
          <h2 style={{ margin: "10px 0 2px", fontSize: "16px", color: wmsColors.ink }}>{cleanDisplayProductName(selectedItem.productName)}</h2>
          <p style={{ margin: "0 0 2px", color: wmsColors.greenDark, fontSize: "13px", fontWeight: 700 }}>
            옵션 {selectedItem.optionLabel || "옵션 없음"}
          </p>
          <p style={{ margin: 0, color: wmsColors.muted, fontSize: "12px" }}>SKU {selectedItem.productCode}</p>
        </button>

        <div style={{ display: "flex", justifyContent: "center", gap: "16px", margin: "10px 0" }}>
          <InfoTile label="총 찾을 수량" value={selectedItem.totalQuantity} />
        </div>

        <div style={{ marginBottom: "8px", textAlign: "left" }}>
          <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "2px" }}>발주서/물류센터별 분배 수량</div>
          {selectedItem.sources.map(source => (
            <div key={source.purchaseOrderNumber} style={{ fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
              <span>
                {basketDisplayNames[source.basketNumber] || `바구니 ${source.basketNumber}`}
                <span style={{ color: wmsColors.muted, fontSize: "10px" }}> (발주서 {source.purchaseOrderNumber})</span>
              </span>
              <span style={{ fontWeight: 700 }}>{source.requestedQuantity}개</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flexShrink: 0, paddingTop: "8px" }}>
        {!showPartialInput ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button onClick={() => handleFull(selectedItem)} style={{ ...wmsPrimaryButton, width: "100%" }}>
              전량찾음
            </button>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => startPartial()} style={{ ...wmsSecondaryButton, flex: 1 }}>
                부분찾음
              </button>
              <button onClick={() => handleNotFound(selectedItem)} style={{ ...wmsWarnButton, flex: 1 }}>
                못 찾음
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <input
              type="number"
              min={0}
              max={selectedItem.totalQuantity}
              value={partialTotalValue}
              onChange={event => setPartialTotalValue(event.target.value)}
              placeholder="찾은 총수량"
              autoFocus
              style={{ width: "100%", minHeight: "48px", fontSize: "17px", textAlign: "center", borderRadius: "10px", border: `1px solid ${wmsColors.borderStrong}` }}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setShowPartialInput(false)} style={{ ...wmsGhostButton, flex: 1 }}>
                취소
              </button>
              <button onClick={() => confirmPartialTotal(selectedItem)} style={{ ...wmsPrimaryButton, flex: 2 }}>
                다음 (배분 확인)
              </button>
            </div>
          </div>
        )}
      </div>

      {showProductInfoSheet && (
        <ProductInfoEditSheet
          item={selectedItem}
          onClose={() => setShowProductInfoSheet(false)}
          onSaved={patch => handleProductInfoSaved(selectedItem, patch)}
        />
      )}
    </main>
  );
}

const pageStyle: CSSProperties = {
  maxWidth: WMS_MOBILE_WIDTH,
  margin: "0 auto",
  padding: "16px",
  fontFamily: "sans-serif",
  background: wmsColors.background,
  color: wmsColors.ink,
  minHeight: "100vh",
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: "10px",
};

function ItemThumbnail({ imageUrl, size }: { imageUrl?: string; size: number }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: `${size}px`, height: `${size}px`, borderRadius: "8px", objectFit: "cover", flexShrink: 0, background: wmsColors.surfaceBeige }}
      />
    );
  }
  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "8px",
        background: wmsColors.surfaceBeige,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: wmsColors.muted,
        fontSize: "9px",
        textAlign: "center",
        flexShrink: 0,
      }}
    >
      이미지
      <br />
      없음
    </div>
  );
}

function SummaryTile({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{ background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "14px", textAlign: "center" }}>
      <div style={{ fontSize: "22px", fontWeight: 800, color: highlight ? wmsColors.warn : wmsColors.ink }}>{value}</div>
      <div style={{ fontSize: "12px", color: wmsColors.muted, marginTop: "2px" }}>{label}</div>
    </div>
  );
}

function InfoTile({ label, value, highlight, muted }: { label: string; value: string | number; highlight?: boolean; muted?: boolean }) {
  return (
    <div style={{ background: wmsColors.surfaceBeige, borderRadius: "10px", padding: "10px" }}>
      <div style={{ color: wmsColors.muted, fontSize: "11px" }}>{label}</div>
      <div style={{ fontSize: muted ? "12px" : "17px", fontWeight: muted ? 500 : 800, color: muted ? wmsColors.muted : highlight ? wmsColors.warn : wmsColors.ink }}>
        {value}
      </div>
    </div>
  );
}
