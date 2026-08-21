"use client";

import { useState } from "react";
import WorkCenterMenuButton from "./WorkCenterMenuButton";
import { InboxIcon } from "../icons";
import { wmsColors, wmsGhostButton } from "@/lib/wms/ui-tokens";
import type { SupplierHubPurchaseOrder } from "@/lib/wms/supplier-hub-orders";
import type { ImportLatestResult } from "@/lib/wms/import-latest-purchase-orders";
import { cleanDisplayProductName } from "@/lib/wms/display-name";
import { buildScheduleChangeRecommendations, type ScheduleChangeRecommendation } from "@/lib/wms/schedule-recommendation";

/**
 * 작업센터 "신규발주서 업데이트" 버튼 + 접이식 목록 (2026-08-20 신규 — 기존
 * RealSupplierHubOrders의 "최신 발주서 불러오기"·목록 표시 로직을 그대로 재사용하되, 화면에
 * 처음 들어왔을 때는 목록을 숨기고 이 버튼을 눌러야만 조회·표시되도록 재구성했다. 실제 발주서
 * 조회/가져오기 API(/api/wms/supplier-hub-orders, /api/wms/import-latest-purchase-orders)는
 * 전혀 바꾸지 않았다 — 현재 프로젝트 폴더의 엑셀 파일을 읽는 기존 방식 그대로다.
 */
export default function NewPurchaseOrdersUpdateButton() {
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<SupplierHubPurchaseOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportLatestResult | null>(null);
  const [expandedPo, setExpandedPo] = useState<string | null>(null);

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

  async function handleClick() {
    if (importing) return; // 중복 클릭 방지
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
      setOpen(true);
    } catch {
      setImportError("최신 발주서를 불러오지 못했습니다.");
    } finally {
      setImporting(false);
    }
  }

  const newlyAddedSet = new Set(importResult?.addedPurchaseOrderNumbers ?? []);
  const updatedSet = new Set(importResult?.updatedPurchaseOrderNumbers ?? []);
  const recommendations = orders ? buildScheduleChangeRecommendations(orders) : [];
  const recommendationByTargetPo = new Map<string, ScheduleChangeRecommendation>();
  for (const rec of recommendations) {
    if (!recommendationByTargetPo.has(rec.targetPurchaseOrderNumber)) recommendationByTargetPo.set(rec.targetPurchaseOrderNumber, rec);
  }

  const label = importing ? "불러오는 중..." : "신규발주서 업데이트";

  return (
    <div>
      <WorkCenterMenuButton
        icon={<InboxIcon size={26} color={wmsColors.bronze} />}
        title={label}
        tint={wmsColors.bronzeSoft}
        borderTint={wmsColors.bronzeSoftBorder}
        textColor={wmsColors.bronze}
        onClick={handleClick}
        disabled={importing}
      />

      {importError && <p style={{ color: "#c0392b", fontSize: "11px", margin: "6px 2px 0" }}>{importError}</p>}

      {importResult && !open && (
        <p style={{ fontSize: "11px", color: wmsColors.muted, margin: "6px 2px 0" }}>
          신규 {importResult.addedPurchaseOrderNumbers.length}건 추가 · 변경 {importResult.updatedPurchaseOrderNumbers?.length ?? 0}건 업데이트 · 총 발주서 {importResult.totalPurchaseOrders}건 (목록 접힘)
        </p>
      )}

      {open && (
        <div style={{ marginTop: "10px", border: `1px solid ${wmsColors.border}`, borderRadius: "14px", padding: "14px", background: "#ffffff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <h2 style={{ margin: 0, fontSize: "14px" }}>신규 발주서 목록</h2>
            <button onClick={() => setOpen(false)} style={{ ...wmsGhostButton, minHeight: "28px", padding: "0 10px", fontSize: "11px" }}>
              목록 접기
            </button>
          </div>

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
                {(importResult.updatedPurchaseOrderNumbers?.length ?? 0) > 0 &&
                  ` · 입고예정일/물류센터 ${importResult.updatedPurchaseOrderNumbers.length}건 업데이트`}
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

          {orders !== null && (
            <div
              style={{
                border: `1px solid ${recommendations.length > 0 ? wmsColors.warn : wmsColors.border}`,
                background: recommendations.length > 0 ? wmsColors.warnSoft : wmsColors.surfaceBeige,
                borderRadius: "10px",
                padding: "10px 12px",
                marginBottom: "14px",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 800, color: recommendations.length > 0 ? wmsColors.warn : wmsColors.muted }}>
                {recommendations.length > 0 ? `발주 변경 확인 필요 ${recommendations.length}건` : "현재 입고예정일·물류센터 변경 확인 대상이 없습니다."}
              </div>
              {recommendations.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                  {recommendations.map(rec => (
                    <div key={rec.id} style={{ background: "#ffffff", borderRadius: "8px", padding: "8px 10px", fontSize: "11px" }}>
                      <div style={{ fontWeight: 700, marginBottom: "2px" }}>발주서 {rec.targetPurchaseOrderNumber}</div>
                      {rec.current.fulfillmentCenter !== rec.recommended.fulfillmentCenter && (
                        <div>물류센터: {rec.current.fulfillmentCenter} → {rec.recommended.fulfillmentCenter}</div>
                      )}
                      {rec.current.expectedDate !== rec.recommended.expectedDate && (
                        <div>입고예정일: {rec.current.expectedDate} → {rec.recommended.expectedDate}</div>
                      )}
                      <div style={{ color: wmsColors.muted, marginTop: "2px" }}>이유: {rec.reason}</div>
                    </div>
                  ))}
                </div>
              )}
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
                        {updatedSet.has(order.purchaseOrderNumber) && (
                          <span
                            style={{
                              marginLeft: "6px",
                              fontSize: "10px",
                              fontWeight: 800,
                              color: wmsColors.warn,
                            }}
                          >
                            일정 업데이트
                          </span>
                        )}
                      </strong>
                      <span style={{ fontSize: "11px", color: wmsColors.muted }}>{order.orderType}</span>
                    </div>

                    {recommendationByTargetPo.has(order.purchaseOrderNumber) && (() => {
                      const rec = recommendationByTargetPo.get(order.purchaseOrderNumber)!;
                      const centerChanged = rec.current.fulfillmentCenter !== rec.recommended.fulfillmentCenter;
                      const dateChanged = rec.current.expectedDate !== rec.recommended.expectedDate;
                      const badgeLabel = centerChanged && dateChanged ? "변경 확인 필요" : centerChanged ? "물류센터 변경대상" : "입고예정일 변경대상";
                      return (
                        <div style={{ marginBottom: "8px" }}>
                          <button
                            onClick={() => setExpandedPo(prev => (prev === order.purchaseOrderNumber ? null : order.purchaseOrderNumber))}
                            style={{
                              fontSize: "10px",
                              fontWeight: 800,
                              color: wmsColors.warn,
                              background: wmsColors.warnSoft,
                              border: "none",
                              borderRadius: "999px",
                              padding: "3px 8px",
                              cursor: "pointer",
                            }}
                          >
                            {badgeLabel} ▾
                          </button>
                          {expandedPo === order.purchaseOrderNumber && (
                            <div style={{ background: wmsColors.warnSoft, borderRadius: "8px", padding: "8px 10px", fontSize: "11px", marginTop: "4px" }}>
                              {centerChanged && <div>물류센터: {rec.current.fulfillmentCenter} → {rec.recommended.fulfillmentCenter}</div>}
                              {dateChanged && <div>입고예정일: {rec.current.expectedDate} → {rec.recommended.expectedDate}</div>}
                              <div style={{ color: wmsColors.muted, marginTop: "2px" }}>이유: {rec.reason}</div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

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
