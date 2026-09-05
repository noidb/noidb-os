"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppNavigation from "@/app/AppNavigation";
import type { OutboundWorkSummary, WorkCenterOverview } from "@/lib/wms/work-center";
import type { OutboundWorkState } from "@/lib/wms/picking-wave/types";
import NewPurchaseOrdersUpdateButton from "./NewPurchaseOrdersUpdateButton";
import UpcomingInboundSummary from "./UpcomingInboundSummary";
import styles from "./work-center.module.css";

export default function OutboundWorkCenter() {
  const [overview, setOverview] = useState<WorkCenterOverview | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [change, setChange] = useState<{ work: OutboundWorkSummary; status: OutboundWorkState["status"] } | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const mutationRunning = useRef(false);
  const refresh = useCallback(() => {
    if (mutationRunning.current) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    const task = (async () => {
      try {
        const response = await fetch("/api/wms/work-center", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.overview) throw new Error("저장된 출고작업을 불러오지 못했습니다. 다시 확인해 주세요.");
        setOverview(result.overview); setError("");
      } catch (reason) { setError(reason instanceof Error ? reason.message : "출고작업을 불러오지 못했습니다."); }
    })();
    inFlight.current = task;
    void task.finally(() => { inFlight.current = null; });
    return task;
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  async function saveState() {
    if (!change || saving) return;
    mutationRunning.current = true;
    setSaving(true); setError("");
    try {
      // Finish earlier refresh before mutation, so an old read cannot overwrite its response.
      await inFlight.current;
      const response = await fetch("/api/wms/work-center", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waveId: change.work.id, status: change.status, expectedUpdatedAt: change.work.state?.updatedAt || null, confirmed: true }) });
      const result = await response.json();
      if (!response.ok || !result.overview) throw new Error(result.error || "작업 상태를 저장하지 못했습니다.");
      setOverview(result.overview); setChange(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "작업 상태를 저장하지 못했습니다."); }
    finally { setSaving(false); mutationRunning.current = false; }
  }

  const active = overview?.works.filter(work => !work.state || work.state.status === "active") || [];
  const filed = overview?.works.filter(work => work.state && work.state.status !== "active") || [];
  const next = active[0];
  const statusLabel = (status: OutboundWorkState["status"]) => status === "active" ? "작업 중으로 복원" : status === "archived" ? "보관" : "작업완료";
  const renderWork = (work: OutboundWorkSummary) => <article className={`${styles.work} ${work.id === next?.id ? styles.nextWork : ""}`} key={work.id} data-testid="outbound-work">
    <div className={styles.row}><h3>{work.title}</h3><span className={styles.badge}>{work.state?.status === "completed" ? "완료" : work.state?.status === "archived" ? "보관" : "작업 중"}</span></div>
    <p className={styles.metrics}>발주 {work.purchaseOrderCount}건 · SKU {work.skuCount}개 · 총수량 {work.totalQuantity}개 · 센터 {work.centerCount}곳</p>
    {work.expectedDates.length > 0 && <p className={styles.muted}>입고예정일 {work.expectedDates.join(" / ")}</p>}
    {work.delay && <p className={styles.warning}>{work.delay}</p>}
    <p className={styles.nextLabel}>다음 할 일: {work.nextLabel}</p>
    <a className={styles.primary} href={work.nextHref}>{work.id === next?.id ? "계속하기 →" : `${work.nextLabel} →`}</a>
    <details className={styles.details}>
      <summary>서류·피킹·발주·작업 관리</summary>
      <p className={styles.muted}>같은 출고작업을 이어갑니다. 남은 발주 때문에 새 작업을 만들 필요가 없습니다.</p>
      <div className={styles.actions}>
        <a href={work.documentHref}>서류 1~4단계</a><a href={work.pickingHref}>실제 피킹</a><a href={work.vendorHref}>거래처 발주</a>
      </div>
      <p className={styles.muted}>피킹 {work.pickedSkuCount}/{work.skuCount} · Shipment 미처리 발주 {work.remainingShipmentPoCount}건 · 출력세트 미기록 발주 {work.remainingOutputPoCount}건</p>
      <div className={styles.actions}>
        {work.state && work.state.status !== "active" ? <button type="button" onClick={() => setChange({ work, status: "active" })}>작업 중으로 복원</button> : <>
          <button type="button" disabled={!work.canComplete} onClick={() => setChange({ work, status: "completed" })}>작업완료</button>
          <button type="button" onClick={() => setChange({ work, status: "archived" })}>보관하기</button>
        </>}
      </div>
      {!work.canComplete && (!work.state || work.state.status === "active") && <p className={styles.muted}>미처리 피킹·Shipment·출력세트 기록이 남아 있습니다. 계속 진행하거나 보관할 수 있습니다.</p>}
    </details>
  </article>;

  return <main className={`shell wms-work-center-shell ${styles.shell}`}>
    <AppNavigation active="work-center" />
    <header className={styles.heading}><p className="eyebrow">NOID-B OPERATIONS</p><h1>오늘 할 일</h1><p>서류부터 피킹·출고까지, 하나의 출고작업으로 이어갑니다.</p></header>
    {error && <div className={styles.error} role="alert">{error} <button type="button" onClick={() => void refresh()}>다시 확인</button></div>}
    <section className={styles.section} aria-labelledby="active-outbound-title"><div className={styles.row}><h2 id="active-outbound-title">작업 중 {overview ? `· ${active.length}개` : ""}</h2><button type="button" className={styles.smallButton} onClick={() => void refresh()}>상태 확인</button></div>
      {!overview && !error && <p role="status">저장된 출고작업을 확인하고 있습니다.</p>}
      {overview && active.length === 0 && <p className={styles.muted}>진행 중인 출고작업이 없습니다. 아래에서 새 발주서를 검토해 주세요.</p>}
      <div className={styles.workGrid}>{active.map(renderWork)}</div>
    </section>
    <div className={styles.tasks}>
      <section className={styles.task} id="purchase-orders"><h2>신규발주 검토</h2><p>새 파일 확인과 합배송 검토를 한곳에서 진행합니다.</p><NewPurchaseOrdersUpdateButton onImported={refresh} unavailableWorkIds={filed.map(work => work.id)} /><a className={styles.secondary} href="/wms/picking/waves">발주서 검토·출고작업 시작</a></section>
      <section className={styles.task}><h2>거래처 발주 대기</h2><p>{overview ? `부족 SKU ${overview.pendingVendorSkuCount}개 · 거래처 ${overview.pendingVendorCount}곳` : "저장된 초안 확인 중"}</p><a className={styles.secondary} href="/wms/vendor-orders/manage">발주서·카카오톡 확인</a>{Boolean(overview?.receivingVendorSkuCount) && <p className={styles.muted}>전송 후 입고 대기 SKU {overview?.receivingVendorSkuCount}개</p>}</section>
      <section className={styles.task}><h2>단종·해제 관리</h2><p>피킹에서 보낸 SKU와 신청파일을 확인합니다.</p><a className={styles.secondary} href="/wms/vendor-orders/status-requests">단종·해제 관리</a></section>
      <section className={styles.task}><h2>입고결과·쿠폰</h2><p>실제 입고일로 쿠폰과 미입고 상품을 확인합니다.</p><a className={styles.secondary} href="/wms/inbound">입고결과 확인</a></section>
      <section className={`${styles.task} ${styles.reprint}`}><h2>재출력센터</h2><p>사진을 끌어놓거나 바코드로 검색해 모은 뒤, 여러 종도 한 파일로 저장합니다.</p><a className={styles.primary} href="/wms/reprint">바코드 재출력하기</a></section>
    </div>
    <details className={styles.section}><summary>예정 작업 · 입고예정 물량</summary><UpcomingInboundSummary /></details>
    <details className={styles.section}><summary>완료·보관 {overview ? `(${filed.length})` : ""}</summary><p className={styles.muted}>직접 완료하거나 보관한 작업만 표시합니다. 언제든 재출력하거나 작업 중으로 복원할 수 있습니다.</p><div className={styles.workGrid}>{filed.map(renderWork)}</div></details>
    <footer className={styles.footer}><a href="/wms/settings/folder-connections">파일폴더 연결 상태</a><a href="/wms/work-center?view=classic">기존 화면 보기</a></footer>
    {change && <div className={styles.overlay}><section role="dialog" aria-modal="true" aria-labelledby="work-state-title" className={styles.dialog}>
      <h2 id="work-state-title">{statusLabel(change.status)} 확인</h2><p>{change.work.title}</p><p>발주 {change.work.purchaseOrderCount}건 · SKU {change.work.skuCount}개</p><p>변경: {change.work.state?.status === "archived" ? "보관" : change.work.state?.status === "completed" ? "완료" : "작업 중"} → {statusLabel(change.status)}</p><p>목록의 표시 상태만 바뀝니다. 피킹수량·운송장·Shipment·재고·원본파일은 그대로 보존합니다.</p>
      {change.status === "archived" && <p className={styles.warning}>미처리 작업도 보관 목록으로 이동합니다. 작업 데이터는 삭제하지 않습니다.</p>}
      {error && <p role="alert" className={styles.warning}>{error}</p>}
      <div className={styles.actions}><button type="button" disabled={saving} autoFocus onClick={() => { setChange(null); setError(""); }}>취소</button><button type="button" className={styles.primary} disabled={saving} onClick={saveState}>{saving ? "저장 중" : `${statusLabel(change.status)} 저장`}</button></div>
    </section></div>}
  </main>;
}
