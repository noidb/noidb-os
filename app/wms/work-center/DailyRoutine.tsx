"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
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
 * - 항목마다 마지막으로 처리한 시각을 서버에 남겨 회사·집·모바일에서 같게 보인다(하기·바로가기를 누르거나 반영·정리를 마쳤을 때).
 * - 부품은 펼칠 때만 그려 화면을 열 때 느려지지 않는다.
 */
type RoutineId = "supply-status" | "new-orders" | "receipts" | "sheet-cleanup" | "wims";
const timeLabel = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });

export default function DailyRoutine() {
  const [open, setOpen] = useState<RoutineId | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [doneAt, setDoneAt] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    // 2026-10-21: 마지막 처리 시각은 이 브라우저에 기억해 둔 것을 먼저 보여 주고 서버 값으로 맞춘다.
    try { const remembered = JSON.parse(window.localStorage.getItem("noidb-daily-routine-done") || "null"); if (remembered) { setDoneAt(remembered); setLoaded(true); } } catch { /* 없음 */ }
    void fetch("/api/wms/daily-routine", { cache: "no-store" }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (active && response.ok && data.ok) { setDoneAt(data.doneAt || {}); try { window.localStorage.setItem("noidb-daily-routine-done", JSON.stringify(data.doneAt || {})); } catch { /* 저장 못 해도 동작 */ } }
    }).catch(() => {}).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);
  /** 마지막 처리 시각 남기기. 화면은 바로 바꾸고 저장은 뒤에서 한다(실패해도 작업은 막지 않음). */
  const mark = useCallback((id: RoutineId) => {
    setDoneAt(current => ({ ...current, [id]: new Date().toISOString() }));
    void fetch("/api/wms/daily-routine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }), keepalive: true })
      .then(async response => { const data = await response.json().catch(() => ({})); if (response.ok && data.ok) { setDoneAt(data.doneAt || {}); try { window.localStorage.setItem("noidb-daily-routine-done", JSON.stringify(data.doneAt || {})); } catch { /* 저장 못 해도 동작 */ } } })
      .catch(() => {});
  }, []);

  // 2026-10-23: 확장 'WIMS 전체를 NOID-B로 전송'이 열어 준 주소(?open=wims)는 WIMS 칸을 바로 펼쳐 전송 내용을 받는다.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("open") !== "wims") return;
    setOpen("wims");
    mark("wims");
    const timer = window.setTimeout(() => document.getElementById("routine-wims")?.scrollIntoView({ block: "start" }), 150);
    return () => window.clearTimeout(timer);
  }, [mark]);

  // '새로고침'·'정리행 미리보기'를 다시 누르면 같은 칸을 처음부터 다시 실행한다(부품을 새로 그림).
  const [runKey, setRunKey] = useState(0);
  const items: Array<{ id: RoutineId; title: string; summary: string; label: string; rerun?: boolean; shortcut?: string; siteLink?: string; body?: ReactNode }> = [
    {
      id: "supply-status", title: "상품공급상태 최신파일 반영",
      summary: "쿠팡에서 상품공급상태 파일을 받아 G드라이브에 올린 뒤, 제품DB·비관리SKU 탭 발주가능상태를 맞춥니다.",
      shortcut: "https://supplier.coupang.com/plan/ticket",
      // 2026-10-21: '새로고침'이 곧 '최신파일 확인하기' — 누르면 바로 확인하고 결과(반영할 항목)만 보여 준다.
      label: "새로고침", rerun: true,
      body: <SupplyStatusAuditPanel key={runKey} headless autoRun onAudited={() => mark("supply-status")} onApplied={() => mark("supply-status")} />,
    },
    {
      id: "new-orders", title: "신규발주서 다운로드·발주확정",
      summary: "새로 나온 발주서를 받아 발주확정까지 진행합니다.",
      shortcut: "https://supplier.coupang.com/po-web/purchase/order/list",
      label: "발주서작업", siteLink: "/wms/logistics/new-orders",
    },
    {
      id: "receipts", title: "입고결과 가져오기",
      summary: "쿠팡 쉽먼트 화면에서 확장 버튼 '입고결과 일괄 가져오기'를 누른 뒤 입고결과를 처리합니다.",
      shortcut: "https://supplier.coupang.com/ibs/asn/active",
      label: "결과보기", siteLink: "/wms/vendor-orders?tab=results",
    },
    {
      id: "sheet-cleanup", title: "구글시트 정리",
      summary: "제품DB·비관리SKU 탭 사이에 옮길 행(단종 → 비관리SKU, 재고있음 → 제품DB)을 정리합니다.",
      // 2026-10-21: 누르면 바로 정리할 행 목록을 보여 준다.
      label: "정리행 미리보기", rerun: true,
      body: <WarehouseRecheckCleanup key={runKey} embedded autoLoad onClose={() => setOpen(null)} onDone={(text, isError) => { setNote({ text, error: isError }); if (!isError) { mark("sheet-cleanup"); setOpen(null); } }} />,
    },
    {
      id: "wims", title: "WIMS 상품등록상태 확인",
      summary: "WIMS 화면에서 확장 기능 'WIMS 전체를 NOID-B로 전송'을 눌러 등록 결과를 가져옵니다.",
      label: "결과보기",
      body: <WimsRegistrationImportPanel />,
    },
  ];

  const buttonStyle = { minHeight: 38, padding: "6px 8px", fontSize: 13, textDecoration: "none" } as const;
  // 2026-10-23 사용자 요청: 화면이 단조롭지 않게 사이트 원래 색(세이지·샌드·클레이핑크)을 번호 배지와 왼쪽 띠에 돌려 쓴다.
  const accents = [
    { bar: "#60766a", badgeBg: "#60766a", badgeBorder: "#60766a", badgeText: "#fff" },
    { bar: "#cdb99f", badgeBg: "#e9ddcf", badgeBorder: "#cdb99f", badgeText: "#6b5a3f" },
    { bar: "#d9b8ab", badgeBg: "#f2dfd8", badgeBorder: "#d9b8ab", badgeText: "#8a5a4b" },
  ] as const;
  return (
    <section aria-label="자주 하는 일" style={{ border: `1px solid ${wmsColors.border}`, background: "#fff", borderRadius: 14, padding: "14px 16px", margin: "0 0 18px" }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 18, color: wmsColors.ink, paddingLeft: 10, borderLeft: "4px solid #60766a" }}>자주 하는 일</h2>
      {note && <p role={note.error ? "alert" : "status"} style={{ margin: "0 0 10px", fontSize: 13, color: note.error ? "#a33" : "#3f574b" }}>{note.text}</p>}
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((item, index) => {
          const isOpen = open === item.id;
          // 하기: 사이트 화면으로 이동(siteLink) 또는 이 자리에서 펼치기(body)
          const doButton = item.siteLink
            ? <Link className="softSageButton" style={buttonStyle} href={item.siteLink} onClick={() => mark(item.id)}>{item.label}</Link>
            : item.rerun
              ? <button type="button" className="softSageButton" style={buttonStyle} onClick={() => { setRunKey((value) => value + 1); setOpen(item.id); }}>{item.label}</button>
              : <button type="button" className={isOpen ? "softApricotButton" : "softSageButton"} style={buttonStyle} aria-expanded={isOpen} onClick={() => { if (!isOpen) mark(item.id); setOpen(isOpen ? null : item.id); }}>{isOpen ? "접기" : item.label}</button>;
          return (
            <article key={item.id} id={`routine-${item.id}`} style={{ border: "1px solid #e5dace", borderLeft: `5px solid ${accents[index % accents.length].bar}`, background: "#fbf8f4", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) minmax(150px, 220px)", gap: 10, alignItems: "center" }}>
                <span style={{ width: 26, height: 26, borderRadius: 999, background: accents[index % accents.length].badgeBg, border: `1px solid ${accents[index % accents.length].badgeBorder}`, color: accents[index % accents.length].badgeText, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>{index + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: 15, color: wmsColors.ink }}>{item.title}</strong>
                  <span style={{ display: "block", fontSize: 12, color: wmsColors.muted }}>{item.summary}</span>
                  <span style={{ display: "block", fontSize: 12, marginTop: 2, color: doneAt[item.id] ? "#4d6a5a" : wmsColors.muted, fontWeight: doneAt[item.id] ? 700 : 400 }}>
                    {!loaded ? "마지막 처리 확인 중…" : doneAt[item.id] ? `마지막 처리 ${timeLabel(doneAt[item.id])}` : "마지막 처리 기록 없음"}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: item.shortcut ? "1fr 1fr" : "1fr", gap: 6 }}>
                  {doButton}
                  {item.shortcut && <a className="softBeigeButton" style={buttonStyle} href={item.shortcut} target="_blank" rel="noreferrer" onClick={() => mark(item.id)}>바로가기</a>}
                </div>
              </div>
              {isOpen && item.body && (
                <div style={{ marginTop: 10 }}>
                  {item.body}
                  {item.id === "supply-status" && (
                    <button type="button" className="softApricotButton" style={{ ...buttonStyle, width: "100%", marginTop: 8 }} onClick={() => setOpen(null)}>닫기</button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
