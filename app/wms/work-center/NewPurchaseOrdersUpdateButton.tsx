"use client";

import { useEffect, useRef, useState } from "react";
import WorkCenterMenuButton from "./WorkCenterMenuButton";
import { InboxIcon } from "../icons";
import { wmsColors, wmsGhostButton, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";
import type { SupplierHubPurchaseOrder } from "@/lib/wms/supplier-hub-orders";
import type { ImportLatestResult } from "@/lib/wms/import-latest-purchase-orders";
import { cleanDisplayProductName } from "@/lib/wms/display-name";
import { buildScheduleChangeRecommendations, type ScheduleChangeRecommendation } from "@/lib/wms/schedule-recommendation";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import type { PickingWave } from "@/lib/wms/picking-wave/types";

/**
 * 작업센터 "신규발주서 업데이트" 버튼 + 접이식 목록 (2026-08-20 신규 — 기존
 * RealSupplierHubOrders의 "최신 발주서 불러오기"·목록 표시 로직을 그대로 재사용하되, 화면에
 * 처음 들어왔을 때는 목록을 숨기고 이 버튼을 눌러야만 조회·표시되도록 재구성했다. 실제 발주서
 * 조회/가져오기 API(/api/wms/supplier-hub-orders, /api/wms/import-latest-purchase-orders)는
 * 전혀 바꾸지 않았다 — 현재 프로젝트 폴더의 엑셀 파일을 읽는 기존 방식 그대로다.
 */
export default function NewPurchaseOrdersUpdateButton() {
  const waveRepository = usePickingWaveRepository();
  const autoCheckedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<SupplierHubPurchaseOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportLatestResult | null>(null);
  const [expandedPo, setExpandedPo] = useState<string | null>(null);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [inProgressPoNumbers, setInProgressPoNumbers] = useState<Set<string>>(new Set());
  const [inProgressWaves, setInProgressWaves] = useState<PickingWave[]>([]);
  const [targetWaveByPo, setTargetWaveByPo] = useState<Record<string, string>>({});

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
      const waves = await waveRepository.listWaves();
      // 완료·발주확정 상태도 같은 출고작업의 후속 서류/재출력이 남아 있을 수 있으므로
      // 보관 기능이 생기기 전까지는 저장된 모든 웨이브를 출고작업 후보로 유지한다.
      const activeWaves = waves;
      setInProgressWaves(activeWaves);
      setInProgressPoNumbers(new Set(activeWaves.flatMap(wave => wave.sourcePurchaseOrderNumbers)));
      if (activeWaves[0]) {
        const defaults: Record<string, string> = {};
        for (const poNumber of [...(data.addedPurchaseOrderNumbers || []), ...(data.updatedPurchaseOrderNumbers || [])]) defaults[poNumber] = activeWaves[0].id;
        setTargetWaveByPo(defaults);
      }
      setShowAllOrders(false);
      await loadOrders();
      setOpen((data.addedPurchaseOrderNumbers?.length || 0) + (data.updatedPurchaseOrderNumbers?.length || 0) > 0);
    } catch {
      setImportError("최신 발주서를 불러오지 못했습니다.");
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    if (autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void handleClick();
    // 작업센터 진입 시 새 파일과 변경 버전을 한 번 자동 확인한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newlyAddedSet = new Set(importResult?.addedPurchaseOrderNumbers ?? []);
  const recentlyChangedSet = new Set([
    ...(importResult?.addedPurchaseOrderNumbers ?? []),
    ...(importResult?.updatedPurchaseOrderNumbers ?? []),
  ]);
  const visibleOrders = orders
    ? (showAllOrders
        ? orders
        : orders.filter(order => recentlyChangedSet.has(order.purchaseOrderNumber) && !inProgressPoNumbers.has(order.purchaseOrderNumber)))
    : null;
  const completedChangeByPo = new Map(
    (importResult?.updatedScheduleChanges ?? []).map(change => [change.purchaseOrderNumber, change])
  );
  const recommendations = visibleOrders ? buildScheduleChangeRecommendations(visibleOrders) : [];
  const recommendationByTargetPo = new Map<string, ScheduleChangeRecommendation>();
  for (const rec of recommendations) {
    if (!recommendationByTargetPo.has(rec.targetPurchaseOrderNumber)) recommendationByTargetPo.set(rec.targetPurchaseOrderNumber, rec);
  }

  const label = importing ? "새 발주서 자동 확인 중..." : "새 발주서 다시 확인";

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
            <h2 style={{ margin: 0, fontSize: "14px" }}>{showAllOrders ? "전체 발주서 목록" : "신규·변경 발주서 목록"}</h2>
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

          {visibleOrders !== null && (
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
          {!error && visibleOrders !== null && visibleOrders.length === 0 && (
            <p style={{ fontSize: "13px", color: wmsColors.muted }}>
              {showAllOrders ? "표시할 발주서가 없습니다." : "이번 업데이트에서 새로 추가되거나 일정이 변경된 발주서가 없습니다."}
            </p>
          )}

          {visibleOrders && visibleOrders.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {visibleOrders.map(order => {
                const totalQuantity = order.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
                const completedChange = completedChangeByPo.get(order.purchaseOrderNumber);
                const canChooseWork = recentlyChangedSet.has(order.purchaseOrderNumber) && !inProgressPoNumbers.has(order.purchaseOrderNumber);
                const targetWave = targetWaveByPo[order.purchaseOrderNumber] || inProgressWaves[0]?.id;
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

                    {completedChange && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "8px" }}>
                        {completedChange.expectedDateChanged && (
                          <span style={{ fontSize: "10px", fontWeight: 800, color: wmsColors.greenDark, background: wmsColors.greenSoft, borderRadius: "999px", padding: "3px 8px" }}>
                            입고예정일 변경완료
                          </span>
                        )}
                        {completedChange.fulfillmentCenterChanged && (
                          <span style={{ fontSize: "10px", fontWeight: 800, color: wmsColors.greenDark, background: wmsColors.greenSoft, borderRadius: "999px", padding: "3px 8px" }}>
                            물류센터 변경완료
                          </span>
                        )}
                      </div>
                    )}

                    {!completedChange && recommendationByTargetPo.has(order.purchaseOrderNumber) && (() => {
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
                      <HighlightTile label="최초 발주일" value={new Date(order.capturedAt).toLocaleDateString("ko-KR")} />
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

                    {canChooseWork && (
                      <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: `1px dashed ${wmsColors.border}` }}>
                        <div style={{ fontSize: "11px", fontWeight: 800, marginBottom: "6px" }}>이 발주서 작업방법 선택</div>
                        {inProgressWaves.length > 0 && (
                          <select
                            value={targetWaveByPo[order.purchaseOrderNumber] || inProgressWaves[0].id}
                            onChange={event => setTargetWaveByPo(prev => ({ ...prev, [order.purchaseOrderNumber]: event.target.value }))}
                            style={{ width: "100%", minHeight: "38px", borderRadius: "8px", border: `1px solid ${wmsColors.borderStrong}`, background: "#fff", marginBottom: "6px", padding: "0 8px" }}
                          >
                            {inProgressWaves.map(wave => <option key={wave.id} value={wave.id}>{wave.displayName || wave.id}</option>)}
                          </select>
                        )}
                        <div style={{ display: "flex", gap: "6px" }}>
                          <a
                            href={inProgressWaves.length > 0 && targetWave ? `/wms/picking/waves?addPo=${encodeURIComponent(order.purchaseOrderNumber)}&targetWave=${encodeURIComponent(targetWave)}` : undefined}
                            aria-disabled={inProgressWaves.length === 0}
                            tabIndex={inProgressWaves.length === 0 ? -1 : undefined}
                            style={{ ...wmsPrimaryButton, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", textDecoration: "none", flex: 1, minHeight: "38px", fontSize: "11px", opacity: inProgressWaves.length === 0 ? 0.5 : 1, cursor: inProgressWaves.length === 0 ? "default" : "pointer" }}
                          >
                            기존 출고작업에 추가
                          </a>
                          <a
                            href={`/wms/picking/waves?onlyPo=${encodeURIComponent(order.purchaseOrderNumber)}`}
                            style={{ ...wmsSecondaryButton, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", textDecoration: "none", flex: 1, minHeight: "38px", fontSize: "11px" }}
                          >
                            새 출고작업
                          </a>
                        </div>
                        {inProgressWaves.length === 0 && <div style={{ fontSize: "10px", color: wmsColors.muted, marginTop: "4px" }}>저장된 출고작업이 없어 새 출고작업으로 시작합니다.</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {orders && orders.length > 0 && (
            <button
              onClick={() => setShowAllOrders(prev => !prev)}
              style={{ ...wmsGhostButton, width: "100%", marginTop: "12px" }}
            >
              {showAllOrders ? "이번 업데이트 목록만 보기" : `발주서 목록 전체보기 (${orders.length}건)`}
            </button>
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
