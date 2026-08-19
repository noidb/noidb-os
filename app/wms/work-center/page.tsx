"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SAMPLE_WORK_BATCHES,
  countBoxesInBatch,
  countOptionsInBatch,
  estimatePickingMinutes,
  type WorkBatch,
} from "@/lib/wms/picking-sample-data";
import { useWmsPickingFlow } from "@/lib/wms/picking-flow-context";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
import type { SupplierHubPurchaseOrder } from "@/lib/wms/supplier-hub-orders";
import type { ImportLatestResult } from "@/lib/wms/import-latest-purchase-orders";
import { cleanDisplayProductName } from "@/lib/wms/display-name";

function RealSupplierHubOrders() {
  const [orders, setOrders] = useState<SupplierHubPurchaseOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportLatestResult | null>(null);

  async function loadOrders() {
    try {
      const response = await fetch("/api/wms/supplier-hub-orders", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "발주서를 불러오지 못했습니다.");
        return;
      }
      setOrders(data.orders as SupplierHubPurchaseOrder[]);
      setError(null);
    } catch {
      setError("발주서를 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    loadOrders();
  }, []);

  async function handleImportLatest() {
    setImporting(true);
    setImportError(null);
    try {
      const response = await fetch("/api/wms/import-latest-purchase-orders", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setImportError(data.error || "최신 발주서를 불러오지 못했습니다.");
        return;
      }
      setImportResult(data as ImportLatestResult);
      await loadOrders();
    } catch {
      setImportError("최신 발주서를 불러오지 못했습니다.");
    } finally {
      setImporting(false);
    }
  }

  const newlyAddedSet = new Set(importResult?.addedPurchaseOrderNumbers ?? []);

  return (
    <div
      style={{
        border: `1px solid ${wmsColors.border}`,
        borderRadius: "14px",
        padding: "16px",
        marginBottom: "18px",
        background: "#ffffff",
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: "16px" }}>실제 발주 (서플라이어 허브)</h2>
      <p style={{ margin: "0 0 12px", fontSize: "12px", color: wmsColors.muted }}>
        {"lib/wms/data/incoming-purchase-orders"} 폴더에 넣은 실제 발주서 엑셀 파일을 읽기 전용으로 표시합니다.
        (자동 실시간 조회가 아니라, 파일을 넣어둔 시점 기준입니다)
      </p>

      <button
        onClick={handleImportLatest}
        disabled={importing}
        style={{ ...wmsSecondaryButton, width: "100%", marginBottom: "10px", opacity: importing ? 0.6 : 1 }}
      >
        {importing ? "불러오는 중..." : "최신 발주서 불러오기"}
      </button>

      {importError && <p style={{ color: "#c0392b", fontSize: "12px", margin: "0 0 10px" }}>{importError}</p>}

      {importResult && (
        <div
          style={{
            background: wmsColors.surfaceBeige,
            border: `1px solid ${wmsColors.border}`,
            borderRadius: "10px",
            padding: "10px 12px",
            marginBottom: "12px",
            fontSize: "12px",
          }}
        >
          <div style={{ marginBottom: "4px" }}>
            원본: {importResult.sourceFileName} · 신규 {importResult.addedPurchaseOrderNumbers.length}건 추가
            {importResult.skippedDuplicatePurchaseOrderNumbers.length > 0 &&
              ` · 중복 ${importResult.skippedDuplicatePurchaseOrderNumbers.length}건 건너뜀`}
          </div>
          <div style={{ display: "flex", gap: "14px", color: wmsColors.muted }}>
            <span>총 발주서 {importResult.totalPurchaseOrders}건</span>
            <span>총 SKU 종류 {importResult.totalSkuTypes}종</span>
            <span>총 수량 {importResult.totalQuantity}개</span>
          </div>
        </div>
      )}

      {error && <p style={{ color: "#c0392b", fontSize: "13px" }}>{error}</p>}
      {!error && orders === null && <p style={{ fontSize: "13px", color: wmsColors.muted }}>불러오는 중...</p>}
      {!error && orders !== null && orders.length === 0 && (
        <p style={{ fontSize: "13px", color: wmsColors.muted }}>
          아직 발주서 파일이 없습니다. {"lib/wms/data/incoming-purchase-orders"} 폴더에 엑셀 파일을 넣어주세요.
        </p>
      )}

      {orders && orders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {orders.map(order => {
            const totalQuantity = order.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
            return (
              <div key={order.purchaseOrderNumber} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "4px", marginBottom: "8px" }}>
                  <strong style={{ fontSize: "13px" }}>
                    발주서 {order.purchaseOrderNumber}
                    {newlyAddedSet.has(order.purchaseOrderNumber) && (
                      <span
                        style={{
                          marginLeft: "6px",
                          fontSize: "10px",
                          fontWeight: 800,
                          color: wmsColors.greenDark,
                          background: wmsColors.greenSoft,
                          borderRadius: "999px",
                          padding: "2px 7px",
                        }}
                      >
                        신규
                      </span>
                    )}
                  </strong>
                  <span style={{ fontSize: "11px", color: wmsColors.muted }}>{order.orderType}</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "5px", marginBottom: "5px" }}>
                  <HighlightTile label="물류센터" value={order.fulfillmentCenter} />
                  <HighlightTile label="SKU 개수" value={`${order.items.length}종`} />
                  <HighlightTile label="총수량" value={`${totalQuantity}개`} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "5px", marginBottom: "10px" }}>
                  <HighlightTile label="발주일" value={new Date(order.capturedAt).toLocaleDateString("ko-KR")} />
                  <HighlightTile label="입고예정일" value={order.expectedDate} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {order.items.map(item => (
                    <div
                      key={`${order.purchaseOrderNumber}-${item.lineNo}`}
                      style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "12px", padding: "4px 0", borderBottom: "1px solid #f2eee8" }}
                    >
                      <span style={{ whiteSpace: "normal", wordBreak: "keep-all", lineHeight: 1.4 }}>{cleanDisplayProductName(item.productName)}</span>
                      <span style={{ flexShrink: 0, fontWeight: 700 }}>{item.orderedQuantity}개</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HighlightTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.border}`, borderRadius: "8px", padding: "6px 6px", minWidth: 0 }}>
      <div style={{ fontSize: "10px", color: wmsColors.muted, marginBottom: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: "13px", fontWeight: 800, color: wmsColors.greenDark, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

export default function WmsWorkCenterPage() {
  const router = useRouter();
  const { activeBatch, progress, startPicking, resetFlow } = useWmsPickingFlow();

  const totalBoxes = SAMPLE_WORK_BATCHES.reduce((sum, batch) => sum + countBoxesInBatch(batch), 0);
  const totalSkus = SAMPLE_WORK_BATCHES.reduce((sum, batch) => sum + countOptionsInBatch(batch), 0);
  const totalMinutes = SAMPLE_WORK_BATCHES.reduce((sum, batch) => sum + estimatePickingMinutes(batch), 0);

  function handleStart(batch: WorkBatch) {
    startPicking(batch);
    router.push("/wms/picking");
  }

  function batchDoneCount(batch: WorkBatch): number {
    if (activeBatch?.id !== batch.id) return 0;
    return batch.boxes
      .flatMap(box => box.models.flatMap(model => model.options))
      .filter(option => progress[option.skuId] && progress[option.skuId].status !== "pending").length;
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
      <h1 style={{ fontSize: "20px", margin: "0 0 4px" }}>작업센터</h1>
      <p style={{ fontSize: "13px", color: wmsColors.muted, margin: "0 0 16px" }}>
        Sprint 3 — 샘플 데이터 기반 UI/흐름, 실제 저장 없음
      </p>

      <RealSupplierHubOrders />

      <a href="/wms/picking/waves" style={{ display: "block", textDecoration: "none", marginBottom: "18px" }}>
        <button style={{ ...wmsPrimaryButton, width: "100%" }}>통합 피킹 시작 (실제 발주 기준)</button>
      </a>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "8px",
          background: wmsColors.surfaceBeige,
          border: `1px solid ${wmsColors.border}`,
          borderRadius: "12px",
          padding: "14px",
          marginBottom: "18px",
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ fontSize: "20px", fontWeight: 800 }}>{SAMPLE_WORK_BATCHES.length}</div>
          <div style={{ fontSize: "11px", color: wmsColors.muted }}>오늘 작업</div>
        </div>
        <div>
          <div style={{ fontSize: "20px", fontWeight: 800 }}>{totalBoxes}</div>
          <div style={{ fontSize: "11px", color: wmsColors.muted }}>전체 BOX</div>
        </div>
        <div>
          <div style={{ fontSize: "20px", fontWeight: 800 }}>{totalSkus}</div>
          <div style={{ fontSize: "11px", color: wmsColors.muted }}>전체 SKU</div>
        </div>
      </div>
      <p style={{ fontSize: "12px", color: wmsColors.muted, marginTop: "-10px", marginBottom: "16px" }}>
        전체 예상 작업시간 약 {totalMinutes}분
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {SAMPLE_WORK_BATCHES.map(batch => {
          const isActive = activeBatch?.id === batch.id;
          const total = countOptionsInBatch(batch);
          const done = batchDoneCount(batch);
          const percent = total > 0 ? Math.round((done / total) * 100) : 0;

          return (
            <div
              key={batch.id}
              style={{
                border: isActive ? `2px solid ${wmsColors.green}` : `1px solid ${wmsColors.border}`,
                borderRadius: "14px",
                padding: "16px",
                background: isActive ? wmsColors.greenSoft : "#ffffff",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h2 style={{ margin: 0, fontSize: "19px" }}>{batch.center}</h2>
                {isActive && (
                  <span style={{ fontSize: "12px", fontWeight: 700, color: wmsColors.greenDark }}>진행 중</span>
                )}
              </div>
              <p style={{ margin: "6px 0 0", fontSize: "13px", color: wmsColors.muted }}>
                입고예정일 {batch.expectedDate}
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "6px",
                  margin: "12px 0",
                  fontSize: "12px",
                  color: wmsColors.muted,
                }}
              >
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: wmsColors.ink }}>{countBoxesInBatch(batch)}</div>
                  BOX
                </div>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: wmsColors.ink }}>{total}</div>
                  SKU
                </div>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: wmsColors.ink }}>{estimatePickingMinutes(batch)}분</div>
                  예상시간
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: wmsColors.muted, marginBottom: "4px" }}>
                  <span>진행률</span>
                  <span>
                    {done} / {total} ({percent}%)
                  </span>
                </div>
                <div style={{ height: "8px", borderRadius: "999px", background: wmsColors.surfaceBeige, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${percent}%`, background: wmsColors.green }} />
                </div>
              </div>

              <button onClick={() => handleStart(batch)} style={{ ...wmsPrimaryButton, width: "100%" }}>
                {isActive ? "피킹 계속하기" : "피킹 시작"}
              </button>
            </div>
          );
        })}
      </div>

      {activeBatch && (
        <button onClick={resetFlow} style={{ ...wmsGhostButton, width: "100%", marginTop: "20px" }}>
          작업 초기화 (진행 상태 리셋)
        </button>
      )}
    </main>
  );
}
