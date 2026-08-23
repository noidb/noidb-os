"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useWarehouseRepository } from "@/lib/warehouse/context";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { buildPickingWave, generateWaveId } from "@/lib/wms/picking-wave/build-wave";
import type { SupplierHubPurchaseOrder } from "@/lib/wms/supplier-hub-orders";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { PICKING_WAVE_STATUS_LABEL } from "@/lib/wms/picking-wave/status-label";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
import {
  buildScheduleChangeRecommendations,
  type ScheduleChangeRecommendation,
  type ScheduleRecommendationPriority,
} from "@/lib/wms/schedule-recommendation";
import {
  getScheduleRecommendationDecisions,
  setScheduleRecommendationDecision,
  type ScheduleRecommendationDecision,
} from "@/lib/wms/schedule-recommendation-decisions";

/**
 * 통합 피킹(웨이브) 생성 화면. 실제 발주(서플라이어 허브 스냅샷)를 선택해 하나의 웨이브로 합친다.
 * 창고 위치(BOX)가 아직 없으므로 이번 스프린트는 모델명 중심 통합 피킹으로 만들어진다
 * (lib/wms/picking-wave/grouping.ts의 PICKING_GROUPING_MODE="model").
 */
export default function WmsPickingWavesPage() {
  const router = useRouter();
  const warehouseRepository = useWarehouseRepository();
  const waveRepository = usePickingWaveRepository();

  const [orders, setOrders] = useState<SupplierHubPurchaseOrder[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showByExpectedDate, setShowByExpectedDate] = useState(false);
  const [existingWaves, setExistingWaves] = useState<PickingWave[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingLabels, setCreatingLabels] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);

  const [editingWaveId, setEditingWaveId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSelectedOrders, setEditSelectedOrders] = useState<Set<string>>(new Set());
  const [editCompositionLocked, setEditCompositionLocked] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function refreshWaves() {
    const list = await waveRepository.listWaves();
    setExistingWaves(list);
    return list;
  }

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/wms/supplier-hub-orders", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) {
          setOrdersError(data.error || "발주서를 불러오지 못했습니다.");
          return;
        }
        const items = data.orders as SupplierHubPurchaseOrder[];
        setOrders(items);
        const query = new URLSearchParams(window.location.search);
        const onlyPo = query.get("onlyPo");
        const addPo = query.get("addPo");
        const targetWaveId = query.get("targetWave");
        setSelected(onlyPo ? new Set(items.filter(order => order.purchaseOrderNumber === onlyPo).map(order => order.purchaseOrderNumber)) : new Set(items.map(order => order.purchaseOrderNumber)));

        const waves = await refreshWaves();
        if (addPo && targetWaveId) {
          const targetWave = waves.find(wave => wave.id === targetWaveId && wave.status === "in_progress");
          if (targetWave) {
            const waveItems = await waveRepository.listItems(targetWave.id);
            const compositionLocked = waveItems.some(item => item.status !== "pending");
            setEditingWaveId(targetWave.id);
            setEditName(targetWave.displayName || "");
            setEditSelectedOrders(new Set([...targetWave.sourcePurchaseOrderNumbers, addPo]));
            setEditCompositionLocked(compositionLocked);
            setEditError(compositionLocked ? "기존 피킹 기록은 그대로 보존하고 새 발주서 수량만 추가됩니다. 구성을 확인한 뒤 저장해주세요." : null);
          }
        }
      } catch {
        setOrdersError("발주서를 불러오지 못했습니다.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveRepository]);

  const selectedOrders = useMemo(
    () => (orders ?? []).filter(order => selected.has(order.purchaseOrderNumber)),
    [orders, selected]
  );

  const ordersByExpectedDate = useMemo(() => {
    const grouped = new Map<string, SupplierHubPurchaseOrder[]>();
    for (const order of orders ?? []) {
      const expectedDate = order.expectedDate?.trim() || "입고예정일 미정";
      const dateOrders = grouped.get(expectedDate) ?? [];
      dateOrders.push(order);
      grouped.set(expectedDate, dateOrders);
    }
    return [...grouped.entries()].sort(([dateA], [dateB]) => {
      if (dateA === "입고예정일 미정") return 1;
      if (dateB === "입고예정일 미정") return -1;
      return dateA.localeCompare(dateB);
    });
  }, [orders]);

  const duplicateInProgressWave = useMemo(() => {
    if (selectedOrders.length === 0) return null;
    const selectedSet = new Set(selectedOrders.map(order => order.purchaseOrderNumber));
    return (
      existingWaves.find(wave => {
        if (wave.status !== "in_progress") return false;
        if (wave.sourcePurchaseOrderNumbers.length !== selectedSet.size) return false;
        return wave.sourcePurchaseOrderNumbers.every(po => selectedSet.has(po));
      }) || null
    );
  }, [existingWaves, selectedOrders]);

  const scheduleRecommendations = useMemo(
    () => buildScheduleChangeRecommendations(orders ?? []),
    [orders]
  );

  const [previewCatalogConfigured, setPreviewCatalogConfigured] = useState(true);
  const [previewSummary, setPreviewSummary] = useState<{
    poCount: number;
    skuCount: number;
    totalQuantity: number;
    byFulfillmentCenter: Record<string, number>;
    locatedCount: number;
    unlocatedCount: number;
  } | null>(null);

  useEffect(() => {
    if (selectedOrders.length === 0) {
      setPreviewSummary(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const [catalogRes, zones, shelves, boxes, modelLocations, skuExceptions] = await Promise.all([
        fetch("/api/wms/product-catalog", { cache: "no-store" }).then(res => res.json()),
        warehouseRepository.listZones(),
        warehouseRepository.listShelves(),
        warehouseRepository.listBoxes(),
        warehouseRepository.listModelLocations(),
        warehouseRepository.listSkuExceptions(),
      ]);
      if (cancelled) return;

      const { items } = buildPickingWave({
        waveId: "PREVIEW",
        orders: selectedOrders,
        catalog: { configured: Boolean(catalogRes.configured), items: catalogRes.items || [] },
        warehouse: { zones, shelves, boxes, modelLocations, skuExceptions },
        now: new Date().toISOString(),
      });

      const byFulfillmentCenter: Record<string, number> = {};
      for (const order of selectedOrders) {
        byFulfillmentCenter[order.fulfillmentCenter] = (byFulfillmentCenter[order.fulfillmentCenter] || 0) + 1;
      }

      setPreviewCatalogConfigured(Boolean(catalogRes.configured));
      setPreviewSummary({
        poCount: selectedOrders.length,
        skuCount: items.length,
        totalQuantity: items.reduce((sum, item) => sum + item.totalQuantity, 0),
        byFulfillmentCenter,
        locatedCount: items.filter(item => item.locationStatus === "located").length,
        unlocatedCount: items.filter(item => item.locationStatus === "unlocated").length,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedOrders, warehouseRepository]);

  function toggleOrder(poNumber: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(poNumber)) next.delete(poNumber);
      else next.add(poNumber);
      return next;
    });
  }

  async function handleCreate() {
    if (selectedOrders.length === 0) return;
    setCreating(true);
    setCreateError(null);
    try {
      const [catalogRes, zones, shelves, boxes, modelLocations, skuExceptions] = await Promise.all([
        fetch("/api/wms/product-catalog", { cache: "no-store" }).then(res => res.json()),
        warehouseRepository.listZones(),
        warehouseRepository.listShelves(),
        warehouseRepository.listBoxes(),
        warehouseRepository.listModelLocations(),
        warehouseRepository.listSkuExceptions(),
      ]);

      const waves = await waveRepository.listWaves();
      const now = new Date().toISOString();
      const waveId = generateWaveId(waves.map(wave => wave.id), now);

      const { wave, items, baskets } = buildPickingWave({
        waveId,
        orders: selectedOrders,
        catalog: { configured: Boolean(catalogRes.configured), items: catalogRes.items || [] },
        warehouse: { zones, shelves, boxes, modelLocations, skuExceptions },
        now,
      });

      await waveRepository.saveWave(wave);
      await Promise.all(items.map(item => waveRepository.saveItem(item)));
      await Promise.all(baskets.map(basket => waveRepository.saveBasket(basket)));

      router.push(`/wms/picking/waves/${waveId}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "통합 피킹 작업 생성 중 오류가 발생했습니다.");
      setCreating(false);
    }
  }

  function selectOnlyExpectedDate(dateOrders: SupplierHubPurchaseOrder[]) {
    setSelected(new Set(dateOrders.map(order => order.purchaseOrderNumber)));
  }

  async function handleCreateCenterLabels() {
    if (selectedOrders.length === 0 || creatingLabels) return;
    setCreatingLabels(true);
    setLabelError(null);
    try {
      const response = await fetch("/api/wms/fulfillment-center-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orders: selectedOrders.map(order => ({
            purchaseOrderNumber: order.purchaseOrderNumber,
            fulfillmentCenter: order.fulfillmentCenter,
            expectedDate: order.expectedDate,
            items: order.items,
          })),
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "물류센터 라벨 파일 생성에 실패했습니다.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const fileName = encodedName ? decodeURIComponent(encodedName) : "물류센터_바구니라벨.xlsx";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setLabelError(error instanceof Error ? error.message : "물류센터 라벨 파일 생성에 실패했습니다.");
    } finally {
      setCreatingLabels(false);
    }
  }

  async function openEditWave(wave: PickingWave) {
    setEditingWaveId(wave.id);
    setEditName(wave.displayName || "");
    setEditSelectedOrders(new Set(wave.sourcePurchaseOrderNumbers));
    setEditError(null);
    const waveItems = await waveRepository.listItems(wave.id);
    setEditCompositionLocked(waveItems.some(item => item.status !== "pending"));
  }

  function closeEditWave() {
    setEditingWaveId(null);
    setEditError(null);
  }

  function toggleEditOrder(poNumber: string) {
    setEditSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(poNumber)) next.delete(poNumber);
      else next.add(poNumber);
      return next;
    });
  }

  async function saveEditWave() {
    if (!editingWaveId) return;
    const targetWave = existingWaves.find(wave => wave.id === editingWaveId);
    if (!targetWave) return;

    setEditSaving(true);
    setEditError(null);
    try {
      const now = new Date().toISOString();
      const originalSet = new Set(targetWave.sourcePurchaseOrderNumbers);
      const addedPoNumbers = [...editSelectedOrders].filter(po => !originalSet.has(po));
      const removedPoNumbers = [...originalSet].filter(po => !editSelectedOrders.has(po));

      // 피킹이 이미 시작된 웨이브는 기존 발주서/진행기록을 제거하지 않는다. 새 발주서 추가만
      // 허용하고 기존 아이템의 찾은수량·상태를 보존한 채 새 요청수량을 합친다.
      if (editCompositionLocked && addedPoNumbers.length > 0) {
        if (removedPoNumbers.length > 0) {
          setEditError("피킹이 시작된 웨이브에서는 기존 발주서를 제거할 수 없습니다. 새 발주서 추가만 가능합니다.");
          return;
        }
        const addedOrders = (orders ?? []).filter(order => addedPoNumbers.includes(order.purchaseOrderNumber));
        if (addedOrders.length !== addedPoNumbers.length) {
          setEditError("추가할 발주서 정보를 찾지 못했습니다. 발주서를 다시 업데이트해주세요.");
          return;
        }
        const [catalogRes, zones, shelves, boxes, modelLocations, skuExceptions, oldItems, oldBaskets] = await Promise.all([
          fetch("/api/wms/product-catalog", { cache: "no-store" }).then(res => res.json()),
          warehouseRepository.listZones(),
          warehouseRepository.listShelves(),
          warehouseRepository.listBoxes(),
          warehouseRepository.listModelLocations(),
          warehouseRepository.listSkuExceptions(),
          waveRepository.listItems(editingWaveId),
          waveRepository.listBaskets(editingWaveId),
        ]);
        const appended = buildPickingWave({
          waveId: editingWaveId,
          orders: addedOrders,
          catalog: { configured: Boolean(catalogRes.configured), items: catalogRes.items || [] },
          warehouse: { zones, shelves, boxes, modelLocations, skuExceptions },
          now,
        });
        const nextBasketStart = oldBaskets.reduce((max, basket) => Math.max(max, Number(basket.basketNumber) || 0), 0) + 1;
        const basketNumberMap = new Map<string, string>();
        appended.baskets.forEach((basket, index) => basketNumberMap.set(basket.basketNumber, String(nextBasketStart + index)));
        await Promise.all(appended.baskets.map(basket => waveRepository.saveBasket({ ...basket, basketNumber: basketNumberMap.get(basket.basketNumber)! })));

        const oldByCode = new Map(oldItems.map(item => [item.productCode, item]));
        const affectedGroupIds = new Set<string>();
        for (const newItem of appended.items) {
          const adjustedSources = newItem.sources.map(source => ({ ...source, basketNumber: basketNumberMap.get(source.basketNumber)! }));
          const existing = oldByCode.get(newItem.productCode);
          const merged = existing
            ? { ...existing, totalQuantity: existing.totalQuantity + newItem.totalQuantity, sources: [...existing.sources, ...adjustedSources], status: "pending" as const, updatedAt: now }
            : { ...newItem, sources: adjustedSources };
          affectedGroupIds.add(`model:${merged.modelName || merged.productCode}`);
          await waveRepository.saveItem(merged);
        }
        await waveRepository.saveWave({
          ...targetWave,
          displayName: editName.trim() || undefined,
          sourcePurchaseOrderNumbers: [...targetWave.sourcePurchaseOrderNumbers, ...addedPoNumbers],
          completedGroupIds: targetWave.completedGroupIds.filter(id => !affectedGroupIds.has(id)),
          updatedAt: now,
        });
        await refreshWaves();
        setEditingWaveId(null);
        return;
      }

      const compositionChanged =
        !editCompositionLocked &&
        (editSelectedOrders.size !== originalSet.size || [...editSelectedOrders].some(po => !originalSet.has(po)));

      if (compositionChanged) {
        if (editSelectedOrders.size === 0) {
          setEditError("연결된 발주서를 최소 1건 이상 선택해주세요.");
          setEditSaving(false);
          return;
        }
        const newSelectedOrders = (orders ?? []).filter(order => editSelectedOrders.has(order.purchaseOrderNumber));
        const [catalogRes, zones, shelves, boxes, modelLocations, skuExceptions] = await Promise.all([
          fetch("/api/wms/product-catalog", { cache: "no-store" }).then(res => res.json()),
          warehouseRepository.listZones(),
          warehouseRepository.listShelves(),
          warehouseRepository.listBoxes(),
          warehouseRepository.listModelLocations(),
          warehouseRepository.listSkuExceptions(),
        ]);

        const { items: newItems, baskets: newBaskets } = buildPickingWave({
          waveId: editingWaveId,
          orders: newSelectedOrders,
          catalog: { configured: Boolean(catalogRes.configured), items: catalogRes.items || [] },
          warehouse: { zones, shelves, boxes, modelLocations, skuExceptions },
          now,
        });

        const [oldItems, oldBaskets] = await Promise.all([
          waveRepository.listItems(editingWaveId),
          waveRepository.listBaskets(editingWaveId),
        ]);
        await Promise.all(oldItems.map(item => waveRepository.deleteItem(item.id)));
        await Promise.all(oldBaskets.map(basket => waveRepository.deleteBasket(editingWaveId, basket.basketNumber)));
        await Promise.all(newItems.map(item => waveRepository.saveItem(item)));
        await Promise.all(newBaskets.map(basket => waveRepository.saveBasket(basket)));

        await waveRepository.saveWave({
          ...targetWave,
          displayName: editName.trim() || undefined,
          sourcePurchaseOrderNumbers: newSelectedOrders.map(order => order.purchaseOrderNumber),
          completedGroupIds: [],
          updatedAt: now,
        });
      } else {
        await waveRepository.saveWave({ ...targetWave, displayName: editName.trim() || undefined, updatedAt: now });
      }

      await refreshWaves();
      setEditingWaveId(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "웨이브 수정 중 오류가 발생했습니다.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteWave(wave: PickingWave) {
    const confirmed = window.confirm(
      `${wave.displayName || wave.id} 웨이브를 삭제할까요?\n연결된 발주서 원본과 다른 웨이브에는 영향이 없습니다. 이 작업은 되돌릴 수 없습니다.`
    );
    if (!confirmed) return;
    await waveRepository.deleteWave(wave.id);
    await refreshWaves();
  }

  return (
    <main
      style={{
        maxWidth: WMS_MOBILE_WIDTH,
        margin: "0 auto",
        padding: "12px 12px calc(12px + env(safe-area-inset-bottom))",
        fontFamily: "sans-serif",
        background: wmsColors.background,
        color: wmsColors.ink,
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: "22px", margin: "0 0 4px" }}>통합 피킹 작업 생성</h1>
      <p style={{ fontSize: "13px", color: wmsColors.muted, margin: "0 0 16px" }}>
        실제 발주 여러 건의 SKU를 합쳐 카테고리 → 모델명 → SKU 순서로 통합 피킹합니다. (창고 위치가 등록되면
        구역 → 선반 → BOX 순서로 자동 전환됩니다)
      </p>

      {ordersError && <p style={{ color: "#c0392b", fontSize: "13px" }}>{ordersError}</p>}
      {!ordersError && orders === null && <p style={{ fontSize: "13px", color: wmsColors.muted }}>발주서를 불러오는 중...</p>}
      {!ordersError && orders !== null && orders.length === 0 && (
        <p style={{ fontSize: "13px", color: wmsColors.muted }}>표시할 실제 발주가 없습니다.</p>
      )}

      {orders && orders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
          <button
            type="button"
            aria-pressed={showByExpectedDate}
            onClick={() => setShowByExpectedDate(value => !value)}
            style={{
              ...wmsSecondaryButton,
              width: "100%",
              minHeight: "38px",
              background: showByExpectedDate ? wmsColors.surfaceBeige : "#ffffff",
            }}
          >
            {showByExpectedDate ? "기본 목록으로 보기" : "입고예정일별 보기"}
          </button>

          {showByExpectedDate
            ? ordersByExpectedDate.map(([expectedDate, dateOrders]) => (
                <section key={expectedDate} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      padding: "6px 2px 0",
                    }}
                  >
                    <div style={{ fontSize: "13px", fontWeight: 800 }}>
                      {expectedDate} <span style={{ color: wmsColors.muted, fontSize: "11px" }}>{dateOrders.length}건</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => selectOnlyExpectedDate(dateOrders)}
                      style={{ ...wmsSecondaryButton, minHeight: "30px", padding: "5px 10px", fontSize: "11px" }}
                    >
                      이 날짜 전체선택
                    </button>
                  </div>
                  {dateOrders.map(order => (
                    <PurchaseOrderCheckbox
                      key={order.purchaseOrderNumber}
                      order={order}
                      checked={selected.has(order.purchaseOrderNumber)}
                      onToggle={toggleOrder}
                    />
                  ))}
                </section>
              ))
            : orders.map(order => (
                <PurchaseOrderCheckbox
                  key={order.purchaseOrderNumber}
                  order={order}
                  checked={selected.has(order.purchaseOrderNumber)}
                  onToggle={toggleOrder}
                />
              ))}
        </div>
      )}

      {scheduleRecommendations.length > 0 && (
        <ScheduleRecommendationCard recommendations={scheduleRecommendations} />
      )}

      {previewSummary && (
        <div
          style={{
            border: `1px solid ${wmsColors.border}`,
            borderRadius: "12px",
            padding: "14px",
            marginBottom: "16px",
            background: wmsColors.surfaceBeige,
          }}
        >
          <h2 style={{ margin: "0 0 10px", fontSize: "14px" }}>생성 미리보기</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", textAlign: "center", marginBottom: "10px" }}>
            <SummaryTile label="총 발주서 수" value={previewSummary.poCount} />
            <SummaryTile label="총 SKU 종류 수" value={previewSummary.skuCount} />
            <SummaryTile label="총 피킹 수량" value={previewSummary.totalQuantity} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px", textAlign: "center" }}>
            <SummaryTile label="위치 등록 SKU 수" value={previewSummary.locatedCount} />
            <SummaryTile label="위치 미등록 SKU 수" value={previewSummary.unlocatedCount} highlight />
          </div>
          <div style={{ marginTop: "10px", fontSize: "12px", color: wmsColors.muted }}>
            물류센터별 건수:{" "}
            {Object.entries(previewSummary.byFulfillmentCenter)
              .map(([center, count]) => `${center} ${count}건`)
              .join(" · ")}
          </div>
          {!previewCatalogConfigured && (
            <p style={{ marginTop: "8px", fontSize: "12px", color: wmsColors.warn }}>
              제품DB(구글시트)가 아직 연결되지 않아 카테고리/모델명을 찾을 수 없습니다 — 모든 SKU가
              "위치 미등록·미분류"로 표시됩니다.
            </p>
          )}
        </div>
      )}

      {duplicateInProgressWave && (
        <p style={{ fontSize: "12px", color: wmsColors.warn, background: wmsColors.warnSoft, borderRadius: "8px", padding: "8px 10px", marginBottom: "10px" }}>
          동일한 발주 조합의 진행중 웨이브가 이미 있습니다:{" "}
          <a href={`/wms/picking/waves/${duplicateInProgressWave.id}`} style={{ color: wmsColors.warn, fontWeight: 700 }}>
            {duplicateInProgressWave.displayName || duplicateInProgressWave.id}
          </a>
          . 그래도 새로 만들 수는 있지만, 먼저 기존 웨이브를 이어서 진행하는 걸 권장합니다.
        </p>
      )}

      {createError && <p style={{ color: "#c0392b", fontSize: "13px" }}>{createError}</p>}

      <button
        onClick={handleCreateCenterLabels}
        disabled={selectedOrders.length === 0 || creatingLabels}
        style={{ ...wmsSecondaryButton, width: "100%", marginBottom: "8px", opacity: selectedOrders.length === 0 || creatingLabels ? 0.5 : 1 }}
      >
        {creatingLabels ? "라벨 파일 생성 중..." : "물류센터 라벨 생성"}
      </button>
      {labelError && <p style={{ color: "#c0392b", fontSize: "12px", marginTop: 0 }}>{labelError}</p>}

      <button
        onClick={handleCreate}
        disabled={selectedOrders.length === 0 || creating}
        style={{ ...wmsPrimaryButton, width: "100%", opacity: selectedOrders.length === 0 || creating ? 0.5 : 1 }}
      >
        {creating ? "생성 중..." : "통합 피킹 작업 생성"}
      </button>

      {existingWaves.length > 0 && (
        <div style={{ marginTop: "24px" }}>
          <h2 style={{ fontSize: "14px", margin: "0 0 8px" }}>기존 웨이브</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {existingWaves.map(wave => {
              const isEditing = editingWaveId === wave.id;
              return (
                <div key={wave.id} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "10px 12px", background: "#ffffff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                    <a href={`/wms/picking/waves/${wave.id}`} style={{ color: wmsColors.ink, textDecoration: "none", fontWeight: 700, fontSize: "13px", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {wave.displayName || wave.id}
                    </a>
                    <span style={{ fontSize: "11px", color: wmsColors.muted, flexShrink: 0 }}>
                      {PICKING_WAVE_STATUS_LABEL[wave.status]}
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: wmsColors.muted, margin: "2px 0 8px" }}>
                    {wave.id} · 발주서 {wave.sourcePurchaseOrderNumbers.length}건
                  </div>

                  {!isEditing ? (
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => openEditWave(wave)} style={{ ...wmsSecondaryButton, minHeight: "30px", fontSize: "11px", flex: 1 }}>
                        수정
                      </button>
                      <button onClick={() => handleDeleteWave(wave)} style={{ ...wmsGhostButton, minHeight: "30px", fontSize: "11px", flex: 1, color: "#c0392b" }}>
                        삭제
                      </button>
                    </div>
                  ) : (
                    <div style={{ borderTop: `1px dashed ${wmsColors.border}`, paddingTop: "8px" }}>
                      <label style={{ display: "block", fontSize: "11px", color: wmsColors.muted, marginBottom: "4px" }}>
                        표시 이름
                      </label>
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        placeholder={wave.id}
                        style={{ width: "100%", fontSize: "12px", padding: "6px 8px", borderRadius: "6px", border: `1px solid ${wmsColors.border}`, marginBottom: "8px" }}
                      />

                      <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "4px" }}>
                        연결된 발주서
                        {editCompositionLocked && " (피킹 진행기록 보존 — 기존 발주 제거 불가, 새 발주 추가 가능)"}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>
                        {(orders ?? [])
                          .filter(order => wave.sourcePurchaseOrderNumbers.includes(order.purchaseOrderNumber) || editSelectedOrders.has(order.purchaseOrderNumber) || !editCompositionLocked)
                          .map(order => (
                            <label key={order.purchaseOrderNumber} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
                              <input
                                type="checkbox"
                                disabled={editCompositionLocked}
                                checked={editSelectedOrders.has(order.purchaseOrderNumber)}
                                onChange={() => toggleEditOrder(order.purchaseOrderNumber)}
                              />
                              {order.purchaseOrderNumber} · {order.fulfillmentCenter}
                            </label>
                          ))}
                      </div>

                      {editError && <p style={{ color: "#c0392b", fontSize: "11px", marginBottom: "6px" }}>{editError}</p>}

                      <div style={{ display: "flex", gap: "6px" }}>
                        <button onClick={closeEditWave} style={{ ...wmsGhostButton, minHeight: "30px", fontSize: "11px", flex: 1 }}>
                          취소
                        </button>
                        <button
                          onClick={saveEditWave}
                          disabled={editSaving}
                          style={{ ...wmsPrimaryButton, minHeight: "30px", fontSize: "11px", flex: 1, opacity: editSaving ? 0.6 : 1 }}
                        >
                          {editSaving ? "저장 중..." : "저장"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}

function PurchaseOrderCheckbox({
  order,
  checked,
  onToggle,
}: {
  order: SupplierHubPurchaseOrder;
  checked: boolean;
  onToggle: (purchaseOrderNumber: string) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        border: `1px solid ${wmsColors.border}`,
        borderRadius: "10px",
        padding: "10px 12px",
        background: "#ffffff",
      }}
    >
      <input type="checkbox" checked={checked} onChange={() => onToggle(order.purchaseOrderNumber)} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: "13px" }}>발주서 {order.purchaseOrderNumber}</div>
        <div style={{ fontSize: "11px", color: wmsColors.muted }}>
          {order.fulfillmentCenter} · 입고예정일 {order.expectedDate} · SKU {order.items.length}개
        </div>
      </div>
    </label>
  );
}

const PRIORITY_LABEL: Record<ScheduleRecommendationPriority, string> = {
  high: "높음",
  medium: "중간",
  low: "낮음",
};

const PRIORITY_COLOR: Record<ScheduleRecommendationPriority, { bg: string; text: string }> = {
  high: { bg: wmsColors.greenSoft, text: wmsColors.greenDark },
  medium: { bg: wmsColors.surfaceBeige, text: wmsColors.ink },
  low: { bg: "#ffffff", text: wmsColors.muted },
};

const DECISION_LABEL: Record<ScheduleRecommendationDecision, string> = {
  changed: "변경 완료",
  not_changed: "이번에는 변경 안 함",
  later: "나중에 확인",
};

/**
 * 입고예정일/물류센터 변경 "추천"만 보여주는 화면(카드). 추천을 눌러도 아무 것도 자동으로
 * 바뀌지 않는다 — 실제 변경은 사용자가 쿠팡 서플라이허브에서 직접 진행한다
 * (2026-08-19 사용자 확정, 자동 요청·자동 제출·Supplier Hub 변경 요청은 이번 스프린트 범위 밖).
 * 사용자가 어떤 선택을 하든(또는 아무 선택도 안 하든) 아래 통합 피킹 생성은 계속 진행할 수 있다.
 */
function ScheduleRecommendationCard({ recommendations }: { recommendations: ScheduleChangeRecommendation[] }) {
  const [decisions, setDecisions] = useState<Record<string, ScheduleRecommendationDecision>>({});

  useEffect(() => {
    setDecisions(getScheduleRecommendationDecisions());
  }, []);

  function decide(id: string, decision: ScheduleRecommendationDecision) {
    setDecisions(setScheduleRecommendationDecision(id, decision));
  }

  return (
    <div
      style={{
        border: `1px solid ${wmsColors.border}`,
        borderRadius: "12px",
        padding: "14px",
        marginBottom: "16px",
        background: "#ffffff",
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: "14px" }}>물류비 절감 추천</h2>
      <p style={{ margin: "0 0 12px", fontSize: "11px", color: wmsColors.muted }}>
        같은 SKU·거래처·물류센터·권역, 하루 이내 입고예정일을 기준으로 합배송 가능성을 분석한
        추천입니다. 자동으로 변경되지 않습니다 — 쿠팡에서 직접 변경할지, 이번엔 그대로 진행할지,
        나중에 다시 확인할지 아래에서 선택해주세요. 어떤 선택을 하든 통합 피킹은 계속 진행할 수
        있습니다.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {recommendations.map(rec => {
          const color = PRIORITY_COLOR[rec.priority];
          const decision = decisions[rec.id];
          return (
            <div
              key={rec.id}
              style={{
                border: `1px solid ${wmsColors.border}`,
                borderRadius: "10px",
                padding: "12px",
                background: wmsColors.surfaceBeige,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <strong style={{ fontSize: "13px" }}>
                  발주서 {rec.targetPurchaseOrderNumber} → {rec.anchorPurchaseOrderNumber}에 맞춰 변경
                </strong>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "999px",
                    background: color.bg,
                    color: color.text,
                  }}
                >
                  우선순위 {PRIORITY_LABEL[rec.priority]}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <div style={{ background: "#ffffff", borderRadius: "8px", padding: "8px", fontSize: "11px" }}>
                  <div style={{ color: wmsColors.muted, marginBottom: "2px" }}>현재 (발주서 {rec.targetPurchaseOrderNumber})</div>
                  <div>{rec.current.fulfillmentCenter}</div>
                  <div>입고예정일 {rec.current.expectedDate}</div>
                </div>
                <div style={{ background: "#ffffff", borderRadius: "8px", padding: "8px", fontSize: "11px" }}>
                  <div style={{ color: wmsColors.muted, marginBottom: "2px" }}>추천 (발주서 {rec.anchorPurchaseOrderNumber} 기준)</div>
                  <div>{rec.recommended.fulfillmentCenter}</div>
                  <div>입고예정일 {rec.recommended.expectedDate}</div>
                </div>
              </div>

              <p style={{ margin: "0 0 4px", fontSize: "11px", color: wmsColors.ink }}>변경 이유: {rec.reason}</p>

              <div style={{ margin: "0 0 4px", fontSize: "11px", color: wmsColors.ink }}>
                같이 출고 가능한 SKU ({rec.sharedSkus.length}종):{" "}
                {rec.sharedSkus.map(sku => sku.productName).join(", ")}
              </div>

              <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: wmsColors.muted, marginBottom: "8px" }}>
                <span>예상 합배송 수량 {rec.combinedShipQuantity}개</span>
                <span>예상 절감: {rec.savingsNote}</span>
              </div>

              {decision && (
                <p style={{ margin: "0 0 8px", fontSize: "11px", fontWeight: 700, color: wmsColors.greenDark }}>
                  선택됨: {DECISION_LABEL[decision]}
                </p>
              )}

              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <button
                  onClick={() => window.alert("쿠팡 서플라이허브(윙)에 직접 로그인해서 입고예정일/물류센터를 변경해주세요. 이 버튼은 자동으로 이동하거나 변경하지 않습니다.")}
                  style={{ ...wmsGhostButton, minHeight: "36px", padding: "0 10px", fontSize: "11px", flex: "none" }}
                >
                  직접 변경하러 가기
                </button>
                <button
                  onClick={() => decide(rec.id, "changed")}
                  style={{ ...wmsSecondaryButton, minHeight: "36px", padding: "0 10px", fontSize: "11px", flex: "none" }}
                >
                  변경 완료
                </button>
                <button
                  onClick={() => decide(rec.id, "not_changed")}
                  style={{ ...wmsGhostButton, minHeight: "36px", padding: "0 10px", fontSize: "11px", flex: "none" }}
                >
                  이번에는 변경 안 함
                </button>
                <button
                  onClick={() => decide(rec.id, "later")}
                  style={{ ...wmsGhostButton, minHeight: "36px", padding: "0 10px", fontSize: "11px", flex: "none" }}
                >
                  나중에 확인
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{ background: "#ffffff", border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "10px" }}>
      <div style={{ fontSize: "18px", fontWeight: 800, color: highlight && value > 0 ? wmsColors.warn : wmsColors.ink }}>{value}</div>
      <div style={{ fontSize: "11px", color: wmsColors.muted, marginTop: "2px" }}>{label}</div>
    </div>
  );
}
