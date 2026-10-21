"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { wmsColors } from "@/lib/wms/ui-tokens";
import SupplyStatusAuditPanel from "@/app/product-registration/SupplyStatusAuditPanel";
import WimsRegistrationImportPanel from "@/app/product-registration/WimsRegistrationImportPanel";
import WarehouseRecheckCleanup from "@/app/wms/inbound/shipments/WarehouseRecheckCleanup";

/**
 * 작업센터 맨 위 '매일 할 일'(2026-10-21 사용자 요청).
 * 매일 수시로 하는 다섯 가지가 화면 여기저기 흩어져 있어 잊기 쉬워서 한곳에 모은다.
 * - 공급상태 최신파일·구글시트 정리·WIMS 등록상태는 원래 화면의 같은 부품을 그대로 넣어 여기서 바로 실행한다.
 * - 신규발주서·입고결과 가져오기는 그 화면(쿠팡 화면)으로 바로 연다.
 * - 오늘 했는지는 서버에 저장해 회사·집·모바일에서 같게 보인다. 부품은 펼칠 때만 그려서 화면을 열 때 느려지지 않는다.
 */
type RoutineId = "new-orders" | "receipts" | "supply-status" | "sheet-cleanup" | "wims";

const kstDay = (iso: string | number | Date) => new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const timeLabel = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function DailyRoutine() {
  const [doneAt, setDoneAt] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<RoutineId | null>(null);
  const [saving, setSaving] = useState("");
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/wms/daily-routine", { cache: "no-store" }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (active && response.ok && data.ok) setDoneAt(data.doneAt || {});
    }).catch(() => {}).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  const mark = useCallback(async (id: RoutineId, done = true) => {
    setSaving(id);
    try {
      const response = await fetch("/api/wms/daily-routine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, done }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "저장하지 못했습니다.");
      setDoneAt(data.doneAt || {});
    } catch (cause) {
      setNote({ text: cause instanceof Error ? cause.message : "저장하지 못했습니다.", error: true });
    } finally { setSaving(""); }
  }, []);

  const today = kstDay(Date.now());
  const isDoneToday = (id: RoutineId) => Boolean(doneAt[id] && kstDay(doneAt[id]) === today);

  const items: Array<{ id: RoutineId; title: string; summary: string; body: ReactNode }> = [
    {
      id: "new-orders", title: "신규발주서 다운로드·발주확정", summary: "새로 나온 발주서를 받아 발주확정까지 진행합니다.",
      body: <Link className="softPinkButton" style={{ width: "100%", textDecoration: "none" }} href="/wms/logistics/new-orders" onClick={() => void mark("new-orders")}>신규 발주서 화면 열기</Link>,
    },
    {
      id: "receipts", title: "입고결과 가져오기", summary: "쿠팡 쉽먼트 화면에서 확장 버튼 '입고결과 일괄 가져오기'를 누릅니다.",
      body: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <a className="softBeigeButton" style={{ textDecoration: "none" }} href="https://supplier.coupang.com/ibs/asn/active" target="_blank" rel="noreferrer" onClick={() => void mark("receipts")}>쿠팡 쉽먼트 화면 열기</a>
          <Link className="softSageButton" style={{ textDecoration: "none" }} href="/wms/vendor-orders?tab=results">입고결과 처리 화면</Link>
        </div>
      ),
    },
    {
      id: "supply-status", title: "상품공급상태 최신파일 반영", summary: "G드라이브 최신 상품공급상태 파일로 제품DB·보관 탭 발주가능상태를 맞춥니다.",
      body: <SupplyStatusAuditPanel compact onApplied={() => void mark("supply-status")} />,
    },
    {
      id: "sheet-cleanup", title: "구글시트 정리", summary: "제품DB·보관 탭 사이에 옮길 행(단종 → 보관, 재고있음 → 제품DB)을 정리합니다.",
      body: <WarehouseRecheckCleanup onDone={(text, isError) => { setNote({ text, error: isError }); if (!isError) void mark("sheet-cleanup"); }} />,
    },
    {
      id: "wims", title: "WIMS 상품등록상태 확인", summary: "WIMS 화면에서 확장 기능 'WIMS 전체를 NOID-B로 전송'을 눌러 등록 결과를 가져옵니다.",
      body: <WimsRegistrationImportPanel />,
    },
  ];
  const doneCount = items.filter(item => isDoneToday(item.id)).length;

  return (
    <section aria-label="매일 할 일" style={{ border: `1px solid ${wmsColors.border}`, background: "#fff", borderRadius: 14, padding: "14px 16px", margin: "0 0 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: wmsColors.ink, paddingLeft: 10, borderLeft: "4px solid #60766a" }}>매일 할 일</h2>
        <strong style={{ fontSize: 14, color: doneCount === items.length ? "#3f574b" : "#7f4032" }}>{loaded ? `오늘 ${items.length}개 중 ${doneCount}개 완료` : "기록 확인 중…"}</strong>
      </div>
      {note && <p role={note.error ? "alert" : "status"} style={{ margin: "0 0 10px", fontSize: 13, color: note.error ? "#a33" : "#3f574b" }}>{note.text}</p>}
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((item, index) => {
          const done = isDoneToday(item.id);
          const isOpen = open === item.id;
          return (
            <article key={item.id} style={{ border: `1px solid ${done ? "#b9cbbc" : "#e5dace"}`, background: done ? "#f3f8f4" : "#fbf8f4", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) minmax(150px, 220px)", gap: 10, alignItems: "center" }}>
                <span style={{ width: 26, height: 26, borderRadius: 999, background: done ? "#60766a" : "#fff", border: "1px solid #60766a", color: done ? "#fff" : "#60766a", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>{done ? "✓" : index + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: 15, color: wmsColors.ink }}>{item.title}</strong>
                  <span style={{ display: "block", fontSize: 12, color: wmsColors.muted }}>
                    {done ? `오늘 ${timeLabel(doneAt[item.id])} 완료` : doneAt[item.id] ? `마지막 ${timeLabel(doneAt[item.id])} · 오늘 아직 안 함` : item.summary}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <button type="button" className={isOpen ? "softApricotButton" : "softSageButton"} style={{ minHeight: 38, padding: "6px 8px", fontSize: 13 }} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : item.id)}>{isOpen ? "접기" : "하기"}</button>
                  <button type="button" className={done ? "softApricotButton" : "softBeigeButton"} style={{ minHeight: 38, padding: "6px 8px", fontSize: 13 }} disabled={saving === item.id} onClick={() => void mark(item.id, !done)}>{saving === item.id ? "저장 중…" : done ? "완료 취소" : "오늘 완료"}</button>
                </div>
              </div>
              {isOpen && <div style={{ marginTop: 10 }}>{item.body}</div>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
