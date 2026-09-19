"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupplierHubPurchaseOrder } from "@/lib/wms/supplier-hub-orders";
import type { ImportLatestResult } from "@/lib/wms/import-latest-purchase-orders";
import { buildScheduleChangeRecommendations } from "@/lib/wms/schedule-recommendation";
import { cleanDisplayProductName } from "@/lib/wms/display-name";
import { groupPurchaseOrdersForShipping, toggleExpectedDateSelection } from "@/lib/wms/purchase-order-view";
import { buildInvoiceGroupDrafts, type InvoiceGroupDraft } from "@/lib/wms/invoice-group/build-groups";
import { isAsideCompletedDispatchPurchaseOrder } from "@/lib/wms/logistics-aside-dispatch";
import { useInvoiceGroupRepository } from "@/lib/wms/invoice-group/context";
import { INVOICE_GROUP_STAGE_LABEL, type InvoiceGroup, type InvoiceGroupStage } from "@/lib/wms/invoice-group/types";
import { wmsColors, wmsGhostButton, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";
import styles from "../../work-center/work-center.module.css";

/**
 * ① 신규발주서 검색 (2026-09-18 신규 — 1차 재구성 1단계).
 *
 * 물류직원이 있던 시절의 웨이브(picking-wave) 시스템과 완전히 무관하다. 실제 업무는
 * "입고예정일이 가까운 발주서부터 확인 → 처리할 발주서 선택 → 입고예정일·물류센터가 같은
 * 발주서는 합배송 묶음으로 자동 정리"가 전부다.
 *
 * 발주묶음 생명주기(2026-09-18 사용자 확정): 신규 → 쉽먼트완료 → 출고완료 → 쉽먼트마감 →
 * 입고결과처리(쿠폰·광고 등록/미납SKU 재발주요청/거래처발주 전부 완료) → 최종삭제. 전환은
 * 전부 사용자가 버튼을 눌러 처리하며, 자동으로 일어나는 건 "쉽먼트마감 되면 이 화면(신규발주서
 * 검색) 목록에서 빠지는 것" 하나뿐이다 — 레코드는 지워지지 않고 입고결과처리 화면(미구현)으로
 * 넘어간 것으로 취급한다. 최종삭제는 후속 작업이 끝나도 자동으로 일어나지 않는다.
 *
 * 발주서 조회/가져오기 API(/api/wms/supplier-hub-orders, /api/wms/import-latest-purchase-orders)는
 * 기존 work-center/NewPurchaseOrdersUpdateButton.tsx와 동일하게 그대로 재사용한다 — 바꾼 적 없다.
 */
export default function WmsNewOrdersPage() {
  const invoiceGroupRepository = useInvoiceGroupRepository();

  const [orders, setOrders] = useState<SupplierHubPurchaseOrder[] | null>(null);
  const [fixtureMode, setFixtureMode] = useState(false);
  useEffect(() => { setFixtureMode(process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).get("logisticsFixture") === "1"); }, []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportLatestResult | null>(null);

  const [existingGroups, setExistingGroups] = useState<InvoiceGroup[]>([]);
  const [excludedPoNumbers, setExcludedPoNumbers] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);

  async function loadOrders() {
    try {
      const response = await fetch(fixtureMode ? "/api/wms/logistics/fixture" : "/api/wms/supplier-hub-orders", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) { setLoadError(data.error || "발주서를 불러오지 못했습니다."); return; }
      const list = (data.orders as SupplierHubPurchaseOrder[]).slice().sort((a, b) => a.expectedDate.localeCompare(b.expectedDate) || a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber));
      setOrders(list);
      setLoadError(null);
    } catch {
      setLoadError("발주서를 불러오지 못했습니다.");
    }
  }

  async function loadExistingGroups() {
    try { setExistingGroups(await invoiceGroupRepository.list()); } catch { /* 발주묶음 겹침 확인용 — 실패해도 조회 자체는 계속 진행 */ }
  }

  async function loadExcludedPoNumbers() {
    try { setExcludedPoNumbers(new Set(await invoiceGroupRepository.listExcludedPurchaseOrderNumbers())); } catch { /* 목록 필터링용 — 실패해도 조회 자체는 계속 진행 */ }
  }

  async function handleLoadWorkspace() {
    if (loadingWorkspace) return;
    setLoadingWorkspace(true);
    setLoadError(null);
    try { await Promise.all([loadOrders(), loadExistingGroups(), loadExcludedPoNumbers()]); }
    finally { setLoadingWorkspace(false); }
  }

  async function handleImportLatest() {
    if (importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const response = await fetch("/api/wms/import-latest-purchase-orders", { method: "POST" });
      const data = await response.json();
      if (!response.ok) { setImportError(data.error || "최신 발주서를 불러오지 못했습니다."); return; }
      setImportResult(data as ImportLatestResult);
      await handleLoadWorkspace();
    } catch {
      setImportError("최신 발주서를 불러오지 못했습니다.");
    } finally {
      setImporting(false);
    }
  }

  const activeGroups = useMemo(() => existingGroups.filter(group => !group.supersededByGroupId), [existingGroups]);
  /** 새 묶음을 만들 때 겹치면 안 되는 대상 — 마감 여부와 무관하게 이미 어떤 묶음에든 속한 PO 전부. */
  const groupedPoNumbers = useMemo(() => new Set(activeGroups.flatMap(group => group.purchaseOrderNumbers)), [activeGroups]);
  /** "신규발주서 검색" 목록에서 완전히 빠지는 대상 — 쉽먼트마감된 묶음의 PO. */
  const closedPoNumbers = useMemo(() => new Set(activeGroups.filter(group => group.stage === "shipment_closed").flatMap(group => group.purchaseOrderNumbers)), [activeGroups]);
  const inProgressGroups = useMemo(() => activeGroups.filter(group => group.stage !== "shipment_closed" && group.stage !== "dispatched").sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)), [activeGroups]);
  const closedGroupCount = activeGroups.length - inProgressGroups.length;
  /** 날짜 단위로 한 번에 처리하도록(같은 날짜에 물류센터가 여러 개여도 그룹마다 따로 열지 않게,
   *  2026-09-18) 진행 중인 발주묶음을 입고예정일별로 묶는다. */
  const inProgressGroupsByDate = useMemo(() => {
    const map = new Map<string, InvoiceGroup[]>();
    for (const group of inProgressGroups) map.set(group.expectedDate, [...(map.get(group.expectedDate) || []), group]);
    return [...map.entries()];
  }, [inProgressGroups]);

  const visibleOrders = useMemo(() => (orders || []).filter(order => !closedPoNumbers.has(order.purchaseOrderNumber) && !excludedPoNumbers.has(order.purchaseOrderNumber) && !isAsideCompletedDispatchPurchaseOrder(order.purchaseOrderNumber)), [orders, closedPoNumbers, excludedPoNumbers]);
  const ungroupedOrders = useMemo(() => visibleOrders.filter(order => !groupedPoNumbers.has(order.purchaseOrderNumber)), [visibleOrders, groupedPoNumbers]);

  function toggle(poNumber: string) {
    setSelected(previous => { const next = new Set(previous); if (next.has(poNumber)) next.delete(poNumber); else next.add(poNumber); return next; });
  }

  function toggleAll() {
    setSelected(previous => previous.size === ungroupedOrders.length ? new Set() : new Set(ungroupedOrders.map(order => order.purchaseOrderNumber)));
  }

  /** 물류센터별 소그룹 펼침 상태 (2026-09-18 신규 — 예전 한진 송장 화면(HanjinUploadSection)의
   *  센터별 접기/펼치기와 동일한 패턴). 기본은 전부 접힘 — 발주서가 많을 때 물류센터·SKU개수·
   *  총수량 요약만 보고, 필요한 그룹만 펼쳐서 개별 발주서를 본다. */
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  function toggleGroupOpen(key: string) {
    setOpenGroups(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }

  /** 입고예정일 소그룹도 기본 접힘 — 접힌 상태에선 날짜 옆에 물류센터 목록·총SKU·총수량만 보인다. */
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());
  function toggleDateOpen(expectedDate: string) {
    setOpenDates(previous => { const next = new Set(previous); if (next.has(expectedDate)) next.delete(expectedDate); else next.add(expectedDate); return next; });
  }

  /** 입고예정일별 그룹 (2026-09-18 — 예전 피킹 웨이브 화면의 "입고예정일별 보기"와 동일한 그룹핑
   *  기준을 재사용). 날짜 헤더마다 "이 날짜 전체선택/해제"를 따로 눌러야 특정 날짜만 남기고
   *  나머지를 한 번에 해제할 수 있다 — 하나씩 체크 해제하지 않아도 된다. */
  const ordersByExpectedDate = useMemo(() => {
    const grouped = new Map<string, SupplierHubPurchaseOrder[]>();
    for (const order of ungroupedOrders) {
      const expectedDate = order.expectedDate?.trim() || "입고예정일 미정";
      grouped.set(expectedDate, [...(grouped.get(expectedDate) || []), order]);
    }
    return [...grouped.entries()].sort(([dateA], [dateB]) => {
      if (dateA === "입고예정일 미정") return 1;
      if (dateB === "입고예정일 미정") return -1;
      return dateA.localeCompare(dateB);
    });
  }, [ungroupedOrders]);

  const recommendations = orders ? buildScheduleChangeRecommendations(orders) : [];
  const recommendationByTargetPo = new Map(recommendations.map(rec => [rec.targetPurchaseOrderNumber, rec]));

  const selectedOrders = useMemo(() => ungroupedOrders.filter(order => selected.has(order.purchaseOrderNumber)), [ungroupedOrders, selected]);
  const previewGroups = useMemo(() => buildInvoiceGroupDrafts(selectedOrders), [selectedOrders]);

  function buildGroupsFromDrafts(drafts: InvoiceGroupDraft[], stage: InvoiceGroupStage, notes: string): InvoiceGroup[] {
    const now = new Date().toISOString();
    return drafts.map(draft => ({
      id: crypto.randomUUID(),
      purchaseOrderNumbers: draft.purchaseOrderNumbers,
      expectedDate: draft.expectedDate,
      fulfillmentCenter: draft.fulfillmentCenter,
      mergedFromMultiplePo: draft.mergedFromMultiplePo,
      stage,
      fulfillmentCenterPhone: draft.fulfillmentCenterPhone,
      fulfillmentCenterZip: "",
      fulfillmentCenterAddress: draft.fulfillmentCenterAddress,
      poConfirmations: [],
      skuCount: draft.skuCount,
      totalQuantity: draft.totalQuantity,
      shipmentInvoiceNumbers: [],
      shipmentNumbers: [],
      notes,
      createdAt: now,
      updatedAt: now,
    }));
  }

  async function handleCreateGroups() {
    if (creating || previewGroups.length === 0) return;
    setCreating(true);
    setCreateError(null);
    setCreatedMessage(null);
    try {
      const creatable = previewGroups.filter(draft => draft.purchaseOrderNumbers.every(po => !groupedPoNumbers.has(po)));
      if (creatable.length === 0) { setCreateError("선택한 발주서가 모두 이미 만들어진 발주묶음에 속해 있습니다."); return; }
      for (const group of buildGroupsFromDrafts(creatable, "new", "")) await invoiceGroupRepository.save(group);
      setCreatedMessage(`발주묶음 ${creatable.length}건을 만들었습니다(발주서 ${creatable.reduce((sum, g) => sum + g.purchaseOrderNumbers.length, 0)}건).${creatable.length < previewGroups.length ? ` 이미 묶인 ${previewGroups.length - creatable.length}건은 건너뛰었습니다.` : ""}`);
      await loadExistingGroups();
      setSelected(previous => {
        const next = new Set(previous);
        for (const group of creatable) for (const po of group.purchaseOrderNumbers) next.delete(po);
        return next;
      });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "발주묶음을 만들지 못했습니다.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className={`shell wms-work-center-shell ${styles.shell}`} style={{ fontFamily: "sans-serif" }}>
      <header className={styles.heading}>
        <p className="eyebrow">NOID-B OPERATIONS</p>
        <h1>신규 발주서</h1>
        <p>발주서리스트 파일을 가져온 뒤, 입고예정일과 입고센터가 같은 발주서만 합배송 묶음으로 만듭니다. 조회와 다음 단계 이동은 사용자가 누른 버튼에서만 실행합니다.</p>
      </header>
      {fixtureMode && <p style={{ margin: "0 0 16px", padding: "12px", borderRadius: "10px", background: "#fff4d8", color: "#7a4d00", fontSize: "12px", fontWeight: 800 }}>개발용 테스트 데이터 20건 · 메모리 저장소만 사용하며 실제 API·파일·운영 기록을 변경하지 않습니다.</p>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "8px", marginBottom: "10px" }}>
        <button type="button" disabled={importing} onClick={() => void handleImportLatest()} className={styles.secondary}>
          {importing ? "불러오는 중..." : "발주서리스트 파일 불러오기"}
        </button>
      </div>
      {importError && <p style={{ color: "#c0392b", fontSize: "12px" }}>{importError}</p>}
      {importResult && (
        <div style={{ background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "10px 12px", marginBottom: "12px", fontSize: "12px" }}>
          원본: {importResult.sourceFileName} · 신규 {importResult.addedPurchaseOrderNumbers.length}건 추가
          {(importResult.updatedPurchaseOrderNumbers?.length ?? 0) > 0 && ` · 입고예정일/물류센터 ${importResult.updatedPurchaseOrderNumbers.length}건 업데이트`}
        </div>
      )}

      {loadError && <p style={{ color: "#c0392b", fontSize: "13px" }}>{loadError}</p>}
      {!loadError && orders === null && <p style={{ color: wmsColors.muted, fontSize: "13px" }}>발주서리스트 파일을 불러오면 목록이 표시됩니다.</p>}

      {inProgressGroupsByDate.length > 0 && (
        <section style={{ marginBottom: "18px" }}>
          <strong style={{ fontSize: "13px" }}>진행 중인 발주 · 입고예정일 {inProgressGroupsByDate.length}개</strong>
          {closedGroupCount > 0 && <span style={{ marginLeft: "8px", fontSize: "11px", color: wmsColors.muted }}>(쉽먼트마감 완료 {closedGroupCount}건은 목록에서 뺐습니다)</span>}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
            {inProgressGroupsByDate.map(([expectedDate, dateGroups]) => {
              const poCount = dateGroups.reduce((sum, group) => sum + group.purchaseOrderNumbers.length, 0);
              const dateSkuCount = dateGroups.reduce((sum, group) => sum + group.skuCount, 0);
              const dateTotalQuantity = dateGroups.reduce((sum, group) => sum + group.totalQuantity, 0);
              const stages = [...new Set(dateGroups.map(group => group.stage))];
              return (
                <div key={expectedDate} style={{ padding: "10px", border: `1px solid ${wmsColors.border}`, borderRadius: "11px", background: "#fff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "6px", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "13px" }}>{expectedDate}</strong>
                    <span style={{ fontSize: "11px", fontWeight: 800, color: wmsColors.slateDark, background: wmsColors.surfaceBeige, borderRadius: "999px", padding: "2px 8px" }}>{stages.map(stage => INVOICE_GROUP_STAGE_LABEL[stage]).join(" / ")}</span>
                  </div>
                  <div style={{ fontSize: "11px", color: wmsColors.muted, marginTop: "2px" }}>
                    {dateGroups.map(group => group.fulfillmentCenter).join(", ")} · 발주 {poCount}건 · SKU {dateSkuCount}종 · 총 {dateTotalQuantity}개
                  </div>
                  <a href={`/wms/logistics/dates/${encodeURIComponent(expectedDate)}${fixtureMode ? "?logisticsFixture=1" : ""}`} style={{ display: "block", textDecoration: "none", marginTop: "8px" }}>
                    <button type="button" style={{ ...wmsPrimaryButton, width: "100%" }}>이 날짜 전체 발주확정·송장·쉽먼트·바코드 처리하기 →</button>
                  </a>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {orders && ungroupedOrders.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0" }}>
            <strong style={{ fontSize: "13px" }}>신규 발주서 {ungroupedOrders.length}건 · 선택 {selected.size}건</strong>
            <button type="button" onClick={toggleAll} style={{ ...wmsGhostButton, minHeight: "34px", fontSize: "11px" }}>{selected.size === ungroupedOrders.length ? "전체해제" : "전체선택"}</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "18px" }}>
            {ordersByExpectedDate.map(([expectedDate, dateOrders]) => {
              const dateOpen = openDates.has(expectedDate);
              const centerGroups = groupPurchaseOrdersForShipping(dateOrders);
              const dateSkuCount = new Set(dateOrders.flatMap(order => order.items.map(item => item.productCode))).size;
              const dateTotalQuantity = dateOrders.reduce((sum, order) => sum + order.items.reduce((lineSum, item) => lineSum + item.orderedQuantity, 0), 0);
              const dateSelectedCount = dateOrders.filter(order => selected.has(order.purchaseOrderNumber)).length;
              return (
              <section key={expectedDate} style={{ border: `2px solid ${wmsColors.borderStrong}`, borderRadius: "12px", overflow: "hidden" }}>
                <button
                  type="button"
                  aria-expanded={dateOpen}
                  onClick={() => toggleDateOpen(expectedDate)}
                  style={{ width: "100%", border: 0, padding: "12px", background: wmsColors.surfaceBeige, display: "flex", alignItems: "center", gap: "8px", textAlign: "left", cursor: "pointer" }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: "block", fontSize: "14px" }}>{expectedDate} <span style={{ fontWeight: 700, color: wmsColors.slateDark }}>· 발주 {dateOrders.length}건 · SKU {dateSkuCount}개 · 총수량 {dateTotalQuantity}개</span></strong>
                    <span style={{ fontSize: "11px", color: wmsColors.muted }}>{centerGroups.map(g => g.fulfillmentCenter).join(", ")} · 선택 {dateSelectedCount}</span>
                  </span>
                  <span style={{ fontSize: "11px", color: wmsColors.muted }}>{dateOpen ? "▲" : "▼"}</span>
                </button>
                {dateOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
                  <button type="button" onClick={() => setSelected(previous => toggleExpectedDateSelection(previous, dateOrders))} style={{ ...wmsSecondaryButton, minHeight: "30px", padding: "5px 10px", fontSize: "11px" }}>
                    이 날짜 전체선택/해제
                  </button>
                </div>
                {centerGroups.map(centerGroup => {
                  const open = openGroups.has(centerGroup.key);
                  const selectedInGroup = centerGroup.orders.filter(order => selected.has(order.purchaseOrderNumber)).length;
                  return (
                    <div key={centerGroup.key} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "11px", overflow: "hidden", background: "#fff" }}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleGroupOpen(centerGroup.key)}
                        style={{ width: "100%", border: 0, padding: "10px", background: wmsColors.surfaceBeige, display: "flex", alignItems: "center", gap: "8px", textAlign: "left", cursor: "pointer" }}
                      >
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <strong style={{ display: "block", fontSize: "13px" }}>{centerGroup.fulfillmentCenter}</strong>
                          <span style={{ fontSize: "11px", color: wmsColors.muted }}>발주 {centerGroup.orderCount}건 · SKU {centerGroup.skuCount}개 · 총수량 {centerGroup.totalQuantity}개 · 선택 {selectedInGroup}</span>
                        </span>
                        <span style={{ fontSize: "11px", color: wmsColors.muted }}>{open ? "▲" : "▼"}</span>
                      </button>
                      {open && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px" }}>
                          {centerGroup.orders.map(order => {
                            const totalQuantity = order.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
                            const rec = recommendationByTargetPo.get(order.purchaseOrderNumber);
                            return (
                              <label key={order.purchaseOrderNumber} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: "9px", alignItems: "flex-start", padding: "10px", border: `1px solid ${wmsColors.border}`, borderRadius: "10px", background: "#fff" }}>
                                <input type="checkbox" checked={selected.has(order.purchaseOrderNumber)} onChange={() => toggle(order.purchaseOrderNumber)} style={{ width: "20px", height: "20px", marginTop: "2px" }} />
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: "6px", flexWrap: "wrap" }}>
                                    <strong style={{ fontSize: "13px" }}>발주서 {order.purchaseOrderNumber}</strong>
                                    <span style={{ fontSize: "11px", color: wmsColors.muted }}>{order.orderType}</span>
                                  </div>
                                  <div style={{ fontSize: "11px", color: wmsColors.slateDark, marginTop: "2px" }}>
                                    SKU {order.items.length}종 · 총수량 {totalQuantity}개
                                  </div>
                                  {rec && (
                                    <div style={{ marginTop: "4px", padding: "6px 8px", background: wmsColors.warnSoft, borderRadius: "7px", fontSize: "10px", color: wmsColors.warnText }}>
                                      변경 확인 필요: {rec.current.fulfillmentCenter !== rec.recommended.fulfillmentCenter ? `물류센터 ${rec.current.fulfillmentCenter}→${rec.recommended.fulfillmentCenter} ` : ""}
                                      {rec.current.expectedDate !== rec.recommended.expectedDate ? `입고예정일 ${rec.current.expectedDate}→${rec.recommended.expectedDate}` : ""}
                                    </div>
                                  )}
                                  <details style={{ marginTop: "6px" }}>
                                    <summary style={{ cursor: "pointer", fontSize: "11px", color: wmsColors.muted }}>품목 보기</summary>
                                    <div style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "2px" }}>
                                      {order.items.map(item => (
                                        <div key={`${order.purchaseOrderNumber}-${item.lineNo}`} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", padding: "3px 0", borderBottom: "1px solid #f2eee8" }}>
                                          <span style={{ wordBreak: "keep-all" }}>{cleanDisplayProductName(item.productName)}</span>
                                          <span style={{ flexShrink: 0, fontWeight: 700 }}>{item.orderedQuantity}개</span>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
                )}
              </section>
              );
            })}
          </div>

          <div style={{ position: "sticky", bottom: "0", background: wmsColors.background, paddingTop: "8px", borderTop: `1px solid ${wmsColors.border}` }}>
            <div style={{ background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "10px 12px", marginBottom: "8px", fontSize: "12px", lineHeight: 1.7 }}>
              <strong>합배송 묶음 미리보기 · {previewGroups.length}개</strong>
              {previewGroups.length > 0 && (
                <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  {previewGroups.map(group => (
                    <div key={`${group.expectedDate}::${group.fulfillmentCenter}`}>
                      {group.expectedDate} · {group.fulfillmentCenter} · 발주 {group.purchaseOrderNumbers.length}건{group.mergedFromMultiplePo ? " (합배송)" : ""} · SKU {group.skuCount}종 · 총 {group.totalQuantity}개
                    </div>
                  ))}
                </div>
              )}
            </div>
            {createError && <p style={{ color: "#c0392b", fontSize: "12px" }}>{createError}</p>}
            {createdMessage && <p style={{ color: wmsColors.greenDark, fontSize: "12px" }}>{createdMessage}</p>}
            <button type="button" disabled={creating || previewGroups.length === 0} onClick={() => void handleCreateGroups()} style={{ ...wmsPrimaryButton, width: "100%", opacity: creating || previewGroups.length === 0 ? 0.5 : 1 }}>
              {creating ? "발주묶음 만드는 중..." : `선택한 발주서로 발주묶음 만들기 (${selected.size}건)`}
            </button>
          </div>
        </>
      )}

      {orders && ungroupedOrders.length === 0 && inProgressGroups.length === 0 && !loadError && <p style={{ color: wmsColors.muted, fontSize: "13px" }}>표시할 발주서가 없습니다.</p>}
    </main>
  );
}
