"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import { recalculateAutoVendorOrderLines } from "@/lib/wms/vendor-order/recalculate";
import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraft, type VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import { buildBasketDisplayNames } from "@/lib/wms/picking-wave/basket-display";
import { PICKING_WAVE_STATUS_LABEL } from "@/lib/wms/picking-wave/status-label";
import { fetchLiveCatalogLookup, type LiveCatalogLookup } from "@/lib/wms/picking-wave/live-catalog";
import type { BasketAssignment, PickingWave, PickingWaveItem } from "@/lib/wms/picking-wave/types";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
import GenerateAllPoConfirmButton from "./GenerateAllPoConfirmButton";
import HanjinStepSequence from "./HanjinStepSequence";
import ShipmentWorkflowStepCard from "./ShipmentWorkflowStepCard";
import EditPickingResultsPanel from "./EditPickingResultsPanel";
import WmsExitNav from "../../WmsExitNav";
import RefreshCatalogButton from "../../RefreshCatalogButton";
import WaveIdentityEditor from "../../WaveIdentityEditor";

export default function WmsPickingWaveCompletePage({ params }: { params: { waveId: string } }) {
  const waveRepository = usePickingWaveRepository();
  const vendorOrderRepository = useVendorOrderRepository();

  const [wave, setWave] = useState<PickingWave | null>(null);
  const [items, setItems] = useState<PickingWaveItem[]>([]);
  const [baskets, setBaskets] = useState<BasketAssignment[]>([]);
  const [vendorLines, setVendorLines] = useState<VendorOrderDraftLine[]>([]);
  const [vendorDrafts, setVendorDrafts] = useState<VendorOrderDraft[]>([]);
  const [liveCatalogByProductCode, setLiveCatalogByProductCode] = useState<LiveCatalogLookup>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [confirmingResult, setConfirmingResult] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [orderLogisticsByPo, setOrderLogisticsByPo] = useState<Record<string, { fulfillmentCenter: string; expectedDate: string }>>({});
  const restoredScrollRef = useRef(false);
  const pagePositionKey = `noidb:wms:complete-position:${params.waveId}`;

  /** 카테고리/옵션명/대표이미지/거래처/창고번호/BOX번호/쿠팡바코드만 다시 불러온다 — 피킹 수량이나
   *  웨이브 진행상태는 건드리지 않는다 (2026-08-19 2차 실사용 테스트 반영). 구글시트(외부 네트워크)
   *  호출이라 항상 화면 진입용 reload()와 분리해서 별도로 호출한다 — 여기서 지연되거나 실패해도
   *  아래 reload()로 이미 불러온 웨이브/아이템 화면은 계속 정상 표시된다. */
  async function refreshCatalog() {
    setCatalogRefreshing(true);
    try {
      setLiveCatalogByProductCode(await fetchLiveCatalogLookup());
    } finally {
      setCatalogRefreshing(false);
    }
  }

  /** 웨이브/아이템/발주서 배정/거래처발주서 라인처럼 localStorage에서 즉시 읽히는 값만 불러온다.
   *  2026-08-19 3차 실사용 테스트에서 확인된 버그: 예전에는 이 함수가 구글시트 제품DB 조회
   *  (fetchLiveCatalogLookup)까지 같은 Promise.all에 묶어서, 그 네트워크 호출이 느려지거나
   *  응답이 없으면 로컬 데이터는 이미 다 있는데도 "불러오는 중..."에서 화면이 멈췄다. 이제
   *  로컬 데이터 로딩과 제품DB 새로고침을 완전히 분리해서, 로컬 데이터만으로 항상 loading을
   *  끝낸다(제품DB 조회가 느려도 화면 진입에는 영향 없음). */
  async function reload() {
    setLoadError(null);
    try {
      const [loadedWave, loadedItems, loadedBaskets, loadedLines, loadedDrafts] = await Promise.all([
        waveRepository.getWave(params.waveId),
        waveRepository.listItems(params.waveId),
        waveRepository.listBaskets(params.waveId),
        vendorOrderRepository.listLines(params.waveId),
        vendorOrderRepository.listDrafts(params.waveId),
      ]);
      setWave(loadedWave);
      setItems(loadedItems);
      setBaskets(loadedBaskets);
      setVendorLines(loadedLines);
      setVendorDrafts(loadedDrafts);
      if (!loadedWave) setLoadError("웨이브 정보를 찾을 수 없습니다.");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "웨이브 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    refreshCatalog();
    fetch("/api/wms/supplier-hub-orders?includePast=1", { cache: "no-store" })
      .then(response => response.json())
      .then(data => setOrderLogisticsByPo(Object.fromEntries((data.orders || []).map((order: { purchaseOrderNumber: string; fulfillmentCenter?: string; expectedDate?: string }) => [
        order.purchaseOrderNumber,
        { fulfillmentCenter: order.fulfillmentCenter || "", expectedDate: order.expectedDate || "" },
      ]))))
      .catch(() => setOrderLogisticsByPo({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.waveId]);

  useEffect(() => {
    const savePosition = () => sessionStorage.setItem(pagePositionKey, String(window.scrollY));
    window.addEventListener("pagehide", savePosition);
    window.addEventListener("beforeunload", savePosition);
    return () => {
      savePosition();
      window.removeEventListener("pagehide", savePosition);
      window.removeEventListener("beforeunload", savePosition);
    };
  }, [pagePositionKey]);

  useEffect(() => {
    if (loading || restoredScrollRef.current) return;
    restoredScrollRef.current = true;
    const savedPosition = Number(sessionStorage.getItem(pagePositionKey) || "0");
    if (savedPosition > 0) requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: savedPosition })));
  }, [loading, pagePositionKey]);

  /** 부족수량 기준 자동 부족분 라인만 다시 계산해 저장한다 — 수동 추가 라인은 그대로 둔다. */
  async function recalcVendorLines(currentItems: PickingWaveItem[]) {
    const now = new Date().toISOString();
    const recalculated = recalculateAutoVendorOrderLines(params.waveId, currentItems, vendorLines, now);
    await Promise.all(recalculated.removedLineIds.map(id => vendorOrderRepository.deleteLine(id)));
    await Promise.all(recalculated.lines.map(line => vendorOrderRepository.saveLine(line)));
    setVendorLines(recalculated.lines);
  }

  async function handleSaveEdit(updatedItems: PickingWaveItem[]) {
    await Promise.all(updatedItems.map(item => waveRepository.saveItem(item)));
    const nextItems = items.map(item => updatedItems.find(u => u.productCode === item.productCode) ?? item);
    setItems(nextItems);
    await recalcVendorLines(nextItems);
    setEditMode(false);
  }

  async function handleConfirmResult() {
    if (!wave) return;
    setConfirmingResult(true);
    try {
      await recalcVendorLines(items);
      const updatedWave: PickingWave = { ...wave, status: "result_confirmed", resultConfirmedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await waveRepository.saveWave(updatedWave);
      setWave(updatedWave);
    } finally {
      setConfirmingResult(false);
    }
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <p style={{ color: wmsColors.muted }}>불러오는 중...</p>
      </main>
    );
  }

  if (!wave || loadError) {
    return (
      <main style={pageStyle}>
        <WmsExitNav />
        <h1 style={{ fontSize: "18px" }}>통합 피킹 완료</h1>
        <p style={{ color: "#c0392b", fontWeight: 700 }}>{loadError || "웨이브 정보를 찾을 수 없습니다."}</p>
      </main>
    );
  }

  const totalQuantity = items.reduce((sum, item) => sum + item.totalQuantity, 0);
  const pickedQuantity = items.reduce((sum, item) => sum + item.pickedQuantity, 0);
  const shortageQuantity = items.reduce((sum, item) => sum + item.shortageQuantity, 0);
  const unlocatedCount = items.filter(item => item.locationStatus === "unlocated").length;
  const shortageItems = items.filter(item => item.shortageQuantity > 0);
  const shortageVendorCount = new Set(shortageItems.map(item => item.vendorName || UNASSIGNED_VENDOR_NAME)).size;

  // 부족분 거래처 발주서 상태 배지 (2026-08-19 신규) — 계산만 하고 어디에도 저장하지 않는다.
  let vendorOrderStatusText = "부족분 없음";
  if (shortageQuantity > 0) {
    if (vendorLines.length === 0) vendorOrderStatusText = "부족분 발주서 미생성";
    else {
      const touched = vendorLines.some(line => line.isManuallyAdded) || vendorDrafts.some(draft => draft.status !== "draft");
      vendorOrderStatusText = touched ? "부족분 발주서 수정됨" : "부족분 발주서 생성됨";
    }
  }

  // 발주서 완료 여부: 그 발주서를 포함하는 모든 아이템이 처리되었는지로 판단한다.
  const basketDisplayNames = buildBasketDisplayNames(baskets);
  const basketStatuses = baskets.map(basket => {
    const relatedItems = items.filter(item => item.sources.some(source => source.basketNumber === basket.basketNumber));
    const done = relatedItems.length > 0 && relatedItems.every(item => item.status !== "pending");
    return { ...basket, done };
  });

  const canEdit = wave.status === "completed" || wave.status === "result_confirmed";
  const reachedResultConfirm = wave.status === "result_confirmed" || wave.status === "order_confirmed";

  if (wave.status === "order_confirmed") {
    return (
      <main style={pageStyle}>
        <WmsExitNav />
        <div style={{ padding: "10px 0 14px" }}>
          <WaveIdentityEditor wave={wave} onSave={async updated => { await waveRepository.saveWave(updated); setWave(updated); }} />
          <p style={{ margin: "5px 0 0", color: wmsColors.greenDark, fontSize: "12px", fontWeight: 800 }}>
            발주확정 · 발주 {wave.sourcePurchaseOrderNumbers.length}건 · SKU {items.length}종 · 총수량 {totalQuantity}개
          </p>
        </div>

        <ShipmentWorkflowStepCard
          step={1}
          title="발주확정 파일 생성"
          subtitle="선택한 발주만 쿠팡 업로드용 XLSX 한 개로 생성"
          status="done"
        >
          <GenerateAllPoConfirmButton
            wave={wave}
            items={items}
            baskets={baskets}
            onWaveChange={async updatedWave => { await waveRepository.saveWave(updatedWave); setWave(updatedWave); }}
          />
        </ShipmentWorkflowStepCard>

        <HanjinStepSequence waveId={wave.id} baskets={baskets} items={items} />

        <details style={{ marginTop: "16px", border: `1px solid ${wmsColors.border}`, borderRadius: "10px", background: wmsColors.surfaceBeige }}>
          <summary style={{ cursor: "pointer", padding: "13px", fontSize: "13px", fontWeight: 800 }}>피킹 결과 보기</summary>
          <div style={{ padding: "0 13px 13px", fontSize: "12px", lineHeight: 1.7, color: wmsColors.muted }}>
            찾은 수량 {pickedQuantity}개 · 부족 {shortageQuantity}개 · 발주서 {basketStatuses.length}건
            <div style={{ marginTop: "8px" }}>
              {basketStatuses.map(basket => <div key={basket.basketNumber}>{basket.fulfillmentCenter || basketDisplayNames[basket.basketNumber] || "물류센터 미확인"} · 발주서 {basket.purchaseOrderNumber} · {basket.done ? "완료" : "미완료"}</div>)}
            </div>
          </div>
        </details>

        <a href="/wms/work-center" style={{ display: "block", textDecoration: "none", marginTop: "16px" }}>
          <button style={{ ...wmsGhostButton, width: "100%" }}>작업센터로</button>
        </a>
      </main>
    );
  }

  if (editMode) {
    return (
      <main style={pageStyle}>
        <WmsExitNav />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", margin: "0 0 4px" }}>
          <h1 style={{ fontSize: "18px", margin: 0 }}>피킹 내용 수정 — {wave.displayName || wave.id}</h1>
          <RefreshCatalogButton onClick={refreshCatalog} loading={catalogRefreshing} />
        </div>
        <EditPickingResultsPanel
          items={items}
          liveCatalogByProductCode={liveCatalogByProductCode}
          onCancel={() => setEditMode(false)}
          onSave={handleSaveEdit}
        />
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <WmsExitNav />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <RefreshCatalogButton onClick={refreshCatalog} loading={catalogRefreshing} />
      </div>
      <div style={{ textAlign: "center", padding: "16px 0" }}>
        <div style={{ fontSize: "40px" }}>✅</div>
        <WaveIdentityEditor wave={wave} onSave={async updated => { await waveRepository.saveWave(updated); setWave(updated); }} />
        <p style={{ color: wmsColors.muted, margin: "6px 0 0" }}>{PICKING_WAVE_STATUS_LABEL[wave.status]}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
        <SummaryTile label="전체 발주서 수" value={wave.sourcePurchaseOrderNumbers.length} />
        <SummaryTile label="전체 SKU 종류 수" value={items.length} />
        <SummaryTile label="전체 피킹 수량" value={totalQuantity} />
        <SummaryTile label="찾은 수량" value={pickedQuantity} />
        <SummaryTile label="부족 수량" value={shortageQuantity} highlight={shortageQuantity > 0} />
        <SummaryTile label="위치 미등록 SKU 수" value={unlocatedCount} highlight={unlocatedCount > 0} />
      </div>

      <details style={{ marginTop: "20px", border: `1px solid ${wmsColors.border}`, borderRadius: "10px", background: "#fff" }}>
        <summary style={{ cursor: "pointer", padding: "12px", fontSize: "14px", fontWeight: 800 }}>
          발주서별 완료 상태 · {basketStatuses.filter(item => item.done).length}/{basketStatuses.length}
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "0 10px 10px" }}>
          {basketStatuses.map(basket => (
            <div
              key={basket.basketNumber}
              style={{
                display: "flex",
                justifyContent: "space-between",
                border: `1px solid ${wmsColors.border}`,
                borderRadius: "8px",
                padding: "8px 12px",
                fontSize: "13px",
                background: basket.done ? wmsColors.greenSoft : "#ffffff",
              }}
            >
              <span>
                <strong>{orderLogisticsByPo[basket.purchaseOrderNumber]?.fulfillmentCenter || basket.fulfillmentCenter || basketDisplayNames[basket.basketNumber] || "물류센터 미확인"}</strong>
                {orderLogisticsByPo[basket.purchaseOrderNumber]?.expectedDate && (
                  <span style={{ color: wmsColors.greenDark, fontSize: "11px", fontWeight: 800 }}> · 입고예정일 {orderLogisticsByPo[basket.purchaseOrderNumber].expectedDate}</span>
                )}
                <span style={{ color: wmsColors.muted, fontSize: "11px" }}> (발주서 {basket.purchaseOrderNumber})</span>
                {basket.shipmentNumber ? ` / 쉽먼트 ${basket.shipmentNumber}` : ""}
              </span>
              <span style={{ fontWeight: 700, color: basket.done ? wmsColors.greenDark : wmsColors.muted }}>
                {basket.done ? "완료" : "미완료"}
              </span>
            </div>
          ))}
        </div>
      </details>

      {/* 1~3단계: 피킹 내용 수정 / 결과 최종 확인 */}
      <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
        {canEdit && (
          <button onClick={() => setEditMode(true)} style={{ ...wmsSecondaryButton, width: "100%" }}>
            피킹 내용 수정
          </button>
        )}
        {wave.status === "completed" && (
          <button onClick={handleConfirmResult} disabled={confirmingResult} style={{ ...wmsPrimaryButton, width: "100%", opacity: confirmingResult ? 0.6 : 1 }}>
            {confirmingResult ? "확인 처리 중..." : "피킹 결과 최종 확인"}
          </button>
        )}
      </div>

      {/* 4~6단계: 부족분 유무에 따른 다음 단계 */}
      {reachedResultConfirm && (
        <div style={{ marginTop: "16px" }}>
          {shortageQuantity > 0 ? (
            <div style={{ border: `2px solid ${wmsColors.warn}`, borderRadius: "12px", padding: "14px", background: wmsColors.warnSoft }}>
              <div style={{ fontSize: "12px", color: wmsColors.warn, fontWeight: 700, marginBottom: "6px" }}>{vendorOrderStatusText}</div>
              <div style={{ fontSize: "12px", color: wmsColors.ink, marginBottom: "10px" }}>
                부족분 거래처 발주서 {shortageVendorCount}건
                <br />
                부족 SKU {shortageItems.length}개 · 총 부족수량 {shortageQuantity}개
              </div>
              <a href={`/wms/picking/waves/${wave.id}/vendor-orders`} style={{ display: "block", textDecoration: "none" }}>
                <button style={{ ...wmsPrimaryButton, width: "100%" }}>
                  {vendorLines.length === 0 ? "부족분 거래처 발주서 생성" : "부족분 거래처 발주서 확인"}
                </button>
              </a>
            </div>
          ) : (
            <div style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "14px", background: wmsColors.greenSoft }}>
              <div style={{ fontSize: "12px", color: wmsColors.greenDark, fontWeight: 700, marginBottom: "6px" }}>현재 부족분이 없습니다.</div>
              <p style={{ fontSize: "12px", color: wmsColors.ink, margin: "0 0 10px" }}>부족분이 없습니다. 발주확정을 진행할 수 있습니다.</p>
              <a href={`/wms/picking/waves/${wave.id}/vendor-orders`} style={{ fontSize: "12px", color: wmsColors.muted }}>
                필요하면 수동으로 거래처 발주서 만들기 →
              </a>
            </div>
          )}
        </div>
      )}

      {reachedResultConfirm && (
        <div style={{ marginTop: "20px" }}>
          <ShipmentWorkflowStepCard
            step={1}
            title="발주확정 파일 생성"
            subtitle="선택한 발주만 쿠팡 업로드용 XLSX 한 개로 생성"
            status="current"
          >
            <GenerateAllPoConfirmButton
              wave={wave}
              items={items}
              baskets={baskets}
              onWaveChange={async updatedWave => {
                await waveRepository.saveWave(updatedWave);
                setWave(updatedWave);
              }}
            />
          </ShipmentWorkflowStepCard>

          <HanjinStepSequence waveId={wave.id} baskets={baskets} items={items} />
        </div>
      )}

      <a href="/wms/picking/waves" style={{ display: "block", textDecoration: "none", marginTop: "20px" }}>
        <button style={{ ...wmsGhostButton, width: "100%" }}>목록으로</button>
      </a>
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

function SummaryTile({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{ background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "14px", textAlign: "center" }}>
      <div style={{ fontSize: "22px", fontWeight: 800, color: highlight && value > 0 ? wmsColors.warn : wmsColors.ink }}>{value}</div>
      <div style={{ fontSize: "12px", color: wmsColors.muted, marginTop: "2px" }}>{label}</div>
    </div>
  );
}
