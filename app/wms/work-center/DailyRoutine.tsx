"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { wmsColors } from "@/lib/wms/ui-tokens";
import SupplyStatusAuditPanel from "@/app/product-registration/SupplyStatusAuditPanel";
import WimsRegistrationImportPanel from "@/app/product-registration/WimsRegistrationImportPanel";
import WarehouseRecheckCleanup from "@/app/wms/inbound/shipments/WarehouseRecheckCleanup";

/**
 * 작업센터 맨 위 '자주 하는 일'(2026-10-21 사용자 요청).
 * 매일·수시·며칠에 한 번 하는 일이 화면 여기저기 흩어져 있어 잊기 쉬워서 한곳에 모은다.
 * - '하기': 사이트 안에서 처리(공급상태 반영·구글시트 정리·WIMS 등록상태는 원래 화면의 같은 부품을 여기서 펼쳐 바로 실행).
 * - '바로가기': 그 일을 하는 쿠팡 화면을 새 탭으로 연다.
 * - 완료 기록은 두지 않는다(매일 하는 일이 아닌 것도 있어서). 부품은 펼칠 때만 그려 화면을 열 때 느려지지 않는다.
 */
type RoutineId = "supply-status" | "new-orders" | "receipts" | "sheet-cleanup" | "wims";

export default function DailyRoutine() {
  const [open, setOpen] = useState<RoutineId | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  const items: Array<{ id: RoutineId; title: string; summary: string; shortcut?: string; siteLink?: string; body?: ReactNode }> = [
    {
      id: "supply-status", title: "상품공급상태 최신파일 반영",
      summary: "쿠팡에서 상품공급상태 파일을 받아 G드라이브에 올린 뒤, 제품DB·보관 탭 발주가능상태를 맞춥니다.",
      shortcut: "https://supplier.coupang.com/plan/ticket",
      body: <SupplyStatusAuditPanel compact />,
    },
    {
      id: "new-orders", title: "신규발주서 다운로드·발주확정",
      summary: "새로 나온 발주서를 받아 발주확정까지 진행합니다.",
      shortcut: "https://supplier.coupang.com/po-web/purchase/order/list",
      siteLink: "/wms/logistics/new-orders",
    },
    {
      id: "receipts", title: "입고결과 가져오기",
      summary: "쿠팡 쉽먼트 화면에서 확장 버튼 '입고결과 일괄 가져오기'를 누른 뒤 입고결과를 처리합니다.",
      shortcut: "https://supplier.coupang.com/ibs/asn/active",
      siteLink: "/wms/vendor-orders?tab=results",
    },
    {
      id: "sheet-cleanup", title: "구글시트 정리",
      summary: "제품DB·보관 탭 사이에 옮길 행(단종 → 보관, 재고있음 → 제품DB)을 정리합니다.",
      body: <WarehouseRecheckCleanup onDone={(text, isError) => setNote({ text, error: isError })} />,
    },
    {
      id: "wims", title: "WIMS 상품등록상태 확인",
      summary: "WIMS 화면에서 확장 기능 'WIMS 전체를 NOID-B로 전송'을 눌러 등록 결과를 가져옵니다.",
      body: <WimsRegistrationImportPanel />,
    },
  ];

  const buttonStyle = { minHeight: 38, padding: "6px 8px", fontSize: 13, textDecoration: "none" } as const;
  return (
    <section aria-label="자주 하는 일" style={{ border: `1px solid ${wmsColors.border}`, background: "#fff", borderRadius: 14, padding: "14px 16px", margin: "0 0 18px" }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 18, color: wmsColors.ink, paddingLeft: 10, borderLeft: "4px solid #60766a" }}>자주 하는 일</h2>
      {note && <p role={note.error ? "alert" : "status"} style={{ margin: "0 0 10px", fontSize: 13, color: note.error ? "#a33" : "#3f574b" }}>{note.text}</p>}
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((item, index) => {
          const isOpen = open === item.id;
          // 하기: 사이트 화면으로 이동(siteLink) 또는 이 자리에서 펼치기(body)
          const doButton = item.siteLink
            ? <Link className="softSageButton" style={buttonStyle} href={item.siteLink}>하기</Link>
            : <button type="button" className={isOpen ? "softApricotButton" : "softSageButton"} style={buttonStyle} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : item.id)}>{isOpen ? "접기" : "하기"}</button>;
          return (
            <article key={item.id} style={{ border: "1px solid #e5dace", background: "#fbf8f4", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) minmax(150px, 220px)", gap: 10, alignItems: "center" }}>
                <span style={{ width: 26, height: 26, borderRadius: 999, background: "#fff", border: "1px solid #60766a", color: "#60766a", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>{index + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: 15, color: wmsColors.ink }}>{item.title}</strong>
                  <span style={{ display: "block", fontSize: 12, color: wmsColors.muted }}>{item.summary}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: item.shortcut ? "1fr 1fr" : "1fr", gap: 6 }}>
                  {doButton}
                  {item.shortcut && <a className="softBeigeButton" style={buttonStyle} href={item.shortcut} target="_blank" rel="noreferrer">바로가기</a>}
                </div>
              </div>
              {isOpen && item.body && <div style={{ marginTop: 10 }}>{item.body}</div>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
