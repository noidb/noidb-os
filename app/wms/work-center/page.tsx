"use client";

import { useEffect, useState } from "react";
import { wmsColors, wmsPrimaryButton } from "@/lib/wms/ui-tokens";
import AppNavigation from "@/app/AppNavigation";
import ActiveWaveList from "@/app/wms/picking/waves/ActiveWaveList";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import { UNASSIGNED_VENDOR_NAME } from "@/lib/wms/vendor-order/types";
import { InboxIcon, TruckIcon } from "../icons";
import WorkCenterMenuButton from "./WorkCenterMenuButton";
import NewPurchaseOrdersUpdateButton from "./NewPurchaseOrdersUpdateButton";
import UpcomingInboundSummary from "./UpcomingInboundSummary";

/**
 * 작업센터 첫 화면의 "부족분 거래처별 발주서" 진입 배너 (2026-08-19 신규).
 * 새 화면을 따로 만들지 않고, 기존 웨이브별 거래처 발주서 저장소(lib/wms/vendor-order)를
 * 그대로 스캔해 합산한다. 웨이브가 1개뿐이면 그 웨이브의 거래처 발주서 화면으로 바로 이동하고,
 * 여러 개면 기존 웨이브 목록 화면으로 보낸다(웨이브를 가로지르는 통합 목록 화면은 아직 없음).
 */
function ShortageVendorOrdersBanner() {
  const vendorOrderRepository = useVendorOrderRepository();
  const [summary, setSummary] = useState<{ pendingVendors: number; pendingSku: number; sentVendors: number; sentSku: number } | null>(null);

  useEffect(() => {
    (async () => {
      const [drafts, lines] = await Promise.all([vendorOrderRepository.listAllDrafts(), vendorOrderRepository.listAllLines()]);
      const statusByDraft = new Map(drafts.map(draft => [draft.id, draft.status]));
      const pendingLines = lines.filter(line => statusByDraft.get(line.draftId) !== "sent");
      const sentLines = lines.filter(line => statusByDraft.get(line.draftId) === "sent");
      setSummary({
        pendingVendors: new Set(pendingLines.map(line => line.vendorName || UNASSIGNED_VENDOR_NAME)).size,
        pendingSku: pendingLines.length,
        sentVendors: new Set(sentLines.map(line => line.vendorName || UNASSIGNED_VENDOR_NAME)).size,
        sentSku: sentLines.length,
      });
    })();
  }, [vendorOrderRepository]);

  if (!summary) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "8px", marginBottom: "18px" }}>
      {summary.pendingSku > 0 && <a href="/wms/vendor-orders/manage" style={{ display: "block", textDecoration: "none", border: `1px solid ${wmsColors.warn}`, background: wmsColors.warnSoft, borderRadius: "14px", padding: "12px" }}>
        <strong style={{ display: "block", fontSize: "13px", color: wmsColors.warn }}>거래처 발주 대기</strong>
        <span style={{ display: "block", marginTop: "3px", fontSize: "11px", color: wmsColors.ink }}>업체 {summary.pendingVendors}곳 · 부족 SKU {summary.pendingSku}개</span>
      </a>}
      {summary.sentSku > 0 && <a href="/wms/vendor-orders/receiving" style={{ display: "block", textDecoration: "none", border: `1px solid ${wmsColors.green}`, background: wmsColors.greenSoft, borderRadius: "14px", padding: "12px" }}>
        <strong style={{ display: "block", fontSize: "13px", color: wmsColors.greenDark }}>거래처 입고 대기</strong>
        <span style={{ display: "block", marginTop: "3px", fontSize: "11px", color: wmsColors.ink }}>업체 {summary.sentVendors}곳 · SKU {summary.sentSku}개</span>
      </a>}
    </div>
  );
}

export default function WmsWorkCenterPage() {
  return (
    <main
      className="shell wms-work-center-shell"
      style={{
        fontFamily: "sans-serif",
        color: wmsColors.ink,
      }}
    >
      <AppNavigation active="work-center" />
      {/* AI 상품등록 도우미(app/page.tsx)의 .hero/.hero h1을 그대로 재사용 — 제목을 흰색 박스에
       *  가두지 않고 페이지 기본 배경 위에 직접 표시(2026-08-20 실기기 추가 확인 1번). main도
       *  더 이상 자체 흰색 배경을 칠하지 않아 "각진 흰색 외곽 패널" 인상이 사라진다. */}
      <div className="hero wms-work-center-hero">
        <div>
          <p className="eyebrow">NOID-B OPERATIONS</p>
          <h1>작업센터</h1>
          <p className="sub">신규 발주서 확인부터 입고·피킹·쉽먼트까지 발주서 기준으로 진행합니다.</p>
        </div>
      </div>

      <nav className="wms-workflow-nav" aria-label="작업 흐름 바로가기">
        <a href="#purchase-orders"><span>1</span><strong>신규 발주</strong><small>발주서 업데이트</small></a>
        <a href="/wms/vendor-orders"><span>2</span><strong>거래처 발주</strong><small>부족분 주문</small></a>
        <a href="/wms/vendor-orders/receiving"><span>3</span><strong>입고·피킹</strong><small>발주서 작업</small></a>
        <a href="/wms/shipment"><span>4</span><strong>쉽먼트</strong><small>구성·출력</small></a>
      </nav>

      {/* 상단 메뉴 3개 — 전부 WorkCenterMenuButton 하나만 재사용해 크기·아이콘 위치·글자
       *  위치를 완전히 통일한다(2026-08-20 신규). 모바일은 1열 세로, 760px 이상은 3열
       *  (app/globals.css .wms-work-center-menu). 나머지 두 버튼은 각자 상태(로딩중/완료 등)와
       *  결과 표시를 스스로 관리하는 자체완결 컴포넌트라 여기서는 배치만 한다. */}
      <div id="purchase-orders" className="wms-work-center-menu" style={{ marginBottom: "18px" }}>
        <NewPurchaseOrdersUpdateButton />
        <WorkCenterMenuButton
          href="/wms/vendor-orders"
          icon={<TruckIcon size={26} color={wmsColors.slateDark} />}
          title="거래처 발주관리"
          tint="rgba(83,109,120,0.10)"
          borderTint="rgba(83,109,120,0.35)"
          textColor={wmsColors.slateDark}
        />
        <WorkCenterMenuButton
          href="/wms/vendor-orders/receiving"
          icon={<InboxIcon size={26} color={wmsColors.greenDark} />}
          title="발주서 입고관리"
          tint={wmsColors.greenSoft}
          borderTint={wmsColors.green}
          textColor={wmsColors.greenDark}
        />
      </div>

      <div id="inbound-picking" className="wms-section-heading">
        <div><span>WAREHOUSE OPERATIONS</span><h2>입고·피킹 작업</h2></div>
        <p>신규발주 확인 → 부족분 발주 → 통합 피킹</p>
      </div>

      <ShortageVendorOrdersBanner />

      <UpcomingInboundSummary />

      <a className="wms-work-center-picking-link" href="/wms/picking/waves">
        <button className="wms-work-center-picking-button" style={{ ...wmsPrimaryButton, width: "100%" }}>통합 피킹 시작 (실제 발주 기준)</button>
      </a>

      <ActiveWaveList className="wms-work-center-active-waves" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "10px", marginTop: "18px" }}>
        <a href="/wms/inbound" style={{ padding: "14px", border: `1px solid ${wmsColors.green}`, borderRadius: "14px", background: wmsColors.greenSoft, color: wmsColors.greenDark, textDecoration: "none" }}>
          <strong style={{ display: "block", fontSize: "15px" }}>입고결과·쿠폰</strong>
          <span style={{ display: "block", marginTop: "4px", fontSize: "12px" }}>실제 입고일 기준 쿠폰·미입고 파일</span>
        </a>
        <a href="/wms/vendor-orders/status-requests" style={{ padding: "14px", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "14px", background: wmsColors.surfaceBeige, color: wmsColors.ink, textDecoration: "none" }}>
          <strong style={{ display: "block", fontSize: "15px" }}>단종·해제 관리</strong>
          <span style={{ display: "block", marginTop: "4px", fontSize: "12px" }}>대기 SKU와 신청파일 생성</span>
        </a>
      </div>

      <section style={{ marginTop: "18px", padding: "14px", border: `1px solid ${wmsColors.border}`, borderRadius: "14px", background: wmsColors.surface }}>
        <div style={{ marginBottom: "9px" }}>
          <h2 style={{ margin: 0, fontSize: "16px" }}>재출력센터</h2>
          <p style={{ margin: "4px 0 0", color: wmsColors.muted, fontSize: "12px" }}>SKU·바코드·발주번호·상품명으로 찾아 바코드 한 장도 바로 다시 출력합니다.</p>
        </div>
        <a href="/wms/reprint" style={{ ...wmsPrimaryButton, minHeight: "48px", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", textDecoration: "none" }}>재출력하기</a>
      </section>
    </main>
  );
}
