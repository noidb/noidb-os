"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import { toVendorOrderQuantity } from "@/lib/wms/vendor-order/aggregate";
import type { VendorOrderDraft, VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import { resolveGroup, sortPickingWaveItems, type PickingGroup } from "@/lib/wms/picking-wave/grouping";
import { fetchLiveCatalogLookup, resolveLiveFields, type LiveCatalogLookup } from "@/lib/wms/picking-wave/live-catalog";
import { proposeShortageAllocation, sumFulfilledQuantity } from "@/lib/wms/picking-wave/allocate";
import { buildBasketDisplayNames } from "@/lib/wms/picking-wave/basket-display";
import { UNASSIGNED_VENDOR_NAME } from "@/lib/wms/vendor-order/types";
import type { BasketAssignment, PickingWave, PickingWaveItem, PickingAllocationResult } from "@/lib/wms/picking-wave/types";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsWarnButton, wmsGhostButton, wmsBronzeButton, wmsSageButton, wmsGreenDarkButton } from "@/lib/wms/ui-tokens";
import ProductInfoEditSheet from "./ProductInfoEditSheet";
import WmsExitNav from "../WmsExitNav";
import RefreshCatalogButton from "../RefreshCatalogButton";
import ImageDiagnosticsPanel from "./ImageDiagnosticsPanel";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import { openProductLinkPreview } from "@/lib/wms/product-link-preview";
import { ExternalLinkIcon } from "../../../icons";
import WaveIdentityEditor from "../WaveIdentityEditor";
import PoConfirmEntryButton from "./PoConfirmEntryButton";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";

interface CatalogRefreshSummary {
  catalogCount: number;
  waveItemCount: number;
  matchedCount: number;
  imageUpdatedCount: number;
  skuIdUpdatedCount: number;
  unmatchedCount: number;
  unmatchedModelSkus: string[];
  noImageCount: number;
}

interface SectionGroup {
  sectionId: string;
  sectionLabel: string;
  groups: { group: PickingGroup; items: PickingWaveItem[] }[];
}

/** 섹션(카테고리) → 그룹(모델) → 아이템 순서로 정렬해 구성한다. 컴포넌트 상태와 분리된 순수 함수로
 *  둬서, 자동 다음 그룹 이동 시 stale한 useMemo 결과 대신 최신 items로 바로 계산할 수 있게 한다.
 *  liveCatalogByProductCode를 넘기면 웨이브 생성 시점 카테고리 대신 최신 제품DB 카테고리로
 *  창고 동선 순서를 계산한다(2026-08-19 사용자 확정 — 구글시트 카테고리 수정이 새로고침 시 반영). */
function buildSections(items: PickingWaveItem[], liveCatalogByProductCode?: LiveCatalogLookup): SectionGroup[] {
  const sorted = sortPickingWaveItems(items, liveCatalogByProductCode);
  const sectionOrder: string[] = [];
  const sectionMap = new Map<string, SectionGroup>();

  for (const item of sorted) {
    const group = resolveGroup(item, liveCatalogByProductCode);
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
  const vendorOrderRepository = useVendorOrderRepository();

  const [wave, setWave] = useState<PickingWave | null>(null);
  const [items, setItems] = useState<PickingWaveItem[]>([]);
  const [basketDisplayNames, setBasketDisplayNames] = useState<Record<string, string>>({});
  const [basketsByNumber, setBasketsByNumber] = useState<Record<string, BasketAssignment>>({});
  const [expectedDatesByPo, setExpectedDatesByPo] = useState<Record<string, string>>({});
  const [fulfillmentCentersByPo, setFulfillmentCentersByPo] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [liveCatalogByProductCode, setLiveCatalogByProductCode] = useState<LiveCatalogLookup>(new Map());
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogRefreshError, setCatalogRefreshError] = useState<string | null>(null);
  const [catalogRefreshSummary, setCatalogRefreshSummary] = useState<CatalogRefreshSummary | null>(null);
  const [showCatalogRefreshDetail, setShowCatalogRefreshDetail] = useState(false);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedProductCode, setSelectedProductCode] = useState<string | null>(null);

  const [showPartialInput, setShowPartialInput] = useState(false);
  const [partialTotalValue, setPartialTotalValue] = useState("");
  const [allocationDraft, setAllocationDraft] = useState<PickingAllocationResult[] | null>(null);
  const [showProductInfoSheet, setShowProductInfoSheet] = useState(false);
  const [currentStockDraft, setCurrentStockDraft] = useState("");
  const [catalogQuickSaving, setCatalogQuickSaving] = useState(false);
  const [catalogQuickMessage, setCatalogQuickMessage] = useState<string | null>(null);
  // 실제 피킹 방식은 전체 SKU 체크리스트 한 가지로 고정한다. 그룹 데이터는 완료상태 계산에만 유지한다.
  const checklistMode = true;
  const [checkedProductCodes, setCheckedProductCodes] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const decisionInFlightRef = useRef(new Set<string>());
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [vendorActionMessage, setVendorActionMessage] = useState<string | null>(null);
  const [statusActionMessage, setStatusActionMessage] = useState<string | null>(null);
  /** 하단 일괄처리 영역(미처리 SKU만 선택 + 선택 전량찾음/전량없음)의 DOM — 일괄처리 직후
   *  화면 위치가 튀는 문제를 고치기 위해, 처리 직전/직후 이 영역의 뷰포트 내 위치를 비교해
   *  같은 자리로 스크롤을 보정하는 기준점으로 쓴다 (2026-08-20 신규). */
  const bulkAreaRef = useRef<HTMLDivElement>(null);
  const listPositionRestoredRef = useRef(false);

  async function reload() {
    try {
      const [loadedWave, loadedItems, loadedBaskets] = await Promise.all([
        waveRepository.getWave(params.waveId),
        waveRepository.listItems(params.waveId),
        waveRepository.listBaskets(params.waveId),
      ]);
      if (!loadedWave) {
        setLoadError("웨이브 정보를 찾을 수 없습니다.");
        return;
      }
      setWave(loadedWave);
      setItems(loadedItems);
      setBasketDisplayNames(buildBasketDisplayNames(loadedBaskets));
      setBasketsByNumber(Object.fromEntries(loadedBaskets.map(basket => [basket.basketNumber, basket])));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "웨이브 정보를 찾을 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }

  /** 제품DB(카테고리/옵션명/대표이미지/거래처/창고번호/BOX번호/쿠팡바코드)를 최신값으로 다시
   *  불러온다 — "제품DB 새로고침" 버튼과 최초 로드 시 사용. 피킹 수량이나 웨이브 진행상태는
   *  전혀 건드리지 않는다 (2026-08-19 2차 실사용 테스트 반영 — 이전에는 카테고리만 새로고침됐다).
   *
   * 2026-08-20 보완 — 조회 실패 시 빈 카탈로그로 기존 화면을 덮어쓰지 않고 오류만 표시한다
   * (fetchLiveCatalogLookup은 실패 시 빈 Map을 돌려주는데, 실제 제품DB가 2,500개 이상이라
   * 빈 Map은 사실상 항상 조회 실패로 봐도 안전하다). 매칭 결과를 집계해 요약을 보여주고, SKU ID로만
   * 매칭됐는데 그 항목에 모델SKU가 있으면 웨이브 아이템에 모델SKU만 백필해둔다 — 피킹 상태·수량은
   * 전혀 건드리지 않고, 다음 새로고침부터 이 웨이브도 모델SKU 우선 매칭을 쓸 수 있게 하기 위함이다. */
  async function refreshProductCatalog() {
    if (catalogRefreshing) return; // 중복 클릭 방지
    setCatalogRefreshing(true);
    setCatalogRefreshError(null);
    try {
      const freshCatalog = await fetchLiveCatalogLookup();
      if (freshCatalog.size === 0) {
        setCatalogRefreshError("제품DB를 불러오지 못했습니다. 다시 시도해주세요.");
        return;
      }

      let matchedCount = 0;
      let imageUpdatedCount = 0;
      let skuIdUpdatedCount = 0;
      let noImageCount = 0;
      const unmatchedModelSkus: string[] = [];
      const backfillUpdates: PickingWaveItem[] = [];

      for (const item of items) {
        const live = resolveLiveFields(item, freshCatalog);
        if (live.matchedBy !== "none") {
          matchedCount += 1;
          if (live.matchedBy === "skuId" && live.liveModelSku && item.modelSku !== live.liveModelSku) {
            backfillUpdates.push({ ...item, modelSku: live.liveModelSku, updatedAt: new Date().toISOString() });
          }
        } else {
          unmatchedModelSkus.push(item.modelSku || item.productCode);
        }
        if (live.imageUrl && live.imageUrl !== item.imageUrl) imageUpdatedCount += 1;
        if (live.liveSkuId && live.liveSkuId !== item.productCode) skuIdUpdatedCount += 1;
        if (!live.imageUrl) noImageCount += 1;
      }

      if (backfillUpdates.length > 0) {
        await Promise.all(backfillUpdates.map(updated => waveRepository.saveItem(updated)));
        setItems(prev => prev.map(existing => backfillUpdates.find(u => u.id === existing.id) || existing));
      }

      setLiveCatalogByProductCode(freshCatalog);
      setCatalogRefreshSummary({
        catalogCount: new Set(freshCatalog.values()).size,
        waveItemCount: items.length,
        matchedCount,
        imageUpdatedCount,
        skuIdUpdatedCount,
        unmatchedCount: unmatchedModelSkus.length,
        unmatchedModelSkus,
        noImageCount,
      });
    } catch (error) {
      setCatalogRefreshError(error instanceof Error ? error.message : "제품DB를 불러오지 못했습니다. 다시 시도해주세요.");
    } finally {
      setCatalogRefreshing(false);
    }
  }

  useEffect(() => {
    reload();
    refreshProductCatalog();
    fetch("/api/wms/supplier-hub-orders?includePast=1", { cache: "no-store" })
      .then(response => response.json())
      .then(data => {
        const orders = (data.orders || []) as { purchaseOrderNumber: string; expectedDate?: string; fulfillmentCenter?: string }[];
        setExpectedDatesByPo(Object.fromEntries(orders.map(order => [order.purchaseOrderNumber, order.expectedDate || ""])));
        setFulfillmentCentersByPo(Object.fromEntries(orders.map(order => [order.purchaseOrderNumber, order.fulfillmentCenter || ""])));
      })
      .catch(() => { setExpectedDatesByPo({}); setFulfillmentCentersByPo({}); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.waveId]);

  useEffect(() => {
    if (loading || items.length === 0 || liveCatalogByProductCode.size === 0 || listPositionRestoredRef.current) return;
    const raw = sessionStorage.getItem(`noidb_picking_list_state:${params.waveId}`);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { scrollY?: number; anchorProductCode?: string };
      listPositionRestoredRef.current = true;
      requestAnimationFrame(() => {
        const anchor = saved.anchorProductCode
          ? document.querySelector<HTMLElement>(`[data-picking-sku="${CSS.escape(saved.anchorProductCode)}"]`)
          : null;
        if (anchor) anchor.scrollIntoView({ block: "center", behavior: "auto" });
        else window.scrollTo({ top: Math.max(0, saved.scrollY || 0), behavior: "auto" });
      });
    } catch {
      sessionStorage.removeItem(`noidb_picking_list_state:${params.waveId}`);
    }
  }, [items.length, liveCatalogByProductCode.size, loading, params.waveId]);

  // 섹션(카테고리) → 그룹(모델) → 아이템 순서로 정렬해 구성한다. 최신 제품DB 카테고리 기준.
  const sections: SectionGroup[] = useMemo(() => buildSections(items, liveCatalogByProductCode), [items, liveCatalogByProductCode]);

  const allGroups = useMemo(() => sections.flatMap(section => section.groups), [sections]);
  const totalGroups = allGroups.length;
  const doneGroupCount = wave ? allGroups.filter(g => wave.completedGroupIds.includes(g.group.groupId)).length : 0;

  const selectedBucket = allGroups.find(g => g.group.groupId === selectedGroupId);
  const selectedItem = selectedBucket?.items.find(item => item.productCode === selectedProductCode) ?? null;

  useEffect(() => {
    if (!selectedItem) return;
    setCurrentStockDraft(resolveLiveFields(selectedItem, liveCatalogByProductCode).catalogCurrentStock || "");
    setCatalogQuickMessage(null);
  }, [selectedItem, liveCatalogByProductCode]);

  function fulfillmentCentersForItem(item: PickingWaveItem): string[] {
    return logisticsLabelsForItem(item);
  }

  function actualFulfillmentCenter(basketNumber: string, purchaseOrderNumber: string): string {
    return fulfillmentCentersByPo[purchaseOrderNumber]
      || basketsByNumber[basketNumber]?.fulfillmentCenter
      || basketDisplayNames[basketNumber]
      || `발주서 ${purchaseOrderNumber}`;
  }

  function centerDateKey(basketNumber: string, purchaseOrderNumber: string): string {
    return `${actualFulfillmentCenter(basketNumber, purchaseOrderNumber)}\u0000${expectedDatesByPo[purchaseOrderNumber] || ""}`;
  }

  function centerDateLabel(basketNumber: string, purchaseOrderNumber: string): string {
    const center = actualFulfillmentCenter(basketNumber, purchaseOrderNumber);
    const expectedDate = expectedDatesByPo[purchaseOrderNumber];
    return expectedDate ? `${center} - ${expectedDate}` : center;
  }

  function logisticsLabelsForItem(item: PickingWaveItem): string[] {
    const totals = new Map<string, number>();
    for (const source of item.sources) {
      const center = actualFulfillmentCenter(source.basketNumber, source.purchaseOrderNumber);
      const expectedDate = expectedDatesByPo[source.purchaseOrderNumber];
      const label = expectedDate ? `${center} ${expectedDate}` : center;
      totals.set(label, (totals.get(label) || 0) + source.requestedQuantity);
    }
    return Array.from(totals.entries()).map(([label, quantity]) => `${label} ${quantity}개`);
  }

  function queueProgressSave(changedItems: PickingWaveItem[], updatedWave: PickingWave) {
    setPendingSyncCount(count => count + 1);
    const saveWithRetry = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await waveRepository.saveProgress(changedItems, updatedWave);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 300 * (attempt + 1)));
        }
      }
      throw lastError;
    };
    saveQueueRef.current = saveQueueRef.current.then(saveWithRetry, saveWithRetry)
      .catch(error => setDecisionError(`공용 저장 실패 — 이 브라우저 복구본은 유지됩니다. ${error instanceof Error ? error.message : "다시 시도해주세요."}`))
      .finally(() => {
        for (const item of changedItems) decisionInFlightRef.current.delete(item.id);
        setPendingSyncCount(count => Math.max(0, count - 1));
      });
  }

  async function addItemsToVendorDraft(selectedItems: PickingWaveItem[]) {
    if (!wave || selectedItems.length === 0) return;
    setVendorActionMessage(null);
    const now = new Date().toISOString();
    const [existingDrafts, existingLines] = await Promise.all([
      vendorOrderRepository.listDrafts(wave.id),
      vendorOrderRepository.listLines(wave.id),
    ]);
    const existingByKey = new Map(existingLines.map(line => [`${line.vendorName}\u0000${line.skuId}`, line]));
    const draftById = new Map(existingDrafts.map(draft => [draft.id, draft]));
    const linesToSave: VendorOrderDraftLine[] = [];
    let addedCount = 0;
    let updatedCount = 0;
    for (const item of selectedItems) {
      if (item.shortageQuantity <= 0) continue;
      const live = resolveLiveFields(item, liveCatalogByProductCode);
      const vendorName = live.vendorName || item.vendorName || UNASSIGNED_VENDOR_NAME;
      const skuId = live.liveSkuId || item.productCode;
      const key = `${vendorName}\u0000${skuId}`;
      const draftId = `${wave.id}::${vendorName}`;
      if (!draftById.has(draftId)) draftById.set(draftId, { id: draftId, waveId: wave.id, vendorName, status: "draft", createdAt: now, updatedAt: now });
      const actualQuantity = item.shortageQuantity;
      const relatedPurchaseOrderNumbers = Array.from(new Set(item.sources.map(source => source.purchaseOrderNumber)));
      const existing = existingByKey.get(key);
      if (existing) {
        const combinedActual = Math.max(existing.actualShortageQuantity || 0, actualQuantity);
        const combinedPos = Array.from(new Set([...(existing.relatedPurchaseOrderNumbers || []), ...relatedPurchaseOrderNumbers]));
        if (combinedActual === (existing.actualShortageQuantity || 0) && combinedPos.length === existing.relatedPurchaseOrderNumbers.length) continue;
        const updated = { ...existing, actualShortageQuantity: combinedActual, shortageQuantity: toVendorOrderQuantity(combinedActual), relatedPurchaseOrderNumbers: combinedPos, updatedAt: now };
        existingByKey.set(key, updated);
        linesToSave.push(updated);
        updatedCount += 1;
        continue;
      }
      const created: VendorOrderDraftLine = {
        id: `${draftId}::${skuId}`,
        draftId,
        waveId: wave.id,
        vendorName,
        skuId,
        modelName: live.catalogModelName || item.modelName || item.productName,
        category: live.category || item.category || "",
        optionLabel: live.optionLabel || item.optionLabel || "",
        productName: live.name || item.productName,
        imageUrl: live.imageUrl || item.imageUrl || "",
        barcode: live.catalogBarcode || item.catalogBarcode || "",
        actualShortageQuantity: actualQuantity,
        shortageQuantity: toVendorOrderQuantity(actualQuantity),
        currentStock: live.catalogCurrentStock || item.catalogCurrentStock || "",
        relatedPurchaseOrderNumbers,
        memo: "피킹 목록에서 추가",
        isManuallyAdded: true,
        createdAt: now,
        updatedAt: now,
      };
      existingByKey.set(key, created);
      linesToSave.push(created);
      addedCount += 1;
    }
    const newDrafts = Array.from(draftById.values()).filter(draft => !existingDrafts.some(existing => existing.id === draft.id));
    // 공용 Blob 저장은 revision 기반이므로 여러 쓰기를 동시에 보내지 않고 순서대로 확정한다.
    for (const draft of newDrafts) await vendorOrderRepository.saveDraft(draft);
    for (const line of linesToSave) await vendorOrderRepository.saveLine(line);
    setVendorActionMessage(
      addedCount || updatedCount
        ? `거래처 발주 초안 반영 완료 · 신규 ${addedCount}개 · 수량 갱신 ${updatedCount}개`
        : "이미 같은 발주번호와 수량으로 거래처 발주 초안에 반영된 SKU입니다."
    );
  }

  async function moveItemsToDiscontinueList(selectedItems: PickingWaveItem[]) {
    if (!wave || selectedItems.length === 0) return;
    if (!window.confirm(`선택한 ${selectedItems.length}개 SKU를 기존 단종 처리대기 목록으로 이동할까요? 제품 행은 삭제되지 않습니다.`)) return;
    setStatusActionMessage(null);
    const results = await Promise.all(selectedItems.map(async item => {
      const live = resolveLiveFields(item, liveCatalogByProductCode);
      const response = await fetch("/api/wms/vendor-order-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "queue-discontinue", skuId: live.liveSkuId || item.productCode, operator: wave.workerName || "WMS 피킹" }),
      });
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok && data.success, error: data.error as string | undefined };
    }));
    const failed = results.filter(result => !result.ok);
    setStatusActionMessage(failed.length ? `${results.length - failed.length}개 이동, ${failed.length}개 제외: ${failed[0]?.error || "처리 실패"}` : `${results.length}개 SKU를 단종 처리대기 목록으로 이동했습니다.`);
  }

  async function saveCatalogQuickPatch(skuId: string, patch: { currentStock?: string; currentStatus?: "단종" | "과재고" | "" }, successMessage: string) {
    setCatalogQuickSaving(true);
    setCatalogQuickMessage(null);
    try {
      const response = await fetch("/api/wms/product-catalog/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuId, ...patch }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "제품DB 저장에 실패했습니다.");
      setCatalogQuickMessage(successMessage);
      await refreshProductCatalog();
    } catch (error) {
      setCatalogQuickMessage(error instanceof Error ? error.message : "제품DB 저장에 실패했습니다.");
    } finally {
      setCatalogQuickSaving(false);
    }
  }

  async function persistItem(item: PickingWaveItem, patch: Partial<PickingWaveItem>) {
    if (!wave || decisionInFlightRef.current.has(item.id)) return;
    const startedAt = performance.now();
    decisionInFlightRef.current.add(item.id);
    setDecisionError(null);
    const updated: PickingWaveItem = { ...item, ...patch, updatedAt: new Date().toISOString() };
    const nextItems = items.map(existing => (existing.id === updated.id ? updated : existing));
    const allGroupsNow = buildSections(nextItems, liveCatalogByProductCode).flatMap(section => section.groups);
    const nextCompletedGroupIds = allGroupsNow
      .filter(bucket => bucket.items.every(item => item.status !== "pending"))
      .map(bucket => bucket.group.groupId);
    const sortedItems = sortPickingWaveItems(nextItems, liveCatalogByProductCode);
    const currentIndex = sortedItems.findIndex(item => item.id === updated.id);
    const nextPending = [
      ...sortedItems.slice(currentIndex + 1),
      ...sortedItems.slice(0, Math.max(0, currentIndex)),
    ].find(item => item.status === "pending");

    if (nextPending) {
      const updatedWave: PickingWave = { ...wave, completedGroupIds: nextCompletedGroupIds, updatedAt: new Date().toISOString() };
      setItems(nextItems);
      setWave(updatedWave);
      setSelectedGroupId(resolveGroup(nextPending, liveCatalogByProductCode).groupId);
      setSelectedProductCode(nextPending.productCode);
      queueProgressSave([updated], updatedWave);
      if (process.env.NODE_ENV !== "production") console.info("[picking-optimistic-next-ms]", Math.round(performance.now() - startedAt));
      return;
    }

    // 남은 미처리 상품이 없을 때만 웨이브 완료 화면으로 이동한다.
    const completedWave: PickingWave = {
      ...wave,
      completedGroupIds: nextCompletedGroupIds,
      status: "completed",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setItems(nextItems);
    setWave(completedWave);
    queueProgressSave([updated], completedWave);
    router.push(`/wms/picking/waves/${wave.id}/complete`);
  }

  /** 체크리스트에서 선택한 SKU만 한 번에 처리하는 공통 로직 (2026-08-19 3차 실사용 테스트 반영 —
   *  "선택 전량찾음"/"선택 전량없음" 둘 다 이 함수를 재사용한다). 체크 해제된 상품은 절대 건드리지
   *  않고, 기존 수량에 누적하지 않는다 — 항상 최종값(전량 또는 0)으로 확정한다. */
  async function applyBulkStatus(found: "full" | "notfound") {
    if (!wave || checkedProductCodes.size === 0) return;
    const bulkAreaEl = bulkAreaRef.current;
    const anchorBefore = bulkAreaEl?.getBoundingClientRect().top;
    let navigatingAway = false;
    setBulkProcessing(true);
    try {
      const now = new Date().toISOString();
      const nextItems = items.map(item => {
        if (!checkedProductCodes.has(item.productCode)) return item;
        const fulfilled = found === "full" ? item.totalQuantity : 0;
        const allocations: PickingAllocationResult[] = item.sources.map(source => ({
          purchaseOrderNumber: source.purchaseOrderNumber,
          basketNumber: source.basketNumber,
          requestedQuantity: source.requestedQuantity,
          fulfilledQuantity: found === "full" ? source.requestedQuantity : 0,
          shortageQuantity: found === "full" ? 0 : source.requestedQuantity,
        }));
        return { ...item, status: found, pickedQuantity: fulfilled, shortageQuantity: item.totalQuantity - fulfilled, allocations, updatedAt: now };
      });

      const changedItems = nextItems.filter(item => checkedProductCodes.has(item.productCode));
      setItems(nextItems);

      const allGroupsNow = buildSections(nextItems, liveCatalogByProductCode).flatMap(section => section.groups);
      const nextCompletedGroupIds = allGroupsNow.filter(g => g.items.every(it => it.status !== "pending")).map(g => g.group.groupId);
      const allDone = nextCompletedGroupIds.length === allGroupsNow.length;
      const updatedWave: PickingWave = {
        ...wave,
        completedGroupIds: nextCompletedGroupIds,
        status: allDone ? "completed" : wave.status,
        completedAt: allDone ? now : wave.completedAt,
        updatedAt: now,
      };
      setWave(updatedWave);
      setCheckedProductCodes(new Set());
      queueProgressSave(changedItems, updatedWave);

      if (allDone) {
        navigatingAway = true;
        router.push(`/wms/picking/waves/${wave.id}/complete`);
      }
    } finally {
      setBulkProcessing(false);
    }

    // 웨이브가 전부 끝나 완료 화면으로 이동하는 경우가 아니면(= 같은 체크리스트 화면에 머무는
    // 일반적인 경우), 처리 직전 저장해둔 하단 일괄처리 영역의 뷰포트 위치로 스크롤을 보정한다.
    // requestAnimationFrame으로 재렌더링/레이아웃이 끝난 뒤 위치를 다시 재서 차이만큼만 보정하므로
    // 목록 위쪽 텍스트 줄바꿈 등 사소한 높이 변화가 있어도 항상 같은 화면 위치를 유지한다.
    if (!navigatingAway && bulkAreaEl && anchorBefore !== undefined) {
      requestAnimationFrame(() => {
        const anchorAfter = bulkAreaEl.getBoundingClientRect().top;
        const delta = anchorAfter - anchorBefore;
        if (delta !== 0) window.scrollBy({ top: delta, left: 0, behavior: "auto" });
      });
    }
  }

  function handleBulkFull() {
    return applyBulkStatus("full");
  }

  function handleBulkNotFound() {
    if (checkedProductCodes.size === 0) return;
    const confirmed = window.confirm(`선택한 ${checkedProductCodes.size}개 상품을 전량 없음으로 처리할까요?`);
    if (!confirmed) return;
    return applyBulkStatus("notfound");
  }

  function toggleChecked(productCode: string) {
    setCheckedProductCodes(prev => {
      const next = new Set(prev);
      if (next.has(productCode)) next.delete(productCode);
      else next.add(productCode);
      return next;
    });
  }

  function openProductDetail(item: PickingWaveItem) {
    sessionStorage.setItem(`noidb_picking_list_state:${params.waveId}`, JSON.stringify({
      scrollY: window.scrollY,
      anchorProductCode: item.productCode,
    }));
    router.push(`/wms/products/${encodeURIComponent(item.productCode)}?fromWave=${encodeURIComponent(params.waveId)}`);
  }

  async function removeSelectedImageLinks() {
    if (checkedProductCodes.size === 0) return;
    const selected = items.filter(item => checkedProductCodes.has(item.productCode));
    if (!window.confirm(`선택한 ${selected.length}개 SKU의 제품DB 이미지 연결을 제거합니다.\n원본 이미지 파일은 삭제하지 않습니다.`)) return;
    setBulkProcessing(true);
    setStatusActionMessage(null);
    const snapshots = selected.map(item => {
      const live = resolveLiveFields(item, liveCatalogByProductCode);
      return { skuId: live.liveSkuId || item.productCode, imageUrl: live.imageUrl || "", deletedAt: new Date().toISOString() };
    });
    try {
      const dryRuns = await Promise.all(snapshots.map(async snapshot => {
        const response = await fetch("/api/wms/product-catalog/update", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skuId: snapshot.skuId, imageUrl: "", dryRun: true }),
        });
        const data = await response.json().catch(() => ({}));
        return { snapshot, ok: response.ok && data.success, error: data.error as string | undefined };
      }));
      const writable = dryRuns.filter(result => result.ok && result.snapshot.imageUrl);
      const alreadyEmpty = dryRuns.filter(result => result.ok && !result.snapshot.imageUrl).length;
      const failedDryRun = dryRuns.filter(result => !result.ok);
      const writes = await Promise.all(writable.map(async result => {
        const response = await fetch("/api/wms/product-catalog/update", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skuId: result.snapshot.skuId, imageUrl: "" }),
        });
        const data = await response.json().catch(() => ({}));
        return { ...result.snapshot, ok: response.ok && data.success, error: data.error as string | undefined };
      }));
      const succeeded = writes.filter(result => result.ok);
      const failed = failedDryRun.length + writes.filter(result => !result.ok).length;
      if (succeeded.length) {
        const historyKey = "noidb_product_image_unlink_history";
        let previous: typeof snapshots = [];
        try {
          const parsed = JSON.parse(localStorage.getItem(historyKey) || "[]");
          if (Array.isArray(parsed)) previous = parsed as typeof snapshots;
        } catch {
          // 손상된 브라우저 복구기록이 제품DB 이미지 연결 해제 결과에 영향을 주지 않게 새 기록으로 시작한다.
        }
        localStorage.setItem(historyKey, JSON.stringify([...succeeded.map(({ ok: _ok, error: _error, ...snapshot }) => snapshot), ...previous].slice(0, 100)));
        const succeededIds = new Set(succeeded.map(result => normalizeSkuId(result.skuId)));
        const nextCatalog = new Map(liveCatalogByProductCode);
        for (const [key, value] of nextCatalog) {
          if (succeededIds.has(normalizeSkuId(value.skuId))) nextCatalog.set(key, { ...value, imageUrl: "" });
        }
        setLiveCatalogByProductCode(nextCatalog);
      }
      setCheckedProductCodes(new Set());
      setStatusActionMessage(`이미지 연결 삭제 ${succeeded.length}개 · 이미 빈 이미지 ${alreadyEmpty}개 · 실패 ${failed}개`);
    } catch (error) {
      setStatusActionMessage(error instanceof Error ? error.message : "이미지 연결 삭제에 실패했습니다.");
    } finally {
      setBulkProcessing(false);
    }
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
        <WmsExitNav />
        <h1 style={{ fontSize: "18px" }}>통합 피킹</h1>
        <p style={{ color: "#c0392b", fontWeight: 700 }}>{loadError || "웨이브 정보를 찾을 수 없습니다."}</p>
      </main>
    );
  }

  // 화면: 섹션 → 그룹 목록
  if (!selectedBucket) {
    return (
      <main style={pageStyle}>
        <WmsExitNav />
        <h1 style={{ fontSize: "18px", margin: "0 0 6px" }}>통합 피킹</h1>
        <WaveIdentityEditor wave={wave} onSave={async updated => { await waveRepository.saveWave(updated); setWave(updated); }} />
        <p style={{ color: wmsColors.muted, fontSize: "13px", margin: "4px 0" }}>발주서 {wave.sourcePurchaseOrderNumbers.length}건</p>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 10px" }}>
          <p style={{ color: wmsColors.green, fontSize: "13px", fontWeight: 700, margin: 0 }}>
            전체 SKU 진행률 {items.filter(item => item.status !== "pending").length} / {items.length}
          </p>
          <RefreshCatalogButton
            onClick={refreshProductCatalog}
            loading={catalogRefreshing}
            error={Boolean(catalogRefreshError)}
            label={catalogRefreshing ? "새로고침 중..." : catalogRefreshError ? "새로고침 실패 · 다시 시도" : "제품DB 새로고침"}
          />
        </div>

        {catalogRefreshError && (
          <p style={{ fontSize: "11px", color: "#c0392b", margin: "0 0 10px" }}>{catalogRefreshError}</p>
        )}

        {checklistMode && (
          <ChecklistView
            key={wave.id}
            allItems={items}
            checkedProductCodes={checkedProductCodes}
            onToggle={toggleChecked}
            onSetChecked={setCheckedProductCodes}
            onBulkFull={handleBulkFull}
            onBulkVendorOrder={() => addItemsToVendorDraft(items.filter(item => checkedProductCodes.has(item.productCode)))}
            onBulkDiscontinue={() => moveItemsToDiscontinueList(items.filter(item => checkedProductCodes.has(item.productCode)))}
            onBulkDeleteImages={removeSelectedImageLinks}
            bulkProcessing={bulkProcessing}
            liveCatalogByProductCode={liveCatalogByProductCode}
            bulkAreaRef={bulkAreaRef}
            onOpenDetail={openProductDetail}
            logisticsLabelsForItem={logisticsLabelsForItem}
            actionMessage={vendorActionMessage || statusActionMessage}
            poConfirmAction={<PoConfirmEntryButton waveId={wave.id} itemCount={items.length} />}
          />
        )}

        <PickingListBottomBar wave={wave} items={items} />
      </main>
    );
  }

  // 화면: 선택한 그룹의 아이템(SKU) 목록
  if (!selectedItem) {
    const doneInGroup = selectedBucket.items.filter(item => item.status !== "pending").length;
    const groupCenters = Array.from(new Set(selectedBucket.items.flatMap(item => fulfillmentCentersForItem(item))));
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
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px", marginBottom: "14px" }}>
          {groupCenters.map(center => <span key={center} style={{ background: wmsColors.slateDark, color: "#fff", borderRadius: "10px", padding: "8px 14px", fontSize: "16px", fontWeight: 900 }}>{center}</span>)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {selectedBucket.items.map(item => {
            const isDone = item.status !== "pending";
            const live = resolveLiveFields(item, liveCatalogByProductCode);
            return (
              <div
                key={item.productCode}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedProductCode(item.productCode)}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") setSelectedProductCode(item.productCode);
                }}
                style={{
                  ...wmsSecondaryButton,
                  height: "auto",
                  minHeight: "64px",
                  width: "100%",
                  minWidth: 0,
                  boxSizing: "border-box",
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
                <ItemThumbnail imageUrl={live.imageUrl || catalogImageFallback(live.catalogModelName, live.liveModelSku || item.modelSku, live.productLink)} size={48} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: "15px", color: wmsColors.ink, whiteSpace: "normal", overflow: "visible", wordBreak: "keep-all", lineHeight: 1.4 }}>
                    {live.name}
                  </div>
                  <div style={{ display: "inline-block", marginTop: "4px", padding: "3px 7px", borderRadius: "6px", background: wmsColors.surfaceBeige, fontSize: "13px", fontWeight: 800, color: "#3f4541", whiteSpace: "normal", wordBreak: "keep-all", lineHeight: 1.35 }}>
                    옵션 · {live.optionLabel || "옵션 없음"}
                  </div>
                  <div style={{ fontSize: "11px", color: wmsColors.muted }}>SKU {item.productCode}</div>
                  <div style={{ marginTop: "3px", fontSize: "12px", fontWeight: 900, color: wmsColors.slateDark }}>{fulfillmentCentersForItem(item).join(" · ")}</div>
                </div>
                <ProductLinkIconButton productLink={live.productLink} />
                <div style={{ minWidth: "54px", textAlign: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: "16px", fontWeight: 900, color: wmsColors.ink }}>{item.pickedQuantity} / {item.totalQuantity}</div>
                  <div style={{ fontSize: "10px", color: wmsColors.muted }}>찾음 / 전체</div>
                  {isDone && <div style={{ fontSize: "10px", color: wmsColors.greenDark, textAlign: "right" }}>완료</div>}
                </div>
              </div>
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
          {selectedItem.productName} · 찾은 수량 {pickedTotal}개 — 발주서별 배정수량을 확인하거나 직접 고쳐주세요.
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
                    {centerDateLabel(row.basketNumber, row.purchaseOrderNumber)}
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
  // 2026-08-20: live를 이 함수 스코프에서 한 번만 계산해 상세 화면과 "상품 정보 수정" 시트
  // (ProductInfoEditSheet)가 완전히 같은 최신 제품DB 값을 쓰도록 한다 — 화면마다 별도로
  // resolveLiveFields를 다시 계산하지 않는다.
  const selectedItemLive = resolveLiveFields(selectedItem, liveCatalogByProductCode);
  // 화살표 이동은 현재 그룹 안에서만 돌지 않고 웨이브 전체 상품 순서를 사용한다.
  const detailItems = sortPickingWaveItems(items, liveCatalogByProductCode);
  const detailIndex = detailItems.findIndex(item => item.productCode === selectedItem.productCode);
  const selectedCenterDateKeys = new Set(selectedItem.sources.map(source =>
    centerDateKey(source.basketNumber, source.purchaseOrderNumber)
  ));
  const centerDateSummaryMap = new Map<string, { label: string; skuIds: Set<string>; totalQuantity: number }>();
  for (const item of items) {
    for (const source of item.sources) {
      const key = centerDateKey(source.basketNumber, source.purchaseOrderNumber);
      if (!selectedCenterDateKeys.has(key)) continue;
      const summary = centerDateSummaryMap.get(key) || {
        label: centerDateLabel(source.basketNumber, source.purchaseOrderNumber),
        skuIds: new Set<string>(),
        totalQuantity: 0,
      };
      summary.skuIds.add(item.productCode);
      summary.totalQuantity += source.requestedQuantity;
      centerDateSummaryMap.set(key, summary);
    }
  }
  const selectedCenterDateSummaries = Array.from(centerDateSummaryMap.values());
  function moveDetail(offset: number) {
    const next = detailItems[detailIndex + offset];
    if (!next) return;
    setShowPartialInput(false);
    setAllocationDraft(null);
    setSelectedGroupId(resolveGroup(next, liveCatalogByProductCode).groupId);
    setSelectedProductCode(next.productCode);
  }

  return (
    <main style={{ ...pageStyle, display: "flex", flexDirection: "column", minHeight: 0, height: "calc(100dvh - 72px)", padding: "12px 12px calc(12px + env(safe-area-inset-bottom))" }}>
      <button onClick={() => setSelectedProductCode(null)} style={{ ...wmsGhostButton, marginBottom: "8px", flexShrink: 0 }}>
        ← 그룹 안 목록으로
      </button>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button onClick={() => selectedItemLive.productLink ? openProductLinkPreview(selectedItemLive.productLink) : setShowProductInfoSheet(true)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "center", minWidth: 0 }}>
            <DetailImage imageUrl={selectedItemLive.imageUrl || catalogImageFallback(selectedItemLive.catalogModelName, selectedItemLive.liveModelSku || selectedItem.modelSku, selectedItemLive.productLink)} alt={selectedItem.productName} />
          </button>
        </div>

        <button
          onClick={() => setShowProductInfoSheet(true)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "center", width: "100%" }}
        >
          <h2 style={{ margin: "10px 0 2px", fontSize: "18px", color: wmsColors.ink }}>{selectedItemLive.name}</h2>
          <p style={{ margin: "0 0 2px", color: wmsColors.greenDark, fontSize: "15px", fontWeight: 700, whiteSpace: "normal", wordBreak: "keep-all" }}>
            옵션 {selectedItemLive.optionLabel || "옵션 없음"}
          </p>
          <p style={{ margin: 0, color: wmsColors.muted, fontSize: "13px" }}>
            SKU {selectedItem.productCode}
            {selectedItemLive.liveSkuId && selectedItemLive.liveSkuId !== selectedItem.productCode && (
              <span style={{ color: wmsColors.greenDark, fontWeight: 700 }}> (최신 SKU ID: {selectedItemLive.liveSkuId})</span>
            )}
          </p>
        </button>

        <ImageDiagnosticsPanel item={selectedItem} live={selectedItemLive} />

        <div style={{ display: "grid", gridTemplateColumns: "72px minmax(0,1fr) 72px", alignItems: "stretch", gap: "10px", margin: "10px 0" }}>
          <button type="button" aria-label="이전 상품" disabled={detailIndex <= 0} onClick={() => moveDetail(-1)} style={{ ...detailArrowStyle, opacity: detailIndex <= 0 ? 0.35 : 1 }}>‹</button>
          <InfoTile label="총 찾을 수량" value={selectedItem.totalQuantity} centered prominent />
          <button type="button" aria-label="다음 상품" disabled={detailIndex < 0 || detailIndex >= detailItems.length - 1} onClick={() => moveDetail(1)} style={{ ...detailArrowStyle, opacity: detailIndex < 0 || detailIndex >= detailItems.length - 1 ? 0.35 : 1 }}>›</button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px", marginBottom: "10px" }}>
          {Array.from(new Set(selectedItem.sources.map(source => centerDateLabel(source.basketNumber, source.purchaseOrderNumber)))).map(label => (
            <span key={label} style={{ background: wmsColors.slateDark, color: "#fff", borderRadius: "10px", padding: "9px 16px", fontSize: "18px", fontWeight: 900 }}>{label}</span>
          ))}
        </div>

        <details style={{ background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "8px", marginBottom: "8px" }}>
          <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 800 }}>현재고·상품상태 (선택사항)</summary>
          <div style={{ fontSize: "11px", color: wmsColors.muted, margin: "8px 0 4px" }}>확인이 필요할 때만 입력하세요. 피킹 진행에는 필수가 아닙니다.</div>
          <div style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) 44px", gap: "6px" }}>
            <button type="button" onClick={() => setCurrentStockDraft(value => String(Math.max(0, (Number(value) || 0) - 1)))} style={{ ...wmsSecondaryButton, minHeight: "44px", padding: 0, fontSize: "22px" }}>−</button>
            <input type="number" min={0} inputMode="numeric" value={currentStockDraft} onChange={event => setCurrentStockDraft(event.target.value)} placeholder="현재고" style={{ minWidth: 0, minHeight: "44px", borderRadius: "8px", border: `1px solid ${wmsColors.borderStrong}`, textAlign: "center", fontSize: "21px", fontWeight: 900 }} />
            <button type="button" onClick={() => setCurrentStockDraft(value => String((Number(value) || 0) + 1))} style={{ ...wmsSecondaryButton, minHeight: "44px", padding: 0, fontSize: "22px" }}>＋</button>
          </div>
          <button disabled={catalogQuickSaving || currentStockDraft === ""} onClick={() => saveCatalogQuickPatch(selectedItemLive.liveSkuId || selectedItem.productCode, { currentStock: String(Math.max(0, Number(currentStockDraft) || 0)) }, "현재고 저장완료")} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "42px", marginTop: "6px", fontSize: "12px" }}>현재고 저장</button>
          <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
            <button disabled={catalogQuickSaving} onClick={() => saveCatalogQuickPatch(selectedItemLive.liveSkuId || selectedItem.productCode, { currentStatus: "단종" }, "단종 저장완료")} style={{ ...wmsWarnButton, flex: 1, minHeight: "36px", fontSize: "12px" }}>단종</button>
            <button disabled={catalogQuickSaving} onClick={() => saveCatalogQuickPatch(selectedItemLive.liveSkuId || selectedItem.productCode, { currentStatus: "과재고" }, "과재고 저장완료")} style={{ ...wmsSecondaryButton, flex: 1, minHeight: "36px", fontSize: "12px" }}>과재고</button>
          </div>
          {catalogQuickMessage && <div style={{ fontSize: "11px", marginTop: "5px", color: catalogQuickMessage.includes("완료") ? wmsColors.greenDark : "#c0392b" }}>{catalogQuickMessage}</div>}
          <button type="button" onClick={() => addItemsToVendorDraft([selectedItem])} style={{ ...wmsBronzeButton, width: "100%", minHeight: "40px", marginTop: "6px" }}>거래처 발주서 추가</button>
          {vendorActionMessage && <div style={{ fontSize: "11px", marginTop: "5px", color: wmsColors.greenDark }}>{vendorActionMessage}</div>}
        </details>

        <div style={{ marginBottom: "8px", textAlign: "left" }}>
          <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "2px" }}>발주서/물류센터별 분배 수량</div>
          {selectedItem.sources.map(source => (
            <div key={source.purchaseOrderNumber} style={{ fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
              <span>
                {actualFulfillmentCenter(source.basketNumber, source.purchaseOrderNumber)}
                {expectedDatesByPo[source.purchaseOrderNumber] && <span style={{ color: wmsColors.greenDark, fontSize: "10px", fontWeight: 800 }}> · 입고예정일 {expectedDatesByPo[source.purchaseOrderNumber]}</span>}
                <span style={{ color: wmsColors.muted, fontSize: "10px" }}> (발주서 {source.purchaseOrderNumber})</span>
              </span>
              <span style={{ fontWeight: 700 }}>{source.requestedQuantity}개</span>
            </div>
          ))}
          <div style={{ display: "grid", gap: "6px", marginTop: "8px" }}>
            {selectedCenterDateSummaries.map(summary => (
              <div key={summary.label} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "8px", background: wmsColors.surfaceBeige, padding: "6px 8px", fontSize: "12px", fontWeight: 800 }}>
                <span style={{ color: wmsColors.greenDark }}>{summary.label}</span> · {summary.skuIds.size} SKU · {summary.totalQuantity}개
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flexShrink: 0, paddingTop: "8px" }}>
        {!showPartialInput ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              onClick={() => handleFull(selectedItem)}
              disabled={decisionInFlightRef.current.has(selectedItem.id)}
              style={{ ...wmsPrimaryButton, width: "100%" }}
            >
              전량찾음
            </button>
            <div style={{ display: "flex", gap: "8px" }}>
              <button disabled={decisionInFlightRef.current.has(selectedItem.id)} onClick={() => startPartial()} style={{ ...wmsSecondaryButton, flex: 1 }}>
                부분찾음
              </button>
              <button disabled={decisionInFlightRef.current.has(selectedItem.id)} onClick={() => handleNotFound(selectedItem)} style={{ ...wmsWarnButton, flex: 1 }}>
                못 찾음
              </button>
            </div>
            {decisionError && <p role="alert" style={{ margin: 0, color: "#b42318", fontSize: "13px", fontWeight: 700 }}>{decisionError}</p>}
            {pendingSyncCount > 0 && <p style={{ margin: 0, color: wmsColors.muted, fontSize: "11px", textAlign: "center" }}>공용 저장 동기화 중 {pendingSyncCount}건</p>}
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
          live={selectedItemLive}
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
  padding: "12px 12px calc(12px + env(safe-area-inset-bottom))",
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

const detailArrowStyle: CSSProperties = {
  width: "72px",
  minHeight: "76px",
  borderRadius: "12px",
  border: `1px solid ${wmsColors.borderStrong}`,
  background: "#ffffff",
  color: wmsColors.slateDark,
  fontSize: "38px",
  fontWeight: 800,
  lineHeight: 1,
  cursor: "pointer",
};

function catalogImageFallback(modelName?: string, modelSku?: string, _productLink?: string): string {
  // 옵션별로 고유한 모델SKU를 먼저 사용해 같은 모델의 다른 색상/사이즈 이미지를 잘못
  // 표시하지 않는다. 모델SKU가 실제 데이터에 없을 때만 모델명으로 후퇴한다.
  const model = (modelSku || modelName || "").trim();
  if (model) return `/api/wms/product-image/from-drive?model=${encodeURIComponent(model)}`;
  return "";
}

/**
 * 전체 SKU를 그룹 이동 없이 한 화면에서 체크박스로 처리하는 목록 (2026-08-19 신규).
 * 창고 동선 순서(카테고리 버킷)로 정렬한다. 체크박스와 "상품 상세로 들어가기" 동작이 섞이지
 * 않도록, 이 화면에서는 상세 진입 없이 체크만 하고 [선택 상품 전량찾음]으로만 처리한다.
 */
function ChecklistView({
  allItems,
  checkedProductCodes,
  onToggle,
  onSetChecked,
  onBulkFull,
  onBulkVendorOrder,
  onBulkDiscontinue,
  onBulkDeleteImages,
  bulkProcessing,
  liveCatalogByProductCode,
  bulkAreaRef,
  onOpenDetail,
  logisticsLabelsForItem,
  actionMessage,
  poConfirmAction,
}: {
  allItems: PickingWaveItem[];
  checkedProductCodes: Set<string>;
  onToggle: (productCode: string) => void;
  onSetChecked: (next: Set<string>) => void;
  onBulkFull: () => void;
  onBulkVendorOrder: () => void | Promise<void>;
  onBulkDiscontinue: () => void | Promise<void>;
  onBulkDeleteImages: () => void | Promise<void>;
  bulkProcessing: boolean;
  liveCatalogByProductCode: LiveCatalogLookup;
  bulkAreaRef: RefObject<HTMLDivElement>;
  onOpenDetail: (item: PickingWaveItem) => void;
  logisticsLabelsForItem: (item: PickingWaveItem) => string[];
  actionMessage: string | null;
  poConfirmAction: React.ReactNode;
}) {
  const sortedItems = sortPickingWaveItems(allItems, liveCatalogByProductCode);

  function selectAll() {
    onSetChecked(new Set(allItems.map(item => item.productCode)));
  }
  function deselectAll() {
    onSetChecked(new Set());
  }
  /** 현재 화면에 보이는 전체 SKU 기준으로 체크 상태만 뒤집는다 — 찾은 수량/상태는 전혀 건드리지 않는다
   *  (2026-08-19 3차 실사용 테스트 반영). */
  function invertSelection() {
    const next = new Set(allItems.filter(item => !checkedProductCodes.has(item.productCode)).map(item => item.productCode));
    onSetChecked(next);
  }
  /** 최종 피킹 상태가 아직 정해지지 않은(status==="pending") SKU만 선택한다 — 찾은수량이
   *  0이어도 이미 "못찾음"으로 처리 완료된 SKU는 제외한다 (2026-08-19 4차 실사용 테스트 반영,
   *  기존 PickingWaveItemStatus를 그대로 재사용). 기존 선택은 모두 해제하고 새로 선택한다. */
  function selectUnprocessed() {
    onSetChecked(new Set(allItems.filter(item => item.status === "pending").map(item => item.productCode)));
  }

  return (
    <div>
      {/* 버튼 역할별 색상 구분 (2026-08-19 5차 실사용 테스트 반영, AI 상품등록 화면 팔레트 재사용):
       *  전체선택=블루그레이, 전체해제=웜베이지, 반전선택=오커·브라운.
       *  "미처리 SKU만 선택"은 6차 실사용 테스트에서 목록 맨 아래 일괄처리 버튼 바로 위로
       *  옮겼다 — 상단에는 이제 중복 없이 이 3개만 남는다. */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
        <button onClick={selectAll} style={{ ...wmsPrimaryButton, flex: 1, minWidth: "88px", minHeight: "40px", fontSize: "12px" }}>
          전체선택
        </button>
        <button onClick={deselectAll} style={{ ...wmsSecondaryButton, flex: 1, minWidth: "88px", minHeight: "40px", fontSize: "12px" }}>
          전체해제
        </button>
        <button onClick={invertSelection} style={{ ...wmsBronzeButton, flex: 1, minWidth: "88px", minHeight: "40px", fontSize: "12px" }}>
          반전선택
        </button>
      </div>
      <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 10px" }}>선택된 상품 {checkedProductCodes.size}개</p>

      <button
        type="button"
        onClick={onBulkFull}
        disabled={checkedProductCodes.size === 0 || bulkProcessing}
        style={{ ...wmsGreenDarkButton, width: "100%", minHeight: "50px", marginBottom: "8px", opacity: checkedProductCodes.size === 0 || bulkProcessing ? 0.5 : 1 }}
      >
        {bulkProcessing ? "처리 중..." : `선택 전량찾음 (${checkedProductCodes.size}개)`}
      </button>
      {poConfirmAction}

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
        {sortedItems.map(item => {
          const checked = checkedProductCodes.has(item.productCode);
          const isDone = item.status !== "pending";
          const live = resolveLiveFields(item, liveCatalogByProductCode);
          return (
            <div
              key={item.productCode}
              data-picking-sku={item.productCode}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                border: `1px solid ${wmsColors.border}`,
                borderRadius: "10px",
                padding: "8px 10px",
                background: isDone ? wmsColors.greenSoft : "#ffffff",
                contentVisibility: "auto",
                containIntrinsicSize: "76px",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(item.productCode)}
                style={{ width: "22px", height: "22px", flexShrink: 0, cursor: "pointer" }}
              />
              <button type="button" aria-label={live.productLink ? "제품 링크 열기" : "제품 링크 없음"} disabled={!live.productLink} onClick={() => live.productLink && openProductLinkPreview(live.productLink)} style={{ width: "44px", height: "44px", flex: "0 0 44px", display: "grid", placeItems: "center", border: 0, padding: 0, background: "transparent", lineHeight: 0, cursor: live.productLink ? "pointer" : "default" }}>
                <ItemThumbnail imageUrl={live.imageUrl} size={44} />
              </button>
              <button type="button" onClick={() => onOpenDetail(item)} style={{ minWidth: 0, flex: 1, border: 0, padding: 0, background: "transparent", textAlign: "left", cursor: "pointer" }}>
                <div style={{ fontSize: "14px", fontWeight: 800, color: wmsColors.ink, whiteSpace: "normal", overflow: "visible", wordBreak: "keep-all", lineHeight: 1.4 }}>
                  {live.name}
                </div>
                <div style={{ display: "inline-block", marginTop: "3px", padding: "2px 6px", borderRadius: "6px", background: wmsColors.surfaceBeige, fontSize: "12px", fontWeight: 800, color: "#3f4541", whiteSpace: "normal", wordBreak: "keep-all", lineHeight: 1.35 }}>
                  옵션 · {live.optionLabel || "옵션 없음"}
                </div>
                <div style={{ fontSize: "10px", color: wmsColors.muted }}>SKU {item.productCode}</div>
                <div style={{ marginTop: "3px", fontSize: "10px", fontWeight: 800, color: wmsColors.slateDark, whiteSpace: "normal", lineHeight: 1.35 }}>
                  {logisticsLabelsForItem(item).join(" / ")}
                </div>
              </button>
              <ProductLinkIconButton productLink={live.productLink} />
              <div style={{ fontSize: "13px", fontWeight: 700, flexShrink: 0 }}>
                {item.pickedQuantity} / {item.totalQuantity}개
              </div>
            </div>
          );
        })}
      </div>

      {/* "미처리 SKU만 선택"은 일괄처리 버튼 바로 위, 전체 너비로 배치한다(2026-08-19 6차
       *  실사용 테스트 반영) — 상단 선택 영역과 중복되지 않도록 여기 한 곳에만 둔다.
       *  이 영역 전체에 ref를 달아 일괄처리 직후 스크롤 위치를 이 자리 기준으로 복원한다
       *  (2026-08-20 신규, WmsPickingWaveDetailPage.applyBulkStatus 참고). */}
      <div ref={bulkAreaRef} style={{ position: "sticky", bottom: 0, zIndex: 20, padding: "8px", margin: "0 -8px", background: "rgba(255,255,255,.96)", borderTop: `1px solid ${wmsColors.border}` }}>
        <button
          onClick={selectUnprocessed}
          style={{ ...wmsSageButton, width: "100%", minHeight: "44px", fontSize: "13px", marginBottom: "8px" }}
        >
          미처리 SKU만 선택
        </button>

        <button type="button" onClick={onBulkVendorOrder} disabled={checkedProductCodes.size === 0 || bulkProcessing} style={{ ...wmsBronzeButton, width: "100%", minHeight: "44px", marginTop: "8px", opacity: checkedProductCodes.size ? 1 : .5 }}>
          선택 거래처발주서 이동 ({checkedProductCodes.size}개)
        </button>
        <button type="button" onClick={onBulkDiscontinue} disabled={checkedProductCodes.size === 0 || bulkProcessing} style={{ ...wmsWarnButton, width: "100%", minHeight: "44px", marginTop: "6px", opacity: checkedProductCodes.size ? 1 : .5 }}>
          선택 단종리스트 이동 ({checkedProductCodes.size}개)
        </button>
        <button type="button" onClick={onBulkDeleteImages} disabled={checkedProductCodes.size === 0 || bulkProcessing} style={{ ...wmsSecondaryButton, width: "100%", minHeight: "44px", marginTop: "6px", opacity: checkedProductCodes.size ? 1 : .5 }}>
          선택 이미지 삭제 ({checkedProductCodes.size}개)
        </button>
        {actionMessage && <p role="status" style={{ margin: "6px 0 0", fontSize: "11px", fontWeight: 700, color: actionMessage.includes("실패") || actionMessage.includes("제외") ? "#b42318" : wmsColors.greenDark }}>{actionMessage}</p>}
      </div>
    </div>
  );
}

/**
 * 피킹 목록 실제 맨 아래에 두는 다음 단계 작업 영역 (2026-08-19 2차 실사용 테스트 반영).
 * 목록을 끝까지 내려도 다음 업무 단계(부족분 거래처 발주서/발주확정)로 이동할 방법이 없다는
 * 문제를 해결한다. 발주확정/피킹결과확인의 실제 상태변경 로직은 완료 웨이브 화면(complete/page.tsx)에
 * 이미 있으므로 여기서 다시 만들지 않고, 그 화면으로 이동하는 실제 버튼만 둔다(재사용 우선).
 */
function PickingListBottomBar({ wave, items }: { wave: PickingWave; items: PickingWaveItem[] }) {
  const remainingCount = items.filter(item => item.status === "pending").length;
  const shortageItems = items.filter(item => item.shortageQuantity > 0);
  const shortageQuantity = shortageItems.reduce((sum, item) => sum + item.shortageQuantity, 0);
  const shortageVendorCount = new Set(shortageItems.map(item => item.vendorName || UNASSIGNED_VENDOR_NAME)).size;
  const completeHref = `/wms/picking/waves/${wave.id}/complete`;
  const vendorOrdersHref = `/wms/picking/waves/${wave.id}/vendor-orders`;

  const barStyle: CSSProperties = {
    marginTop: "20px",
    border: `1px solid ${wmsColors.border}`,
    borderRadius: "12px",
    padding: "14px",
    background: wmsColors.surfaceBeige,
  };

  if (wave.status === "in_progress" && remainingCount > 0) {
    return (
      <div style={barStyle}>
        <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 700, color: wmsColors.ink }}>
          남은 미처리 SKU {remainingCount}개
        </p>
        <button disabled style={{ ...wmsPrimaryButton, width: "100%", opacity: 0.4 }}>
          발주확정
        </button>
        <p style={{ margin: "8px 0 0", fontSize: "11px", color: wmsColors.muted }}>
          모든 SKU를 처리한 후 발주확정할 수 있습니다.
        </p>
        {shortageQuantity > 0 && (
          <a href={vendorOrdersHref} style={{ display: "block", textDecoration: "none", marginTop: "10px" }}>
            <button style={{ ...wmsSecondaryButton, width: "100%" }}>
              부족분 거래처 발주서 확인 (지금까지 {shortageVendorCount}건 · {shortageQuantity}개, 미리보기)
            </button>
          </a>
        )}
      </div>
    );
  }

  if (wave.status === "in_progress" || wave.status === "completed") {
    return (
      <div style={barStyle}>
        <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 700, color: wmsColors.ink }}>
          피킹 완료 — 예상 부족수량 {shortageQuantity}개
        </p>
        <a href={completeHref} style={{ textDecoration: "none" }}>
          <button style={{ ...wmsPrimaryButton, width: "100%" }}>피킹 결과 최종 확인하러 가기</button>
        </a>
      </div>
    );
  }

  // result_confirmed | order_confirmed
  return (
    <div style={barStyle}>
      {shortageQuantity > 0 ? (
        <>
          <p style={{ margin: "0 0 8px", fontSize: "12px", color: wmsColors.ink }}>
            부족 거래처 {shortageVendorCount}건 · 부족 SKU {shortageItems.length}개 · 총 부족수량 {shortageQuantity}개
          </p>
          <a href={vendorOrdersHref} style={{ textDecoration: "none" }}>
            <button style={{ ...wmsPrimaryButton, width: "100%", marginBottom: "8px" }}>부족분 거래처 발주서 생성/확인</button>
          </a>
        </>
      ) : (
        <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 700, color: wmsColors.greenDark }}>현재 부족분이 없습니다.</p>
      )}
      {wave.status === "result_confirmed" ? (
        <a href={completeHref} style={{ textDecoration: "none" }}>
          <button style={{ ...wmsSecondaryButton, width: "100%" }}>발주확정하러 가기</button>
        </a>
      ) : (
        <p style={{ margin: 0, fontSize: "12px", fontWeight: 700, color: wmsColors.greenDark, textAlign: "center" }}>발주확정 완료됨</p>
      )}
    </div>
  );
}

/** 아이템 상세 화면의 큰 대표이미지 — ItemThumbnail과 같은 onError → placeholder 전환 규칙을 쓴다. */
function DetailImage({ imageUrl, alt }: { imageUrl?: string; alt: string }) {
  const displaySrc = getWmsDisplayImageUrl(imageUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [displaySrc]);

  if (displaySrc && !failed) {
    return (
      <img
        src={displaySrc}
        alt={alt}
        onError={() => setFailed(true)}
        style={{ borderRadius: "12px", width: "min(220px, 52vw)", height: "min(220px, 52vw)", aspectRatio: "1 / 1", objectFit: "contain", margin: "0 auto", background: wmsColors.surfaceBeige }}
      />
    );
  }
  return (
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
      {displaySrc && failed ? "이미지 불러오기 실패" : "이미지 없음"}
    </div>
  );
}

/** 이미지 URL이 있어도 실제 로드가 실패하면(끊긴 링크, 접근 불가 등) 깨진 아이콘을 그대로
 *  보여주지 않고 "이미지 없음" placeholder로 전환한다 — onError는 1회만 반영하고 같은 URL로
 *  다시 재시도하지 않는다(2026-08-20 신규). imageUrl이 바뀌면(제품DB 새로고침 등) 실패 상태를
 *  초기화해 새 URL은 다시 시도한다. */
function ItemThumbnail({ imageUrl, size }: { imageUrl?: string; size: number }) {
  const displaySrc = getWmsDisplayImageUrl(imageUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [displaySrc]);

  if (displaySrc && !failed) {
    return (
      <img
        src={displaySrc}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
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
      {displaySrc && failed ? (
        <>
          이미지
          <br />
          실패
        </>
      ) : (
        <>
          이미지
          <br />
          없음
        </>
      )}
    </div>
  );
}

/** 이미지 클릭을 모르는 사용자를 위한 별도 "제품링크" 아이콘 버튼(2026-08-20 신규). */
function ProductLinkIconButton({ productLink }: { productLink?: string }) {
  return (
    <button
      type="button"
      onClick={event => {
        event.stopPropagation();
        if (productLink) openProductLinkPreview(productLink);
      }}
      disabled={!productLink}
      title={productLink ? "제품링크 열기" : "제품링크 미등록"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "30px",
        height: "30px",
        flexShrink: 0,
        borderRadius: "8px",
        border: `1px solid ${wmsColors.border}`,
        background: productLink ? "#ffffff" : wmsColors.surfaceBeige,
        color: productLink ? wmsColors.slateDark : wmsColors.muted,
        cursor: productLink ? "pointer" : "not-allowed",
        opacity: productLink ? 1 : 0.5,
      }}
    >
      <ExternalLinkIcon size={14} />
    </button>
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

function InfoTile({ label, value, highlight, muted, centered, prominent }: { label: string; value: string | number; highlight?: boolean; muted?: boolean; centered?: boolean; prominent?: boolean }) {
  return (
    <div style={{ background: wmsColors.surfaceBeige, borderRadius: "10px", padding: prominent ? "12px 10px" : "10px", textAlign: centered ? "center" : "left", display: centered ? "flex" : "block", flexDirection: centered ? "column" : undefined, alignItems: centered ? "center" : undefined, justifyContent: centered ? "center" : undefined, minWidth: 0 }}>
      <div style={{ width: "100%", color: wmsColors.muted, fontSize: prominent ? "12px" : "11px", textAlign: centered ? "center" : "left" }}>{label}</div>
      <div style={{ width: "100%", marginTop: prominent ? "4px" : 0, textAlign: centered ? "center" : "left", fontSize: prominent ? "28px" : muted ? "12px" : "17px", lineHeight: prominent ? 1 : undefined, fontWeight: prominent ? 900 : muted ? 500 : 800, color: muted ? wmsColors.muted : highlight ? wmsColors.warn : wmsColors.ink }}>
        {value}
      </div>
    </div>
  );
}
