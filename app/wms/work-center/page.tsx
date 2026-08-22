"use client";

import { useEffect, useState } from "react";
import {
  SAMPLE_WORK_BATCHES,
  countBoxesInBatch,
  countOptionsInBatch,
} from "@/lib/wms/picking-sample-data";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton } from "@/lib/wms/ui-tokens";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { PICKING_WAVE_STATUS_LABEL } from "@/lib/wms/picking-wave/status-label";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import { UNASSIGNED_VENDOR_NAME } from "@/lib/wms/vendor-order/types";
import { TruckIcon } from "../icons";
import WorkCenterMenuButton from "./WorkCenterMenuButton";
import SupplyStatusUpdateButton from "./SupplyStatusUpdateButton";
import NewPurchaseOrdersUpdateButton from "./NewPurchaseOrdersUpdateButton";

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

/** 작업이 끝나지 않은 웨이브를 첫 화면에서 바로 이어서 열 수 있게 보여준다. */
function ActiveWavesList() {
  const waveRepository = usePickingWaveRepository();
  const [waves, setWaves] = useState<PickingWave[] | null>(null);

  useEffect(() => {
    waveRepository.listWaves().then(loaded => {
      setWaves(loaded
        .filter(wave => wave.status !== "order_confirmed")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    });
  }, [waveRepository]);

  if (!waves || waves.length === 0) return null;

  return (
    <section style={{ marginBottom: "18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <h2 style={{ margin: 0, fontSize: "16px" }}>현재 진행중인 웨이브</h2>
        <a href="/wms/picking/waves" style={{ fontSize: "11px", color: wmsColors.muted }}>전체보기</a>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {waves.map(wave => (
          <a key={wave.id} href={`/wms/picking/waves/${wave.id}`} style={{ display: "block", textDecoration: "none" }}>
            <div style={{ background: "#ffffff", border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                <strong style={{ fontSize: "14px", color: wmsColors.ink }}>{wave.displayName || wave.id}</strong>
                <span style={{ flexShrink: 0, fontSize: "11px", fontWeight: 800, color: wave.status === "in_progress" ? wmsColors.warn : wmsColors.greenDark }}>
                  {PICKING_WAVE_STATUS_LABEL[wave.status]}
                </span>
              </div>
              <div style={{ marginTop: "4px", fontSize: "11px", color: wmsColors.muted }}>
                {wave.id} · 발주서 {wave.sourcePurchaseOrderNumbers.length}건
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

export default function WmsWorkCenterPage() {
  const totalBoxes = SAMPLE_WORK_BATCHES.reduce((sum, batch) => sum + countBoxesInBatch(batch), 0);
  const totalSkus = SAMPLE_WORK_BATCHES.reduce((sum, batch) => sum + countOptionsInBatch(batch), 0);

  return (
    <main
      className="shell"
      style={{
        maxWidth: WMS_MOBILE_WIDTH,
        paddingTop: "12px",
        paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
        fontFamily: "sans-serif",
        color: wmsColors.ink,
        minHeight: "100vh",
      }}
    >
      {/* AI 상품등록 도우미(app/page.tsx)의 .hero/.hero h1을 그대로 재사용 — 제목을 흰색 박스에
       *  가두지 않고 페이지 기본 배경 위에 직접 표시(2026-08-20 실기기 추가 확인 1번). main도
       *  더 이상 자체 흰색 배경을 칠하지 않아 "각진 흰색 외곽 패널" 인상이 사라진다. */}
      <div className="hero">
        <h1>작업센터</h1>
      </div>

      {/* 상단 메뉴 3개 — 전부 WorkCenterMenuButton 하나만 재사용해 크기·아이콘 위치·글자
       *  위치를 완전히 통일한다(2026-08-20 신규). 모바일은 1열 세로, 760px 이상은 3열
       *  (app/globals.css .wms-work-center-menu). 나머지 두 버튼은 각자 상태(로딩중/완료 등)와
       *  결과 표시를 스스로 관리하는 자체완결 컴포넌트라 여기서는 배치만 한다. */}
      <div className="wms-work-center-menu" style={{ marginBottom: "18px" }}>
        <WorkCenterMenuButton
          href="/wms/vendor-orders"
          icon={<TruckIcon size={26} color={wmsColors.slateDark} />}
          title="거래처 발주관리"
          tint="rgba(83,109,120,0.10)"
          borderTint="rgba(83,109,120,0.35)"
          textColor={wmsColors.slateDark}
        />
        <SupplyStatusUpdateButton />
        <NewPurchaseOrdersUpdateButton />
      </div>

      <ShortageVendorOrdersBanner />

      <a href="/wms/picking/waves" style={{ display: "block", textDecoration: "none", marginBottom: "18px" }}>
        <button style={{ ...wmsPrimaryButton, width: "100%" }}>통합 피킹 시작 (실제 발주 기준)</button>
      </a>

      <ActiveWavesList />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "8px",
          background: wmsColors.surfaceBeige,
          border: `1px solid ${wmsColors.border}`,
          borderRadius: "14px",
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
    </main>
  );
}
