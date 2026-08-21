"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import { recalculateAutoVendorOrderLines } from "@/lib/wms/vendor-order/recalculate";
import {
  MANUAL_VENDOR_WORKSPACE_ID,
  UNASSIGNED_VENDOR_NAME,
  VENDOR_ORDER_STATUS_LABEL,
  type VendorOrderDraft,
  type VendorOrderDraftLine,
  type VendorOrderDraftStatus,
} from "@/lib/wms/vendor-order/types";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { fetchLiveCatalogLookup, type LiveCatalogLookup } from "@/lib/wms/picking-wave/live-catalog";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton, wmsSlateDarkButton, wmsWarnButton, wmsOuterCard } from "@/lib/wms/ui-tokens";
import { resolveDisplayNameAndOption } from "@/lib/wms/display-name";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import Barcode from "./Barcode";
import VendorOrderExportPanel from "./ExportPanel";
import ProductSearchAddSheet from "./ProductSearchAddSheet";
import WmsExitNav from "../../WmsExitNav";
import ImageEditSheet from "../ImageEditSheet";
import { CameraIcon, ExternalLinkIcon } from "../../../../icons";

/**
 * 거래처별 부족분 발주서(초안) 화면. 완료된 통합 피킹(웨이브)의 부족 수량을 제품DB "거래처" 기준으로
 * 자동 그룹핑해 보여주고, 수량 수정·행 삭제·새 상품 추가·거래처 변경·메모 입력·임시저장·승인을
 * 지원한다. 이 화면은 자동으로 아무것도 발송하지 않는다 — 승인은 항상 사용자가 직접 누른다.
 */
export default function VendorOrdersPage({ params }: { params: { waveId: string } }) {
  const waveRepository = usePickingWaveRepository();
  const vendorOrderRepository = useVendorOrderRepository();

  /** 웨이브 없이 만든 수동 거래처 발주서 전용 가상 작업공간인지 (2026-08-19 4차 실사용 테스트 신규
   *  — 거래처 발주관리 허브의 "웨이브 없이 새로 만들기"에서 진입). 이 경우 실제 PickingWave가
   *  없어도 이 화면을 그대로 재사용한다(새 화면을 따로 만들지 않음). */
  const isManualWorkspace = params.waveId === MANUAL_VENDOR_WORKSPACE_ID;

  const [rawWave, setWave] = useState<PickingWave | null>(null);
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<VendorOrderDraftLine[]>([]);
  const [draftsByVendor, setDraftsByVendor] = useState<Record<string, VendorOrderDraft>>({});
  const [removedLineIds, setRemovedLineIds] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchAddVendor, setSearchAddVendor] = useState<string | null>(null);
  const [manualVendorNames, setManualVendorNames] = useState<string[]>([]);
  const [isPreview, setIsPreview] = useState(false);
  const [addingManualVendor, setAddingManualVendor] = useState(false);
  const [newVendorNameInput, setNewVendorNameInput] = useState("");
  const [liveCatalogByProductCode, setLiveCatalogByProductCode] = useState<LiveCatalogLookup>(new Map());

  /** 제품링크는 발주서 라인에 저장하지 않고 항상 제품DB에서 SKU 기준으로 최신값을 읽는다 —
   *  기존 웨이브/라인은 이 필드가 생기기 전에 만들어졌을 수 있어, 저장된 스냅샷 대신 실시간
   *  조회를 쓰면 예전 데이터에서도 바로 동작한다 (2026-08-19 5차 실사용 테스트 신규). */
  async function refreshLiveCatalog() {
    setLiveCatalogByProductCode(await fetchLiveCatalogLookup());
  }

  useEffect(() => {
    (async () => {
      try {
        const [loadedWave, waveItems, existingDrafts, existingLines] = await Promise.all([
          isManualWorkspace ? Promise.resolve(null) : waveRepository.getWave(params.waveId),
          isManualWorkspace ? Promise.resolve([]) : waveRepository.listItems(params.waveId),
          vendorOrderRepository.listDrafts(params.waveId),
          vendorOrderRepository.listLines(params.waveId),
        ]);
        setWave(loadedWave);
        setDraftsByVendor(Object.fromEntries(existingDrafts.map(draft => [draft.vendorName, draft])));

        const now = new Date().toISOString();
        if (isManualWorkspace) {
          // 웨이브가 없으므로 재계산할 부족분 자체가 없다 — 저장된 수동 라인만 그대로 보여준다.
          setLines(existingLines);
          setIsPreview(false);
        } else if (loadedWave && loadedWave.status !== "in_progress") {
          // 방문할 때마다 최신 부족수량으로 자동 라인만 다시 계산한다 — 수동 추가 라인은 절대 안 건드림
          // (2026-08-19 사용자 확정 — 웨이브를 수정한 뒤 다시 열면 부족분 목록이 항상 최신 상태여야 함).
          const recalculated = recalculateAutoVendorOrderLines(params.waveId, waveItems, existingLines, now);
          await Promise.all(recalculated.removedLineIds.map(id => vendorOrderRepository.deleteLine(id)));
          await Promise.all(recalculated.lines.map(line => vendorOrderRepository.saveLine(line)));
          setLines(recalculated.lines);
          setIsPreview(false);
        } else if (loadedWave) {
          // 아직 피킹 진행중인 웨이브 — 저장하지 않고 지금까지의 부족수량만 미리보기로 계산한다
          // (2026-08-19 신규: "진행 중 웨이브 화면 → 부족분 거래처 발주서 확인" 진입 경로).
          const preview = recalculateAutoVendorOrderLines(params.waveId, waveItems, existingLines, now);
          setLines(preview.lines);
          setIsPreview(true);
        }
      } finally {
        setLoading(false);
      }
    })();
    // 제품DB(구글시트) 조회는 로컬 데이터 로딩과 분리한다 — 느려지거나 실패해도 화면 진입을
    // 막지 않는다(2026-08-19 4차 실사용 테스트에서 확인된 무한로딩 버그와 같은 실수를 반복하지 않기 위함).
    refreshLiveCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.waveId]);

  const groups = useMemo(() => {
    const map = new Map<string, VendorOrderDraftLine[]>();
    for (const line of lines) {
      const vendor = line.vendorName || UNASSIGNED_VENDOR_NAME;
      const list = map.get(vendor) || [];
      list.push(line);
      map.set(vendor, list);
    }
    // 상품 없이 "발주서 수동 추가"로 막 만든 거래처도 빈 그룹으로 보여준다 (2026-08-19 신규).
    for (const vendorName of manualVendorNames) {
      if (!map.has(vendorName)) map.set(vendorName, []);
    }
    return Array.from(map.entries())
      .map(([vendorName, groupLines]) => ({ vendorName, lines: groupLines }))
      .sort((a, b) => (a.vendorName === UNASSIGNED_VENDOR_NAME ? 1 : b.vendorName === UNASSIGNED_VENDOR_NAME ? -1 : a.vendorName.localeCompare(b.vendorName)));
  }, [lines, manualVendorNames]);

  // 거래처 입력 자동완성 후보 — 이미 이 발주서에 존재하는 실제 거래처명만 쓴다(새 값을 임의로 만들지 않음).
  const knownVendorNames = useMemo(
    () => Array.from(new Set(groups.map(g => g.vendorName).filter(name => name && name !== UNASSIGNED_VENDOR_NAME))),
    [groups]
  );

  const lowStockByVendor = useMemo(() => {
    const existingSkuIds = new Set(lines.map(line => line.skuId));
    const unique = new Map<string, ProductCatalogItem>();
    for (const item of liveCatalogByProductCode.values()) {
      if (item.skuId) unique.set(item.skuId, item);
    }
    const result = new Map<string, ProductCatalogItem[]>();
    for (const item of unique.values()) {
      if (!item || existingSkuIds.has(item.skuId)) continue;
      const stockText = String(item.currentStock ?? "").trim();
      if (!stockText) continue;
      const stock = Number(stockText);
      if (!Number.isFinite(stock) || stock < 0 || stock > 1) continue;
      if (!item.vendorName || item.currentStatus === "단종" || item.currentStatus === "과재고") continue;
      const list = result.get(item.vendorName) || [];
      list.push(item);
      result.set(item.vendorName, list);
    }
    return result;
  }, [lines, liveCatalogByProductCode]);

  function statusOf(vendorName: string): VendorOrderDraftStatus {
    return draftsByVendor[vendorName]?.status ?? "draft";
  }

  function updateLine(id: string, patch: Partial<VendorOrderDraftLine>) {
    setLines(prev => prev.map(line => (line.id === id ? { ...line, ...patch, updatedAt: new Date().toISOString() } : line)));
    setDirty(true);
  }

  function removeLine(line: VendorOrderDraftLine) {
    const message = line.isManuallyAdded
      ? `"${line.productName || line.skuId}"를 삭제할까요?`
      : `"${line.productName || line.skuId}"는 자동 계산된 부족분 상품입니다. 삭제할까요? (다음에 웨이브 수정으로 이 SKU가 다시 부족해지면 자동으로 다시 추가될 수 있습니다)`;
    if (!window.confirm(message)) return;
    setLines(prev => prev.filter(existing => existing.id !== line.id));
    setRemovedLineIds(prev => new Set(prev).add(line.id));
    setDirty(true);
  }

  function addProductFromSearch(
    vendorName: string,
    product: { skuId: string; modelName: string; category: string; productName: string; optionLabel: string; imageUrl: string; barcode: string; currentStock: string }
  ) {
    const now = new Date().toISOString();
    const newLine: VendorOrderDraftLine = {
      id: `${params.waveId}::${vendorName}::manual-${Date.now()}`,
      draftId: `${params.waveId}::${vendorName}`,
      waveId: params.waveId,
      vendorName,
      skuId: product.skuId,
      modelName: product.modelName,
      category: product.category || "",
      optionLabel: product.optionLabel,
      productName: product.productName,
      imageUrl: product.imageUrl,
      barcode: product.barcode,
      actualShortageQuantity: 0,
      shortageQuantity: 12,
      currentStock: product.currentStock,
      relatedPurchaseOrderNumbers: [],
      memo: "",
      isManuallyAdded: true,
      createdAt: now,
      updatedAt: now,
    };
    setLines(prev => [...prev, newLine]);
    setSearchAddVendor(null);
    setDirty(true);
  }

  function addLowStockProduct(vendorName: string, product: ProductCatalogItem) {
    addProductFromSearch(vendorName, {
      skuId: product.skuId,
      modelName: product.modelName,
      category: product.category,
      productName: product.productName,
      optionLabel: product.optionLabel,
      imageUrl: product.imageUrl,
      barcode: product.barcode,
      currentStock: product.currentStock,
    });
    const newIdPrefix = `${params.waveId}::${vendorName}::manual-`;
    setLines(prev => prev.map(line => line.id.startsWith(newIdPrefix) && line.skuId === product.skuId
      ? { ...line, memo: "저재고 추가발주", actualShortageQuantity: 0, shortageQuantity: 12 }
      : line));
  }

  function createManualVendorOrder() {
    const name = newVendorNameInput.trim();
    if (!name) return;
    setManualVendorNames(prev => (prev.includes(name) ? prev : [...prev, name]));
    setNewVendorNameInput("");
    setAddingManualVendor(false);
  }

  function stepQuantity(line: VendorOrderDraftLine, delta: number) {
    updateLine(line.id, { shortageQuantity: Math.max(0, line.shortageQuantity + delta) });
  }

  /** 라인들을 저장(임시저장)한다 — draftId를 현재 vendorName 기준으로 다시 맞추고, 삭제된 라인을 반영한다. */
  async function persistAll(overrideStatus?: { vendorName: string; status: VendorOrderDraftStatus }) {
    setSaving(true);
    const now = new Date().toISOString();

    for (const id of removedLineIds) {
      await vendorOrderRepository.deleteLine(id);
    }
    setRemovedLineIds(new Set());

    const vendorNames = new Set(lines.map(line => line.vendorName || UNASSIGNED_VENDOR_NAME));
    if (overrideStatus) vendorNames.add(overrideStatus.vendorName);

    const nextDraftsByVendor = { ...draftsByVendor };
    for (const vendorName of vendorNames) {
      const existing = nextDraftsByVendor[vendorName];
      const isOverride = overrideStatus?.vendorName === vendorName;
      const draft: VendorOrderDraft = existing
        ? {
            ...existing,
            status: isOverride ? overrideStatus!.status : existing.status,
            updatedAt: now,
            approvedAt: isOverride && overrideStatus!.status === "approved" ? now : existing.approvedAt,
            sentAt: isOverride && overrideStatus!.status === "sent" ? now : existing.sentAt,
          }
        : {
            id: `${params.waveId}::${vendorName}`,
            waveId: params.waveId,
            vendorName,
            status: isOverride ? overrideStatus!.status : "draft",
            createdAt: now,
            updatedAt: now,
            approvedAt: isOverride && overrideStatus!.status === "approved" ? now : undefined,
            sentAt: isOverride && overrideStatus!.status === "sent" ? now : undefined,
          };
      nextDraftsByVendor[vendorName] = draft;
      await vendorOrderRepository.saveDraft(draft);
    }
    setDraftsByVendor(nextDraftsByVendor);

    const linesToSave = lines.map(line => ({
      ...line,
      vendorName: line.vendorName || UNASSIGNED_VENDOR_NAME,
      draftId: `${params.waveId}::${line.vendorName || UNASSIGNED_VENDOR_NAME}`,
    }));
    await Promise.all(linesToSave.map(line => vendorOrderRepository.saveLine(line)));
    setLines(linesToSave);

    setDirty(false);
    setSaving(false);
  }

  async function handleApprove(vendorName: string) {
    await persistAll({ vendorName, status: "approved" });
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <p style={{ color: wmsColors.muted }}>불러오는 중...</p>
      </main>
    );
  }

  if (!rawWave && !isManualWorkspace) {
    return (
      <main style={pageStyle}>
        <WmsExitNav />
        <h1 style={{ fontSize: "18px" }}>거래처별 부족분 발주서</h1>
        <p style={{ color: "#c0392b", fontWeight: 700 }}>웨이브 정보를 찾을 수 없습니다.</p>
      </main>
    );
  }

  // 웨이브 없이 만든 수동 거래처 발주서 화면에서는 실제 PickingWave가 없으므로, 화면 표시에만 쓰는
  // 가상 웨이브 객체로 대신한다(저장소에는 어디에도 쓰지 않음 — 표시 전용 로컬 상수).
  const wave: PickingWave =
    rawWave ??
    {
      id: MANUAL_VENDOR_WORKSPACE_ID,
      status: "completed",
      sourcePurchaseOrderNumbers: [],
      completedGroupIds: [],
      productDbConfigured: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

  return (
    <main style={pageStyle}>
      <WmsExitNav />
      <h1 style={{ fontSize: "20px", margin: "0 0 4px" }}>{isManualWorkspace ? "수동 거래처 발주서" : "거래처별 부족분 발주서"}</h1>
      <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 16px" }}>
        {isManualWorkspace
          ? '웨이브 없이 수동으로 만든 거래처 발주서입니다. "+ 발주서 수동 추가"와 "상품 검색 추가"로 상품을 넣어주세요.'
          : `${wave.id} · 부족 수량을 제품DB "거래처" 기준으로 자동 분리했습니다. 거래처 정보가 없는 SKU는 "${UNASSIGNED_VENDOR_NAME}"로 별도 표시됩니다. 자동 발송은 없으며, 승인은 직접 눌러야 합니다.`}
      </p>

      {isPreview && (
        <p style={{ fontSize: "12px", color: wmsColors.warn, background: wmsColors.warnSoft, borderRadius: "8px", padding: "8px 10px", marginBottom: "14px" }}>
          이 웨이브는 아직 피킹 진행중입니다 — 지금까지 처리한 SKU 기준 미리보기이며, 저장되지 않습니다.
          피킹을 완료하면 정식으로 저장·수정할 수 있습니다.
        </p>
      )}

      {!isPreview && (!addingManualVendor ? (
        <button onClick={() => setAddingManualVendor(true)} style={{ ...wmsGhostButton, width: "100%", marginBottom: "14px" }}>
          + 발주서 수동 추가
        </button>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "14px", width: "100%" }}>
          <input
            autoFocus
            className="wms-input"
            value={newVendorNameInput}
            onChange={e => setNewVendorNameInput(e.target.value)}
            placeholder="거래처명 입력 (기존 거래처명도 가능)"
            style={{ ...inputStyle, flex: "1 1 140px", minWidth: 0, boxSizing: "border-box", fontSize: "16px", padding: "8px 10px" }}
          />
          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
            <button onClick={createManualVendorOrder} style={{ ...wmsPrimaryButton, minHeight: "36px", fontSize: "12px", flexShrink: 0 }}>
              만들기
            </button>
            <button onClick={() => setAddingManualVendor(false)} style={{ ...wmsGhostButton, minHeight: "36px", fontSize: "12px", flexShrink: 0 }}>
              취소
            </button>
          </div>
        </div>
      ))}

      {groups.length === 0 ? (
        <p style={{ fontSize: "13px", color: wmsColors.muted, whiteSpace: "pre-line" }}>
          {"현재 자동 생성된 부족분이 없습니다.\n위 [발주서 수동 추가]로 새 거래처 발주서를 만들 수 있습니다."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "20px" }}>
          {groups.map(group => {
            const status = statusOf(group.vendorName);
            const editable = !isPreview && (status === "draft" || status === "review" || status === "resend_needed");
            const totalOrderQuantity = group.lines.reduce((sum, l) => sum + l.shortageQuantity, 0);
            const totalActualShortage = group.lines.reduce((sum, l) => sum + (l.actualShortageQuantity ?? l.shortageQuantity), 0);
            const lowStockProducts = lowStockByVendor.get(group.vendorName) || [];

            return (
              <div key={group.vendorName} style={cardStyle}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
                  <h2 style={{ margin: 0, fontSize: "17px", minWidth: 0, overflowWrap: "anywhere" }}>
                    {group.vendorName}
                    <span style={{ marginLeft: "8px", fontSize: "12px", color: wmsColors.muted, fontWeight: 400 }}>
                      실제부족 {totalActualShortage}개 · 발주 {totalOrderQuantity}개 · {group.lines.length}종
                    </span>
                  </h2>
                  <StatusBadge status={status} />
                </div>
                <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "8px" }}>
                  발주일 {new Date().toLocaleDateString("ko-KR")}
                </div>

                <div style={{ marginBottom: "10px" }}>
                  {group.lines.map(line => (
                    <VendorOrderLineCard
                      key={line.id}
                      line={line}
                      editable={editable}
                      knownVendorNames={knownVendorNames}
                      productLink={liveCatalogByProductCode.get(line.skuId)?.productLink || ""}
                      onChange={patch => updateLine(line.id, patch)}
                      onStep={delta => stepQuantity(line, delta)}
                      onRemove={() => removeLine(line)}
                    />
                  ))}
                </div>

                {editable && lowStockProducts.length > 0 && (
                  <div style={{ background: wmsColors.warnSoft, border: `1px solid ${wmsColors.warn}`, borderRadius: "10px", padding: "10px", marginBottom: "10px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 800, color: wmsColors.warn, marginBottom: "6px" }}>현재고 0~1개 추가발주 추천</div>
                    {lowStockProducts.map(product => (
                      <div key={product.skuId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", fontSize: "11px", marginTop: "5px" }}>
                        <span style={{ minWidth: 0 }}>{product.productName} · {product.optionLabel || "옵션 없음"} · 현재고 {product.currentStock}개</span>
                        <button onClick={() => addLowStockProduct(group.vendorName, product)} style={{ ...wmsPrimaryButton, minHeight: "30px", padding: "0 10px", fontSize: "11px", flexShrink: 0 }}>추가</button>
                      </div>
                    ))}
                  </div>
                )}

                {editable && (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button onClick={() => setSearchAddVendor(group.vendorName)} style={{ ...wmsGhostButton, minHeight: "36px", fontSize: "12px" }}>
                      + 상품 검색 추가
                    </button>
                    <button onClick={() => persistAll()} disabled={saving} style={{ ...wmsSecondaryButton, minHeight: "36px", fontSize: "12px" }}>
                      {saving ? "저장 중..." : "임시저장"}
                    </button>
                    <button
                      onClick={() => handleApprove(group.vendorName)}
                      disabled={saving || group.lines.length === 0}
                      style={{ ...wmsSlateDarkButton, minHeight: "36px", fontSize: "12px" }}
                    >
                      승인
                    </button>
                  </div>
                )}

                {(status === "approved" || status === "sent") && (
                  <VendorOrderExportPanel
                    wave={wave}
                    vendorName={group.vendorName}
                    lines={group.lines}
                    status={status}
                    onMarkSent={() => persistAll({ vendorName: group.vendorName, status: "sent" })}
                    onReviseAgain={() => persistAll({ vendorName: group.vendorName, status: "resend_needed" })}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {dirty && (
        <p style={{ fontSize: "11px", color: wmsColors.warn, marginBottom: "10px" }}>
          저장하지 않은 변경사항이 있습니다 — "임시저장"을 눌러야 반영됩니다.
        </p>
      )}

      {isManualWorkspace ? (
        <a href="/wms/vendor-orders" style={{ display: "block", textDecoration: "none" }}>
          <button style={{ ...wmsGhostButton, width: "100%" }}>거래처 발주관리로</button>
        </a>
      ) : (
        <a href={`/wms/picking/waves/${wave.id}/complete`} style={{ display: "block", textDecoration: "none" }}>
          <button style={{ ...wmsGhostButton, width: "100%" }}>피킹 완료 화면으로</button>
        </a>
      )}

      {searchAddVendor && (
        <ProductSearchAddSheet
          onClose={() => setSearchAddVendor(null)}
          onSelect={product => addProductFromSearch(searchAddVendor, product)}
        />
      )}
    </main>
  );
}

/**
 * 거래처 발주서 상품 1건을 보여주는 카드 (2026-08-19 3차 실사용 테스트 반영).
 * 표시 우선순위: 상품 이미지(가장 크게) → 상품명 → 옵션명 → SKU(보조정보) → 수량 → 쿠팡 바코드
 * (참고용, 작게) → 거래처/메모/삭제. 모델명은 표시/입력하지 않는다(제품DB 원본 modelName 값
 * 자체는 삭제하지 않고 화면에서만 숨김). "이미지 미등록" 영역은 눌러서 바로 카메라/사진 보관함으로
 * 등록할 수 있고(기존 ImageEditSheet/Drive 업로드 구조 재사용), 거래처는 자동완성 후보와 함께
 * 직접 입력할 수 있으며 필요하면 제품DB에도 별도로 저장할 수 있다.
 */
function VendorOrderLineCard({
  line,
  editable,
  knownVendorNames,
  productLink,
  onChange,
  onStep,
  onRemove,
}: {
  line: VendorOrderDraftLine;
  editable: boolean;
  knownVendorNames: string[];
  /** 제품DB "제품링크" 실시간 조회값 — 없으면 "" (임의 URL 생성 금지, 2026-08-19 5차 실사용 테스트 신규) */
  productLink: string;
  onChange: (patch: Partial<VendorOrderDraftLine>) => void;
  onStep: (delta: number) => void;
  onRemove: () => void;
}) {
  const [imageEditOpen, setImageEditOpen] = useState(false);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [imageSaving, setImageSaving] = useState(false);
  const [imageSaveError, setImageSaveError] = useState<string | null>(null);
  const [vendorSaving, setVendorSaving] = useState(false);
  const [vendorSaveError, setVendorSaveError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState<"단종" | "과재고" | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  /** 화면 표시 전용 URL — line.imageUrl(데이터/Sheets 저장/Canvas·카카오 공유용 원본)은 그대로
   *  두고, 이 카드의 <img src>에만 적용한다(2026-08-20 신규 — Google Drive 이미지를 화면에
   *  직접 로드하면 실기기에서 실패하는 문제 수정, image-proxy로 표시). */
  const displayImageSrc = getWmsDisplayImageUrl(line.imageUrl);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  useEffect(() => {
    setImageLoadFailed(false);
  }, [displayImageSrc]);

  /** 거래처명 입력은 로컬 draft로만 관리하고, blur(입력 완료) 시점에만 부모 lines 상태로
   *  올려보낸다 (2026-08-20 신규). 이전에는 onChange마다 곧바로 부모 lines를 갱신했는데, 부모의
   *  거래처별 그룹 목록(groups useMemo)이 vendorName을 그룹 key로 쓰고 있어 글자를 한 자
   *  입력할 때마다 이 카드가 속한 <div key={group.vendorName}>가 통째로 다른 key로 바뀌어
   *  input DOM 자체가 매번 새로 만들어졌다 — 이것이 커서 이동/포커스 풀림/한글 조합 끊김의
   *  근본 원인이었다. draft로만 값을 들고 있으면 입력 중에는 부모가 전혀 리렌더되지 않는다. */
  const [vendorDraft, setVendorDraft] = useState(line.vendorName);
  useEffect(() => {
    setVendorDraft(line.vendorName);
    // line.id가 바뀔 때(카드가 다른 라인을 가리키게 될 때)만 동기화한다 — 같은 카드가 그대로
    // 유지되는 동안은 부모의 line.vendorName 갱신(임시저장 등)이 입력 중인 draft를 덮어쓰지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id]);

  function commitVendorDraft() {
    const next = vendorDraft.trim() ? vendorDraft.trim() : UNASSIGNED_VENDOR_NAME;
    if (next !== line.vendorName) onChange({ vendorName: next });
    if (next !== vendorDraft) setVendorDraft(next);
  }

  const { name: displayName, option: displayOption } = resolveDisplayNameAndOption(line.productName, line.optionLabel);
  const datalistId = `vendor-suggestions-${line.id}`;

  /** 이미지 업로드는 이미 성공했지만(구글드라이브), 제품DB 시트 쓰기가 실패했을 때 재시도할 수 있게
   *  업로드된 URL만 따로 기억해둔다 — 재시도 시 사진을 다시 고를 필요가 없다. */
  async function persistImageUrl(url: string) {
    setImageSaving(true);
    setImageSaveError(null);
    try {
      const response = await fetch("/api/wms/product-catalog/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuId: line.skuId, imageUrl: url }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setImageSaveError(data.error || "제품DB 이미지 저장에 실패했습니다.");
        setPendingImageUrl(url);
        return;
      }
      onChange({ imageUrl: url });
      setPendingImageUrl(null);
    } catch (error) {
      setImageSaveError(error instanceof Error ? error.message : "제품DB 이미지 저장 중 오류가 발생했습니다.");
      setPendingImageUrl(url);
    } finally {
      setImageSaving(false);
    }
  }

  function handleImageUploaded(url: string) {
    setImageEditOpen(false);
    void persistImageUrl(url);
  }

  async function handleSaveVendorToCatalog() {
    const name = vendorDraft.trim();
    if (!name || name === UNASSIGNED_VENDOR_NAME) return;
    const confirmed = window.confirm(`이 거래처명("${name}")을 SKU ${line.skuId}의 제품DB에도 저장할까요?`);
    if (!confirmed) return;
    commitVendorDraft();
    setVendorSaving(true);
    setVendorSaveError(null);
    try {
      const response = await fetch("/api/wms/product-catalog/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuId: line.skuId, vendorName: name }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) setVendorSaveError(data.error || "제품DB 거래처 저장에 실패했습니다.");
    } catch (error) {
      setVendorSaveError(error instanceof Error ? error.message : "제품DB 거래처 저장 중 오류가 발생했습니다.");
    } finally {
      setVendorSaving(false);
    }
  }

  async function handleSetCatalogStatus(status: "단종" | "과재고") {
    if (!window.confirm(`SKU ${line.skuId}의 현재상태를 '${status}'로 저장할까요?`)) return;
    setStatusSaving(status);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/wms/product-catalog/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuId: line.skuId, currentStatus: status }),
      });
      const data = await response.json();
      setStatusMessage(response.ok && data.success ? `${status} 저장완료` : (data.error || `${status} 저장 실패`));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : `${status} 저장 실패`);
    } finally {
      setStatusSaving(null);
    }
  }

  return (
    <div style={{ ...wmsOuterCard, padding: "12px", marginBottom: "10px" }}>
      <button
        type="button"
        onClick={() => editable && setImageEditOpen(true)}
        disabled={!editable}
        style={{
          width: "100%",
          aspectRatio: "1",
          padding: 0,
          border: `1px solid ${wmsColors.border}`,
          borderRadius: "10px",
          background: line.imageUrl ? "#ffffff" : wmsColors.warnSoft,
          cursor: editable ? "pointer" : "default",
          display: "block",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {displayImageSrc && !imageLoadFailed ? (
          <>
            {/* iPhone Safari에서 <img>를 직접 탭하면 길게 눌렀을 때 뜨는 "사진에 저장" 콜아웃이나
             *  드래그 제스처가 탭을 가로채 버튼의 onClick이 아예 발생하지 않는 문제가 있었다
             *  (2026-08-20 확인된 근본 원인 — 이미지가 없을 때는 <img> 자체가 없어 이 문제가
             *  없었고, 있을 때만 "눌러도 반응 없음"으로 보였다). pointer-events:none으로 이미지를
             *  터치/클릭 대상에서 완전히 제외해, 이미지 위 어디를 눌러도 항상 버튼 자체가 받도록
             *  한다. */}
            <img
              src={displayImageSrc}
              alt=""
              draggable={false}
              onError={() => setImageLoadFailed(true)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                background: "#ffffff",
                display: "block",
                pointerEvents: "none",
                WebkitTouchCallout: "none",
                WebkitUserSelect: "none",
                userSelect: "none",
              }}
            />
            {editable && (
              // 상품 디자인을 가리지 않도록 이미지 하단에 작은 반투명 안내만 표시한다 — 확대와
              // 혼동되지 않게 "이미지 변경" 문구와 카메라 아이콘을 함께 쓴다(2026-08-19 5차 실사용
              // 테스트 신규). 클릭 대상은 이 버튼 전체(이미지 영역)이며 카드 전체가 아니다.
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: "8px",
                  transform: "translateX(-50%)",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  background: "rgba(37,37,37,0.55)",
                  color: "#ffffff",
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "3px 9px",
                  borderRadius: "999px",
                }}
              >
                <CameraIcon size={11} color="#ffffff" />
                이미지 변경
              </div>
            )}
          </>
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: wmsColors.warn, fontWeight: 700, fontSize: "14px", flexDirection: "column", gap: "4px" }}>
            <span>{displayImageSrc && imageLoadFailed ? "이미지 불러오기 실패" : "이미지 미등록"}</span>
            {editable && <span style={{ fontSize: "11px", fontWeight: 400 }}>탭해서 사진 {displayImageSrc && imageLoadFailed ? "교체" : "등록"}</span>}
          </div>
        )}
        {imageSaving && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.85)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: wmsColors.ink, fontWeight: 700 }}>
            저장 중...
          </div>
        )}
      </button>

      {imageSaveError && (
        <div style={{ marginTop: "6px", fontSize: "11px", color: "#c0392b" }}>
          {imageSaveError}
          {pendingImageUrl && (
            <button onClick={() => persistImageUrl(pendingImageUrl)} style={{ ...wmsGhostButton, minHeight: "26px", padding: "0 8px", fontSize: "11px", marginLeft: "6px" }}>
              다시 시도
            </button>
          )}
        </div>
      )}

      {/* 8-1: 상품명 — 카드 중앙 정렬, 여러 줄 줄바꿈 허용, 잘림 없음(2026-08-20 재배치). */}
      <div style={{ marginTop: "12px", fontSize: "16px", fontWeight: 800, color: wmsColors.ink, textAlign: "center", whiteSpace: "normal", wordBreak: "keep-all", overflowWrap: "anywhere", lineHeight: 1.35 }}>
        {displayName}
      </div>

      {/* 8-2: 옵션 입력박스 + 제품링크 — 카드 양쪽 끝에 붙지 않도록 max-width 92% + margin-inline:auto로
       *  카드 중앙 영역에 한 묶음처럼 배치한다. justify-content:space-between 대신 grid
       *  minmax(0,1fr)+auto 컬럼으로 옵션이 남는 공간을 쓰고 링크는 필요한 크기만 차지하며, 둘 다
       *  같은 높이로 수직 가운데 정렬한다(2026-08-20 실기기 추가 확인 4번). 실제 productLink만
       *  쓰고, 임의 URL을 만들지 않는다 — 이 화면의 입력값/수정사항에는 영향이 없다. */}
      <div
        style={{
          marginTop: "8px",
          width: "100%",
          maxWidth: "92%",
          marginInline: "auto",
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) auto",
          alignItems: "center",
          gap: "12px",
        }}
      >
        {editable ? (
          <input
            className="wms-input"
            value={line.optionLabel || displayOption}
            onChange={e => onChange({ optionLabel: e.target.value })}
            style={{ ...inputStyle, width: "100%", minWidth: 0, height: "34px", fontSize: "14px", fontWeight: 700, color: wmsColors.greenDark, boxSizing: "border-box" }}
          />
        ) : (
          <div style={{ minWidth: 0, height: "34px", display: "flex", alignItems: "center", fontSize: "14px", fontWeight: 700, color: wmsColors.greenDark, whiteSpace: "normal", wordBreak: "keep-all" }}>
            {displayOption || "옵션 없음"}
          </div>
        )}
        {productLink ? (
          <a href={productLink} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", flexShrink: 0 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                height: "34px",
                boxSizing: "border-box",
                padding: "0 10px",
                borderRadius: "8px",
                background: wmsColors.sand,
                color: wmsColors.sandText,
                border: `1px solid ${wmsColors.borderStrong}`,
                fontSize: "11px",
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              <ExternalLinkIcon size={12} />
              제품링크
            </span>
          </a>
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              height: "34px",
              boxSizing: "border-box",
              padding: "0 10px",
              borderRadius: "8px",
              background: "#ffffff",
              color: wmsColors.muted,
              border: `1px solid ${wmsColors.border}`,
              fontSize: "11px",
              fontWeight: 700,
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            <ExternalLinkIcon size={12} />
            제품링크 미등록
          </span>
        )}
      </div>

      {/* 8-3: 수량(왼쪽) / SKU·바코드(오른쪽) 균형 잡힌 2열 grid — 동일 가로 비율, 동일 높이.
       *  왼쪽은 "수량" 라벨과 스테퍼를 전체 중앙 정렬, 오른쪽은 SKU/바코드 그래픽/바코드 번호
       *  3줄 구조로 균일하게 배치한다(2026-08-20 재배치, 8-3 요구사항). */}
      <div style={{ marginTop: "14px", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", alignItems: "stretch", columnGap: "10px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px" }}>
          <div style={{ fontSize: "11px", color: wmsColors.muted, textAlign: "center" }}>발주수량</div>
          {editable ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              <button onClick={() => onStep(-1)} style={stepperButtonStyle}>
                −
              </button>
              <input
                className="wms-input"
                type="number"
                min={0}
                value={line.shortageQuantity}
                onChange={e => onChange({ shortageQuantity: Math.max(0, Number(e.target.value) || 0) })}
                style={{ ...inputStyle, width: "48px", textAlign: "center", fontSize: "16px", fontWeight: 800 }}
              />
              <button onClick={() => onStep(1)} style={stepperButtonStyle}>
                +
              </button>
            </div>
          ) : (
            <strong style={{ fontSize: "18px" }}>{line.shortageQuantity}개</strong>
          )}
          <div style={{ fontSize: "11px", color: wmsColors.warn, fontWeight: 700 }}>실제 부족수량 {line.actualShortageQuantity ?? line.shortageQuantity}개</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", minWidth: 0 }}>
          <div style={{ fontSize: "17px", fontWeight: 800, color: wmsColors.ink, textAlign: "center" }}>SKU {line.skuId}</div>
          <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
            <div style={{ maxWidth: "85%" }}>
              <Barcode value={line.barcode} height={16} moduleWidth={0.6} valueFontSize={10} />
            </div>
          </div>
        </div>
      </div>

      {editable && (
        <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "6px", paddingTop: "10px", borderTop: `1px dashed ${wmsColors.border}` }}>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              className="wms-input"
              list={datalistId}
              value={vendorDraft}
              placeholder="거래처"
              onChange={e => setVendorDraft(e.target.value)}
              onBlur={commitVendorDraft}
              style={{ ...inputStyle, flex: 1 }}
            />
            <datalist id={datalistId}>
              {knownVendorNames.map(name => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <button
              onClick={handleSaveVendorToCatalog}
              disabled={vendorSaving || !vendorDraft.trim() || vendorDraft.trim() === UNASSIGNED_VENDOR_NAME}
              style={{ ...wmsGhostButton, minHeight: "32px", padding: "0 8px", fontSize: "10px", flexShrink: 0, opacity: vendorSaving ? 0.6 : 1 }}
            >
              {vendorSaving ? "저장 중" : "제품DB에도 저장"}
            </button>
          </div>
          {vendorSaveError && <p style={{ fontSize: "10px", color: "#c0392b", margin: 0 }}>{vendorSaveError}</p>}
          <input className="wms-input" value={line.memo} placeholder="메모" onChange={e => onChange({ memo: e.target.value })} style={inputStyle} />
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={() => handleSetCatalogStatus("단종")} disabled={Boolean(statusSaving)} style={{ ...wmsWarnButton, flex: 1, minHeight: "34px", fontSize: "11px" }}>
              {statusSaving === "단종" ? "저장 중..." : "단종"}
            </button>
            <button onClick={() => handleSetCatalogStatus("과재고")} disabled={Boolean(statusSaving)} style={{ ...wmsSecondaryButton, flex: 1, minHeight: "34px", fontSize: "11px" }}>
              {statusSaving === "과재고" ? "저장 중..." : "과재고"}
            </button>
          </div>
          {statusMessage && <div style={{ fontSize: "10px", color: statusMessage.includes("완료") ? wmsColors.greenDark : "#c0392b" }}>{statusMessage}</div>}
          <div style={{ fontSize: "10px", color: wmsColors.muted }}>
            현재고 {line.currentStock || "미입력"} · 관련 발주서 {line.relatedPurchaseOrderNumbers.join(", ") || (line.isManuallyAdded ? "수동추가" : "-")}
          </div>
          <button onClick={onRemove} style={{ ...wmsWarnButton, minHeight: "32px", fontSize: "11px" }}>
            삭제
          </button>
        </div>
      )}

      {imageEditOpen && (
        <ImageEditSheet skuId={line.skuId} currentImageUrl={line.imageUrl} onClose={() => setImageEditOpen(false)} onSaved={handleImageUploaded} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: VendorOrderDraftStatus }) {
  const colorMap: Record<VendorOrderDraftStatus, { bg: string; text: string }> = {
    draft: { bg: wmsColors.surfaceBeige, text: wmsColors.muted },
    review: { bg: "#fff3e0", text: "#a6614e" },
    approved: { bg: wmsColors.greenSoft, text: wmsColors.greenDark },
    sent: { bg: wmsColors.green, text: "#ffffff" },
    resend_needed: { bg: wmsColors.warnSoft, text: wmsColors.warn },
  };
  const color = colorMap[status];
  return (
    <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: "999px", background: color.bg, color: color.text }}>
      {VENDOR_ORDER_STATUS_LABEL[status]}
    </span>
  );
}

const pageStyle: CSSProperties = {
  maxWidth: WMS_MOBILE_WIDTH,
  margin: "0 auto",
  padding: "12px 12px calc(12px + env(safe-area-inset-bottom))",
  fontFamily: "sans-serif",
  background: wmsColors.background,
  color: wmsColors.ink,
  minHeight: "100vh",
};

const cardStyle: CSSProperties = {
  ...wmsOuterCard,
  padding: "14px",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: "60px",
  fontSize: "12px",
  padding: "4px 6px",
  borderRadius: "6px",
  border: `1px solid ${wmsColors.border}`,
};

const stepperButtonStyle: CSSProperties = {
  width: "24px",
  height: "24px",
  flexShrink: 0,
  borderRadius: "6px",
  border: `1px solid ${wmsColors.borderStrong}`,
  background: "#ffffff",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
  lineHeight: 1,
};
