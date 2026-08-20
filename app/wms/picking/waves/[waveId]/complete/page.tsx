"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import { recalculateAutoVendorOrderLines } from "@/lib/wms/vendor-order/recalculate";
import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraft, type VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import { buildBasketDisplayNames } from "@/lib/wms/picking-wave/basket-display";
import { PICKING_WAVE_STATUS_LABEL } from "@/lib/wms/picking-wave/status-label";
import { fetchLiveCatalogLookup, type LiveCatalogLookup } from "@/lib/wms/picking-wave/live-catalog";
import type { BasketAssignment, PickingWave, PickingWaveItem } from "@/lib/wms/picking-wave/types";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
import PoConfirmSection from "./PoConfirmSection";
import GenerateAllPoConfirmButton from "./GenerateAllPoConfirmButton";
import HanjinStepSequence from "./HanjinStepSequence";
import EditPickingResultsPanel from "./EditPickingResultsPanel";
import WmsExitNav from "../../WmsExitNav";
import RefreshCatalogButton from "../../RefreshCatalogButton";

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
  const [confirmingOrder, setConfirmingOrder] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);

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

  /** 웨이브/아이템/바구니/거래처발주서 라인처럼 localStorage에서 즉시 읽히는 값만 불러온다.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.waveId]);

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

  async function handleOrderConfirm() {
    if (!wave) return;
    const confirmed = window.confirm("발주확정 후에는 일반 피킹 수정이 제한됩니다. 진행하시겠습니까?");
    if (!confirmed) return;
    setConfirmingOrder(true);
    try {
      const now = new Date().toISOString();
      const updatedWave: PickingWave = { ...wave, status: "order_confirmed", orderConfirmedAt: now, updatedAt: now };
      await waveRepository.saveWave(updatedWave);
      setWave(updatedWave);
    } finally {
      setConfirmingOrder(false);
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

  // 바구니(발주서) 완료 여부: 그 발주서를 포함하는 모든 아이템이 처리되었는지로 판단한다.
  const basketDisplayNames = buildBasketDisplayNames(baskets);
  const basketStatuses = baskets.map(basket => {
    const relatedItems = items.filter(item => item.sources.some(source => source.basketNumber === basket.basketNumber));
    const done = relatedItems.length > 0 && relatedItems.every(item => item.status !== "pending");
    return { ...basket, done };
  });

  const canEdit = wave.status === "completed" || wave.status === "result_confirmed";
  const reachedResultConfirm = wave.status === "result_confirmed" || wave.status === "order_confirmed";

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
        <h1 style={{ fontSize: "20px", margin: "8px 0" }}>{wave.displayName || wave.id}</h1>
        <p style={{ color: wmsColors.muted, margin: 0 }}>
          {wave.id} · {PICKING_WAVE_STATUS_LABEL[wave.status]}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
        <SummaryTile label="전체 발주서 수" value={wave.sourcePurchaseOrderNumbers.length} />
        <SummaryTile label="전체 SKU 종류 수" value={items.length} />
        <SummaryTile label="전체 피킹 수량" value={totalQuantity} />
        <SummaryTile label="찾은 수량" value={pickedQuantity} />
        <SummaryTile label="부족 수량" value={shortageQuantity} highlight={shortageQuantity > 0} />
        <SummaryTile label="위치 미등록 SKU 수" value={unlocatedCount} highlight={unlocatedCount > 0} />
      </div>

      <div style={{ marginTop: "20px" }}>
        <h2 style={{ fontSize: "14px", margin: "0 0 8px" }}>바구니별 완료 상태</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
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
                <strong>{basketDisplayNames[basket.basketNumber] || `바구니 ${basket.basketNumber}`}</strong>
                <span style={{ color: wmsColors.muted, fontSize: "11px" }}> (발주서 {basket.purchaseOrderNumber})</span>
                {basket.shipmentNumber ? ` / 쉽먼트 ${basket.shipmentNumber}` : ""}
              </span>
              <span style={{ fontWeight: 700, color: basket.done ? wmsColors.greenDark : wmsColors.muted }}>
                {basket.done ? "완료" : "미완료"}
              </span>
            </div>
          ))}
        </div>
      </div>

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

      {/* 7단계: 최종 발주확정 미리보기 + 확정 */}
      {reachedResultConfirm && (
        <div style={{ marginTop: "20px" }}>
          <h2 style={{ fontSize: "14px", margin: "0 0 8px" }}>발주확정 미리보기 / 서류 생성</h2>
          <p style={{ fontSize: "11px", color: wmsColors.muted, margin: "0 0 10px" }}>
            발주서별로 실제 찾은 수량을 확인하고, 필요하면 확정수량을 직접 고친 뒤 서류를 생성하세요.
            원본 PO_FOR_CONFIRM 파일을 찾지 못하면 안내 메시지가 뜹니다 (lib/wms/data/po-for-confirm
            폴더에 넣어야 합니다). 외부 Supplier Hub에는 자동 업로드하지 않습니다 — 파일만 만들어집니다.
          </p>

          <GenerateAllPoConfirmButton wave={wave} items={items} />

          {wave.sourcePurchaseOrderNumbers.map(poNumber => {
            const basket = baskets.find(b => b.purchaseOrderNumber === poNumber);
            return <PoConfirmSection key={poNumber} purchaseOrderNumber={poNumber} fulfillmentCenter={basket?.fulfillmentCenter || "-"} items={items} />;
          })}

          {wave.status === "result_confirmed" && (
            <button onClick={handleOrderConfirm} disabled={confirmingOrder} style={{ ...wmsPrimaryButton, width: "100%", opacity: confirmingOrder ? 0.6 : 1 }}>
              {confirmingOrder ? "처리 중..." : "최종 발주확정"}
            </button>
          )}
          {wave.status === "order_confirmed" && (
            <p style={{ fontSize: "12px", color: wmsColors.greenDark, fontWeight: 700, textAlign: "center" }}>
              발주확정 완료됨 ({wave.orderConfirmedAt ? new Date(wave.orderConfirmedAt).toLocaleString("ko-KR") : ""})
            </p>
          )}

          <HanjinStepSequence waveId={wave.id} baskets={baskets} />
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
