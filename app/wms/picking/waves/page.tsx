"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useWarehouseRepository } from "@/lib/warehouse/context";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { buildPickingWave, generateWaveId } from "@/lib/wms/picking-wave/build-wave";
import type { SupplierHubPurchaseOrder } from "@/lib/wms/supplier-hub-orders";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";

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
  const [existingWaves, setExistingWaves] = useState<PickingWave[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
        setSelected(new Set(items.map(order => order.purchaseOrderNumber)));
      } catch {
        setOrdersError("발주서를 불러오지 못했습니다.");
      }
    })();
    waveRepository.listWaves().then(setExistingWaves);
  }, [waveRepository]);

  const selectedOrders = useMemo(
    () => (orders ?? []).filter(order => selected.has(order.purchaseOrderNumber)),
    [orders, selected]
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

  return (
    <main
      style={{
        maxWidth: WMS_MOBILE_WIDTH,
        margin: "0 auto",
        padding: "16px",
        fontFamily: "sans-serif",
        background: wmsColors.background,
        color: wmsColors.ink,
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: "20px", margin: "0 0 4px" }}>통합 피킹 작업 생성</h1>
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
          {orders.map(order => (
            <label
              key={order.purchaseOrderNumber}
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
              <input
                type="checkbox"
                checked={selected.has(order.purchaseOrderNumber)}
                onChange={() => toggleOrder(order.purchaseOrderNumber)}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "13px" }}>발주서 {order.purchaseOrderNumber}</div>
                <div style={{ fontSize: "11px", color: wmsColors.muted }}>
                  {order.fulfillmentCenter} · 입고예정일 {order.expectedDate} · SKU {order.items.length}개
                </div>
              </div>
            </label>
          ))}
        </div>
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

      {createError && <p style={{ color: "#c0392b", fontSize: "13px" }}>{createError}</p>}

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
            {existingWaves.map(wave => (
              <a
                key={wave.id}
                href={`/wms/picking/waves/${wave.id}`}
                style={{
                  ...wmsGhostButton,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  textDecoration: "none",
                }}
              >
                <span>{wave.id}</span>
                <span style={{ fontSize: "12px" }}>{wave.status === "completed" ? "완료" : "진행중"}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function SummaryTile({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{ background: "#ffffff", border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "10px" }}>
      <div style={{ fontSize: "18px", fontWeight: 800, color: highlight && value > 0 ? wmsColors.warn : wmsColors.ink }}>{value}</div>
      <div style={{ fontSize: "11px", color: wmsColors.muted, marginTop: "2px" }}>{label}</div>
    </div>
  );
}
