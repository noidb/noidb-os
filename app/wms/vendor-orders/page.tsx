"use client";

import type { ReactNode } from "react";
import { WMS_MOBILE_WIDTH, wmsColors } from "@/lib/wms/ui-tokens";
import { InboxIcon, TruckIcon } from "../icons";

/**
 * 거래처 발주관리 허브 (2026-08-19 4차 실사용 테스트 신규, 5차 실사용 테스트에서 카드 규격
 * 통일 + 명칭 변경 반영).
 *
 * 예전 이 경로(app/wms/vendor-orders/page.tsx)는 Sprint 2 샘플 피킹 흐름(picking-flow-context,
 * SAMPLE_WORK_BATCHES)에 연결된 "다음 스프린트 구현 예정" 안내 화면이었다 — 승인 버튼도
 * 비활성 상태였고 실제 데이터를 전혀 다루지 않았다. 지금은 실제 웨이브 기반 거래처 발주서
 * 기능(app/wms/picking/waves/[waveId]/vendor-orders)이 이미 완성돼 있으므로, 이 경로를
 * "거래처 발주서 생성"과 "거래처 발주서 입고"로 가는 진입 허브로 바꾼다 — 기존 화면을 다시
 * 만들지 않고 그대로 재사용한다.
 */
export default function VendorOrdersHubPage() {
  return (
    <main
      style={{
        maxWidth: WMS_MOBILE_WIDTH,
        margin: "0 auto",
        padding: "12px 12px calc(12px + env(safe-area-inset-bottom))",
        fontFamily: "sans-serif",
        background: wmsColors.background,
        color: wmsColors.ink,
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: "22px", margin: "0 0 4px" }}>거래처 발주관리</h1>
      <p style={{ fontSize: "13px", color: wmsColors.muted, margin: "0 0 18px" }}>
        웨이브에서 자동 계산된 부족분 발주서와, 발주 후 입고 처리를 여기서 관리합니다.
      </p>

      {/* 두 카드 모두 완전히 같은 VendorOrderHubMenuCard 컴포넌트를 재사용한다 — 카드별로 따로
       *  스타일을 만들지 않고, 색상(tint/borderTint/textColor)만 다르게 넘긴다. 아이콘은 고정
       *  56px 너비 칸에, 제목·설명은 오른쪽 칸에 동일한 위치로 배치되고, minHeight를 고정해
       *  설명 글자 수가 달라도 카드 높이가 달라지지 않는다 (2026-08-19 5차 실사용 테스트 반영). */}
      <VendorOrderHubMenuCard
        href="/wms/vendor-orders/manage"
        icon={<TruckIcon size={30} color={wmsColors.slateDark} />}
        title="거래처 발주서 생성"
        description="자동 부족분·초안·승인/전송완료 발주서 확인, 수동 발주서 새로 만들기"
        tint="rgba(83,109,120,0.10)"
        borderTint="rgba(83,109,120,0.35)"
        textColor={wmsColors.slateDark}
      />

      <VendorOrderHubMenuCard
        href="/wms/vendor-orders/receiving"
        icon={<InboxIcon size={30} color={wmsColors.greenDark} />}
        title="거래처 발주서 입고"
        description="승인·전송완료된 거래처 발주서의 입고수량 확인 및 기록"
        tint={wmsColors.greenSoft}
        borderTint={wmsColors.green}
        textColor={wmsColors.greenDark}
        last
      />
    </main>
  );
}

interface VendorOrderHubMenuCardProps {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  tint: string;
  borderTint: string;
  textColor: string;
  /** 마지막 카드는 아래쪽 여백을 넣지 않는다 — 카드 간격 자체는 동일하게 유지된다. */
  last?: boolean;
}

function VendorOrderHubMenuCard({ href, icon, title, description, tint, borderTint, textColor, last }: VendorOrderHubMenuCardProps) {
  return (
    <a href={href} style={{ display: "block", textDecoration: "none", marginBottom: last ? 0 : "14px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "56px 1fr",
          alignItems: "center",
          gap: "16px",
          minHeight: "104px",
          padding: "20px",
          border: `1px solid ${borderTint}`,
          borderRadius: "14px",
          background: tint,
        }}
      >
        <div style={{ width: "56px", height: "56px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: "17px", fontWeight: 800, color: textColor }}>{title}</div>
          <div style={{ fontSize: "12px", color: textColor, marginTop: "4px", opacity: 0.85, lineHeight: 1.5 }}>{description}</div>
        </div>
      </div>
    </a>
  );
}
