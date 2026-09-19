"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { wmsColors } from "@/lib/wms/ui-tokens";
import AppNavigation from "@/app/AppNavigation";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import { UNASSIGNED_VENDOR_NAME } from "@/lib/wms/vendor-order/types";
import SupplyStatusUpdateButton from "./SupplyStatusUpdateButton";
import { useInvoiceGroupRepository } from "@/lib/wms/invoice-group/context";
import { INVOICE_GROUP_STAGE_LABEL, INVOICE_GROUP_STAGE_ORDER, type InvoiceGroup } from "@/lib/wms/invoice-group/types";
import styles from "./work-center.module.css";

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
    <Link href={href} style={{ display: "block", textDecoration: "none", marginBottom: "18px" }}>
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
    </Link>
  );
}

/**
 * "진행 중 발주" 섹션 (2026-09-18 신규 — 사용자 요청).
 *
 * 데이터/그룹핑 로직은 app/wms/logistics/new-orders/page.tsx의 "진행 중인 발주묶음"(입고예정일별
 * 그룹핑)과 완전히 동일하게 재사용한다 — 새 계산식을 만들지 않았다. 스타일은 예전 "오늘 할 일"
 * 화면(work-center/OutboundWorkCenter.tsx, 지금은 안 쓰는 화면이지만 CSS 모듈은 그대로 남아있는
 * work-center.module.css)의 "작업 중 · N개" 섹션과 동일한 클래스(section/row/workGrid/work/
 * badge/metrics/muted)를 그대로 쓴다. 카드를 누르면 신규발주서 검색 화면을 거치지 않고 바로
 * 그 날짜의 처리 화면(/wms/logistics/dates/[expectedDate])으로 이동한다 — "바로 이어서" 요구사항.
 */
/** "9월 14일입고" 같은 친숙한 표기 — 예전 "오늘 할 일" 화면 실측 기준(2026-09-18). 형식이
 *  안 맞으면 원본 날짜 문자열을 그대로 돌려준다(추측 변환 금지). */
function formatInboundDateTitle(expectedDate: string): string {
  const match = expectedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return expectedDate;
  return `${Number(match[2])}월 ${Number(match[3])}일입고`;
}

function InProgressOrdersSection() {
  const invoiceGroupRepository = useInvoiceGroupRepository();
  const [groupsByDate, setGroupsByDate] = useState<Array<[string, InvoiceGroup[]]> | null>(null);

  async function load() {
    const all = await invoiceGroupRepository.list();
    const inProgress = all.filter(group => !group.supersededByGroupId && group.stage !== "shipment_closed" && group.stage !== "dispatched");
    const map = new Map<string, InvoiceGroup[]>();
    for (const group of inProgress) map.set(group.expectedDate, [...(map.get(group.expectedDate) || []), group]);
    setGroupsByDate([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  if (!groupsByDate) return (
    <section className={styles.section} aria-labelledby="in-progress-orders-title">
      <h2 id="in-progress-orders-title">진행 중 발주</h2>
      <button type="button" className={styles.primaryPink} onClick={() => void load()}>진행 중 발주 조회</button>
    </section>
  );
  if (groupsByDate.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="in-progress-orders-title">
      <h2 id="in-progress-orders-title">진행 중 발주 · {groupsByDate.length}개</h2>
      <div className={styles.workGrid}>
        {groupsByDate.map(([expectedDate, groups]) => {
          const poCount = groups.reduce((sum, group) => sum + group.purchaseOrderNumbers.length, 0);
          const skuCount = groups.reduce((sum, group) => sum + group.skuCount, 0);
          const totalQuantity = groups.reduce((sum, group) => sum + group.totalQuantity, 0);
          const centers = [...new Set(groups.map(group => group.fulfillmentCenter))];
          const currentStage = groups.map(group => group.stage).sort((a, b) => INVOICE_GROUP_STAGE_ORDER.indexOf(a) - INVOICE_GROUP_STAGE_ORDER.indexOf(b))[0];
          return (
            <div key={expectedDate} className={styles.work}>
              <div className={styles.row}>
                <h3>{formatInboundDateTitle(expectedDate)}</h3>
                <span className={styles.badge}>● {INVOICE_GROUP_STAGE_LABEL[currentStage]}</span>
              </div>
              <p className={styles.metrics}>발주 {poCount}건 · SKU {skuCount}종 · 총수량 {totalQuantity}개 · 센터 {centers.length}곳</p>
              <p className={styles.muted}>입고예정일 {expectedDate}</p>
              <Link href={`/wms/logistics/dates/${encodeURIComponent(expectedDate)}`} className={styles.primaryPink}>
                발주확정 및 쉽먼트생성 →
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function WmsWorkCenterPage() {
  return (
    <main className={`shell wms-work-center-shell ${styles.shell}`} style={{ fontFamily: "sans-serif" }}>
      <AppNavigation active="work-center" />
      <InProgressOrdersSection />
      {/* 상단 메뉴 4개 — 예전 "오늘 할 일" 화면의 .tasks(태스크 카드) 패턴 재사용. 첫 카드는
       *  .task:first-child 규칙으로 자동으로 전체폭이 된다(기존 CSS 그대로, 새로 안 건드림). */}
      <div className={styles.tasks}>
        <section className={styles.task}>
          <h2>입고결과 누적</h2>
          <p>SKU별 누적 입고 수량을 월별로 조회합니다.</p>
          <Link className={styles.taskButtonGrayWhite} href="/wms/inbound/cumulative">누적 조회</Link>
        </section>
        <section className={styles.task}>
          <h2>상품공급상태</h2>
          <p>쿠팡 승인완료 상품 정보를 제품DB에 반영합니다.</p>
          <SupplyStatusUpdateButton />
        </section>
        <section className={styles.task}>
          <h2>발주서작업</h2>
          <p>입고예정일이 가까운 발주서부터 확인하고 발주묶음을 만듭니다.</p>
          <Link className={styles.primaryPink} href="/wms/logistics/new-orders">발주서 검색·처리 시작</Link>
        </section>
        <section className={styles.task}>
          <h2>입고결과 처리</h2>
          <p>거래처 발주·단종 처리·미납분 재발주를 한곳에서 진행합니다.</p>
          <Link className={styles.taskButtonBeige} href="/wms/vendor-orders">입고결과 확인</Link>
        </section>
      </div>

      <ShortageVendorOrdersBanner />
    </main>
  );
}
