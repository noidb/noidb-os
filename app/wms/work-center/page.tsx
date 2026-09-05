"use client";

import { useEffect, useState } from "react";
import { wmsColors, wmsPrimaryButton } from "@/lib/wms/ui-tokens";
import AppNavigation from "@/app/AppNavigation";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
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
  const waveRepository = usePickingWaveRepository();
  const vendorOrderRepository = useVendorOrderRepository();
  const [summary, setSummary] = useState<{ vendorCount: number; skuCount: number; totalShortage: number; waveIds: string[] } | null>(null);

  useEffect(() => {
    (async () => {
      const waves = await waveRepository.listWaves();
      const relevantWaves = waves.filter(wave => wave.status !== "in_progress");
      const vendorNames = new Set<string>();
      let skuCount = 0;
      let totalShortage = 0;
      const waveIds: string[] = [];

      for (const wave of relevantWaves) {
        const lines = await vendorOrderRepository.listLines(wave.id);
        if (lines.length === 0) continue;
        waveIds.push(wave.id);
        for (const line of lines) {
          vendorNames.add(line.vendorName || UNASSIGNED_VENDOR_NAME);
          skuCount += 1;
          totalShortage += line.shortageQuantity;
        }
      }
      setSummary({ vendorCount: vendorNames.size, skuCount, totalShortage, waveIds });
    })();
  }, [waveRepository, vendorOrderRepository]);

  if (!summary) return null;

  const href = summary.waveIds.length === 1 ? `/wms/picking/waves/${summary.waveIds[0]}/vendor-orders` : "/wms/picking/waves";

  return (
    <a href={href} style={{ display: "block", textDecoration: "none", marginBottom: "18px" }}>
      <div
        style={{
          border: `1px solid ${summary.vendorCount > 0 ? wmsColors.warn : wmsColors.border}`,
          background: summary.vendorCount > 0 ? wmsColors.warnSoft : wmsColors.surfaceBeige,
          borderRadius: "14px",
          padding: "12px",
        }}
      >
        {summary.vendorCount > 0 ? (
          <>
            <div style={{ fontSize: "13px", fontWeight: 800, color: wmsColors.warn }}>부족분 거래처별 발주서 {summary.vendorCount}건</div>
            <div style={{ fontSize: "11px", color: wmsColors.ink, marginTop: "2px" }}>
              부족 SKU {summary.skuCount}개 · 총 부족수량 {summary.totalShortage}개
            </div>
          </>
        ) : (
          <div style={{ fontSize: "12px", color: wmsColors.muted }}>현재 부족분이 없습니다.</div>
        )}
      </div>
    </a>
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
