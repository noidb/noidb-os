"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { usePickingWaveRepository, useStockLevelProvider } from "@/lib/wms/picking-wave/context";
import { resolveGroup, groupCompleteLabel, type PickingGroup } from "@/lib/wms/picking-wave/grouping";
import { proposeShortageAllocation, sumFulfilledQuantity } from "@/lib/wms/picking-wave/allocate";
import type { PickingWave, PickingWaveItem, PickingAllocationResult } from "@/lib/wms/picking-wave/types";
import type { StockLevelResult } from "@/lib/wms/picking-wave/stock-level";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsWarnButton, wmsGhostButton } from "@/lib/wms/ui-tokens";

interface SectionGroup {
  sectionId: string;
  sectionLabel: string;
  groups: { group: PickingGroup; items: PickingWaveItem[] }[];
}

/**
 * 통합 피킹 실행 화면. 카테고리(섹션) → 모델(그룹) → SKU 1개씩 순서로 진행한다
 * (창고 위치가 생기면 lib/wms/picking-wave/grouping.ts의 모드만 바뀌고 이 화면은 그대로 쓴다).
 */
export default function WmsPickingWaveDetailPage({ params }: { params: { waveId: string } }) {
  const router = useRouter();
  const waveRepository = usePickingWaveRepository();
  const stockLevelProvider = useStockLevelProvider();

  const [wave, setWave] = useState<PickingWave | null>(null);
  const [items, setItems] = useState<PickingWaveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedProductCode, setSelectedProductCode] = useState<string | null>(null);
  const [pendingGroupComplete, setPendingGroupComplete] = useState<PickingGroup | null>(null);

  const [showPartialInput, setShowPartialInput] = useState(false);
  const [partialTotalValue, setPartialTotalValue] = useState("");
  const [allocationDraft, setAllocationDraft] = useState<PickingAllocationResult[] | null>(null);
  const [detailProduct, setDetailProduct] = useState<PickingWaveItem | null>(null);
  const [stockByProductCode, setStockByProductCode] = useState<Record<string, StockLevelResult>>({});

  async function reload() {
    const [loadedWave, loadedItems] = await Promise.all([
      waveRepository.getWave(params.waveId),
      waveRepository.listItems(params.waveId),
    ]);
    if (!loadedWave) {
      setLoadError("해당 통합 피킹 작업을 찾을 수 없습니다.");
      setLoading(false);
      return;
    }
    setWave(loadedWave);
    setItems(loadedItems);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.waveId]);

  // 섹션(카테고리) → 그룹(모델) → 아이템 순서로 정렬해 구성한다.
  const sections: SectionGroup[] = useMemo(() => {
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
  }, [items]);

  const allGroups = useMemo(() => sections.flatMap(section => section.groups), [sections]);
  const totalGroups = allGroups.length;
  const doneGroupCount = wave ? allGroups.filter(g => wave.completedGroupIds.includes(g.group.groupId)).length : 0;

  const selectedBucket = allGroups.find(g => g.group.groupId === selectedGroupId);
  const selectedItem = selectedBucket?.items.find(item => item.productCode === selectedProductCode) ?? null;

  useEffect(() => {
    if (!selectedItem) return;
    if (stockByProductCode[selectedItem.productCode]) return;
    stockLevelProvider.getStock(selectedItem.productCode).then(result => {
      setStockByProductCode(prev => ({ ...prev, [selectedItem.productCode]: result }));
    });
  }, [selectedItem, stockLevelProvider, stockByProductCode]);

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

    // 그룹 내 모든 아이템 처리 완료
    setSelectedProductCode(null);
    if (wave.completedGroupIds.includes(group.groupId)) return;

    const updatedWave: PickingWave = {
      ...wave,
      completedGroupIds: [...wave.completedGroupIds, group.groupId],
      updatedAt: new Date().toISOString(),
    };
    await waveRepository.saveWave(updatedWave);
    setWave(updatedWave);
    setPendingGroupComplete(group);
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

  async function handleGroupCompleteNext() {
    if (!pendingGroupComplete || !wave) return;
    setPendingGroupComplete(null);

    const nextGroup = allGroups.find(g => !wave.completedGroupIds.includes(g.group.groupId));
    if (nextGroup) {
      setSelectedGroupId(nextGroup.group.groupId);
      setSelectedProductCode(nextGroup.items.length === 1 ? nextGroup.items[0].productCode : null);
      return;
    }

    // 전체 완료
    const completedWave: PickingWave = { ...wave, status: "completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await waveRepository.saveWave(completedWave);
    router.push(`/wms/picking/waves/${wave.id}/complete`);
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

  // 화면: 그룹 완료 확인
  if (pendingGroupComplete) {
    const groupItems = allGroups.find(g => g.group.groupId === pendingGroupComplete.groupId)?.items ?? [];
    const found = groupItems.reduce((sum, item) => sum + item.pickedQuantity, 0);
    const shortage = groupItems.reduce((sum, item) => sum + item.shortageQuantity, 0);
    const hasNextGroup = allGroups.some(g => !wave.completedGroupIds.includes(g.group.groupId));

    return (
      <main style={pageStyle}>
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ fontSize: "40px" }}>📦</div>
          <h1 style={{ fontSize: "20px", margin: "8px 0" }}>
            {groupCompleteLabel(pendingGroupComplete.groupKind)} — {pendingGroupComplete.groupLabel}
          </h1>
          <p style={{ color: wmsColors.muted, margin: 0 }}>
            전체 그룹 진행률 {doneGroupCount} / {totalGroups}
          </p>
        </div>
        <div style={summaryGridStyle}>
          <SummaryTile label="찾은 수량" value={found} />
          <SummaryTile label="부족 수량" value={shortage} highlight={shortage > 0} />
        </div>
        <button onClick={handleGroupCompleteNext} style={{ ...wmsPrimaryButton, width: "100%", marginTop: "20px" }}>
          {hasNextGroup ? "다음 그룹으로 이동" : "전체 완료 화면 보기"}
        </button>
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
                      padding: "12px 16px",
                      background: isDone ? wmsColors.greenSoft : "#ffffff",
                      border: isDone ? `2px solid ${wmsColors.green}` : `1px solid ${wmsColors.border}`,
                    }}
                  >
                    <span style={{ fontWeight: 800, fontSize: "16px", textAlign: "left" }}>{group.groupLabel}</span>
                    <span style={{ fontWeight: 700, fontSize: "15px" }}>
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
                  padding: "10px 12px",
                  textAlign: "left",
                  background: isDone ? wmsColors.greenSoft : "#ffffff",
                  border: isDone ? `2px solid ${wmsColors.green}` : `1px solid ${wmsColors.border}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.productName}
                  </div>
                  <div style={{ fontSize: "11px", color: wmsColors.muted }}>{item.productCode}</div>
                </div>
                <div style={{ fontSize: "13px", fontWeight: 700 }}>{isDone ? "완료" : `${item.totalQuantity}개`}</div>
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
                <th>발주서/바구니</th>
                <th>요청수량</th>
                <th>배정수량</th>
                <th>부족수량</th>
              </tr>
            </thead>
            <tbody>
              {allocationDraft.map((row, index) => (
                <tr key={row.purchaseOrderNumber} style={{ borderBottom: "1px solid #eee" }}>
                  <td>
                    {row.purchaseOrderNumber} / 바구니 {row.basketNumber}
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

  // 화면: 아이템(SKU) 상세
  const stock = stockByProductCode[selectedItem.productCode];
  return (
    <main style={pageStyle}>
      <button onClick={() => setSelectedProductCode(null)} style={{ ...wmsGhostButton, marginBottom: "10px" }}>
        ← 그룹 안 목록으로
      </button>

      <div style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "16px", padding: "16px", textAlign: "center" }}>
        {selectedItem.imageUrl ? (
          <img
            src={selectedItem.imageUrl}
            alt={selectedItem.productName}
            style={{ borderRadius: "12px", width: "100%", maxWidth: "220px", height: "auto", margin: "0 auto" }}
          />
        ) : (
          <div
            style={{
              width: "160px",
              height: "160px",
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

        <h2 style={{ margin: "12px 0 2px", fontSize: "17px" }}>{selectedItem.modelName || selectedItem.productName}</h2>
        <p style={{ margin: "0 0 2px", color: wmsColors.muted, fontSize: "13px" }}>{selectedItem.productName}</p>
        <p style={{ margin: "0 0 4px", color: wmsColors.muted, fontSize: "12px" }}>
          SKU {selectedItem.productCode} · 바코드 {selectedItem.barcode || "-"}
        </p>
        <button
          onClick={() => setDetailProduct(selectedItem)}
          style={{ background: "none", border: "none", color: wmsColors.green, fontWeight: 700, fontSize: "13px", padding: 0, cursor: "pointer" }}
        >
          상품보기 →
        </button>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px", margin: "16px 0", fontSize: "13px" }}>
          <InfoTile label="총 찾을 수량" value={selectedItem.totalQuantity} />
          <InfoTile
            label={selectedBucket.group.groupKind === "box" ? "현재 BOX" : "현재 그룹(모델)"}
            value={selectedBucket.group.groupLabel}
          />
          <InfoTile
            label="현재고"
            value={stock ? (stock.status === "available" ? String(stock.quantity) : "미확인 · 재고 연동 전") : "조회 중..."}
            muted={!stock || stock.status === "unavailable"}
          />
          <InfoTile label="위치 미등록 여부" value={selectedItem.locationStatus === "unlocated" ? "예" : "아니오"} />
        </div>

        <div style={{ marginBottom: "16px", textAlign: "left" }}>
          <div style={{ fontSize: "12px", color: wmsColors.muted, marginBottom: "4px" }}>발주서/바구니별 분배 수량</div>
          {selectedItem.sources.map(source => (
            <div key={source.purchaseOrderNumber} style={{ fontSize: "13px", display: "flex", justifyContent: "space-between" }}>
              <span>
                발주서 {source.purchaseOrderNumber} / 바구니 {source.basketNumber}
              </span>
              <span style={{ fontWeight: 700 }}>{source.requestedQuantity}개</span>
            </div>
          ))}
        </div>

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

      {detailProduct && (
        <div
          onClick={() => setDetailProduct(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(37,37,37,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "20px" }}
        >
          <div onClick={event => event.stopPropagation()} style={{ background: "#fff", borderRadius: "14px", padding: "24px", textAlign: "center", maxWidth: "320px" }}>
            {detailProduct.imageUrl && <img src={detailProduct.imageUrl} alt={detailProduct.productName} width={200} style={{ borderRadius: "10px" }} />}
            <h3 style={{ margin: "12px 0 4px" }}>{detailProduct.productName}</h3>
            <p style={{ margin: "0 0 4px", color: wmsColors.muted }}>SKU: {detailProduct.productCode}</p>
            <p style={{ margin: "0 0 12px", color: wmsColors.muted }}>바코드: {detailProduct.barcode || "-"}</p>
            <button onClick={() => setDetailProduct(null)} style={{ ...wmsSecondaryButton, marginTop: "8px" }}>
              닫기
            </button>
          </div>
        </div>
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
