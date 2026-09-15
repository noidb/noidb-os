"use client";
import { useEffect, useState } from "react";
import type { buildClearanceStatus } from "@/lib/wms/clearance-status";
type Summary = ReturnType<typeof buildClearanceStatus>;
export default function ClearanceOverview() {
  const [data,setData] = useState<Summary | null>(null), [error,setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => { try {
      const response = await fetch("/api/wms/clearance-status", { cache: "no-store" }), value = await response.json();
      if (!response.ok || !value.success) throw new Error(value.error || "조회 실패");
      if (active) { setData(value); setError(""); }
    } catch (e) { if (active) setError(e instanceof Error ? e.message : "조회 실패"); } };
    void load(); window.addEventListener("focus",load); window.addEventListener("noidb-inbound-updated",load);
    return () => { active = false; window.removeEventListener("focus",load); window.removeEventListener("noidb-inbound-updated",load); };
  },[]);
  return <section style={{ padding: 20, background: "#fff", borderRadius: 14 }} aria-label="과거청산 현황"><h1>과거청산 남은 업무</h1>
    {error && <p role="alert">{error}</p>}{!data && !error && <p>저장된 처리내역을 확인하는 중…</p>}
    {data && <><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
      {[
        ["미분류 실제미납", `${data.unclassified.pairs}건 / ${data.unclassified.quantity}개`, "#shortage-review"],
        ["쿠폰·광고 처리대기", `${data.coupon} SKU`, "#coupon-review"],
        ["단종 업로드 대기", `${data.discontinue}건`, "/wms/vendor-orders/status-requests"],
        ["쿠팡 미납 재발주", `${data.reorderPairs} 발주+SKU`, "/wms/inbound/reorder"],
        ["미전송 거래처 발주", `${data.unsent.drafts}장 / ${data.unsent.lines}라인`, "/wms/vendor-orders/manage"],
        ["전송 후 결과 미분류", `${data.sent.unclassified}라인`, "/wms/vendor-orders/receiving"],
        ["입고지연", `전송 후 ${data.sent.delayed}라인 · 최초분류 ${data.initialDelayed}건`, "/wms/vendor-orders/receiving"],
      ].map(([label,count,href]) => <a key={label} href={href} style={{ padding: 12, background: "#f5f2ec", color: "#29352f", borderRadius: 8 }}><strong>{label}</strong><p>{count}</p></a>)}
    </div><p>건수는 SKU·원발주+SKU·발주서·라인 단위가 다르므로 합산하지 않습니다. 파일 생성과 전송만으로 최종완료되지 않습니다.</p>
    {(data.conflicts > 0 || data.discontinueMissingPo.length > 0 || data.unresolved > 0) && <p role="alert">확인 필요: 목적지/연결 {data.conflicts}건 · 원발주 없는 단종 {data.discontinueMissingPo.length}건 · 계산불가 {data.unresolved}건</p>}</>}
  </section>;
}
