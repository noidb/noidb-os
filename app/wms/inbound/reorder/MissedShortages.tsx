"use client";
import { useEffect, useState } from "react";

type Line = { lineKey: string; skuId: string; productName: string; shipmentNumber: string; purchaseOrderNumber: string; remainingQuantity: number | null;
  kind: string; state: string; reviewReason?: string; route?: { decision: string }; target: { expectedDate: string } };
type Filter = "all" | "open" | "sent";

const decisionLabel: Record<string, string> = { reorder: "재발주요청", vendor: "거래처발주", discontinue: "단종", marketing: "쿠폰·광고" };

/**
 * 입고결과(9/13 이후 마감 쉽먼트)의 전체 미납 목록(2026-10-08).
 * 줄마다 지금 어디로 보냈는지 보여 주고, 미분류는 재발주요청에 넣고, 잘못 보낸 줄은 재발주요청으로 바꾼다.
 */
export default function MissedShortages({ onAdded }: { onAdded: () => void }) {
  const [lines, setLines] = useState<Line[]>([]), [covered, setCovered] = useState<Record<string, unknown>>({}), [collectedAt, setCollectedAt] = useState("");
  const [busyKey, setBusyKey] = useState(""), [state, setState] = useState<"loading" | "ready" | "error">("loading"), [note, setNote] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  async function load() {
    setState("loading");
    try {
      const response = await fetch("/api/wms/logistics/receipts?view=board", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "입고결과를 불러오지 못했습니다.");
      setCovered(data.coveredByVendorOrder || {});
      setLines((data.board.lines as Line[]).filter(line => line.kind === "shortage" && ((line.remainingQuantity ?? 0) > 0 || line.route))
        .sort((a, b) => a.shipmentNumber.localeCompare(b.shipmentNumber) || a.skuId.localeCompare(b.skuId)));
      setCollectedAt(data.board.collectedAt || "");
      setState("ready");
    } catch (error) { setNote(error instanceof Error ? error.message : "입고결과를 불러오지 못했습니다."); setState("error"); }
  }
  useEffect(() => { void load(); }, []);
  const statusOf = (line: Line) => covered[line.lineKey] ? "기존 발주로 처리" : line.route ? decisionLabel[line.route.decision] || "처리됨"
    : line.state === "review" ? "확인 필요" : "미분류";
  async function toReorder(line: Line) {
    const current = statusOf(line);
    if (current !== "미분류" && !window.confirm(`SKU ${line.skuId}는 지금 '${current}'(으)로 보낸 상태예요. 재발주요청으로 바꿀까요?`)) return;
    setBusyKey(line.lineKey); setNote("");
    try {
      const response = await fetch("/api/wms/logistics/receipts/reroute", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineKey: line.lineKey, expectedCollectedAt: collectedAt }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "재발주요청에 넣지 못했습니다.");
      setNote(`SKU ${line.skuId}를 재발주요청에 넣었습니다.${data.note ? ` ${data.note}` : ""}`);
      await load();
      onAdded();
    } catch (error) { setNote(error instanceof Error ? error.message : "재발주요청에 넣지 못했습니다."); }
    finally { setBusyKey(""); }
  }
  const shown = lines.filter(line => filter === "all" || (filter === "open" ? statusOf(line) === "미분류" : statusOf(line) !== "미분류"));
  const count = (f: Filter) => lines.filter(line => f === "all" || (f === "open" ? statusOf(line) === "미분류" : statusOf(line) !== "미분류")).length;
  const cell = { padding: "9px 10px", fontSize: 15, verticalAlign: "middle" as const };
  return <section aria-label="전체 미납 목록" style={{ marginTop: 28 }}>
    <h2 style={{ margin: "0 0 6px", paddingLeft: 10, borderLeft: "4px solid #60766a", fontSize: 18 }}>
      전체 미납 목록 <span style={{ color: "#b42318", fontSize: 15 }}>{state === "ready" ? `${lines.length}건` : ""}</span>
    </h2>
    <p style={{ margin: "0 0 8px", color: "#52646d", fontSize: 14 }}>입고결과(9/13 이후 마감 쉽먼트)의 미납 전체예요. 줄마다 지금 어디로 보냈는지 보여요. 잘못 보낸 줄은 재발주요청으로 바꿀 수 있어요.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, margin: "0 0 10px" }}>
      {([["all", "전체"], ["open", "미분류"], ["sent", "이미 보낸 것"]] as const).map(([value, label]) =>
        <button key={value} type="button" className={filter === value ? "softSageButton" : "softApricotButton"} style={{ minHeight: 38 }} onClick={() => setFilter(value)}>{label} {state === "ready" ? count(value) : ""}</button>)}
    </div>
    {note && <p role="status" style={{ margin: "0 0 8px", fontWeight: 700 }}>{note}</p>}
    {state === "loading" && <p>입고결과 확인 중…</p>}
    {state === "ready" && !shown.length && <p>해당하는 미납이 없습니다.</p>}
    {state === "ready" && shown.length > 0 && <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr style={{ background: "#f3f7f8" }}>{["SKU", "상품명", "쉽먼트·발주", "미납", "지금 상태", ""].map(header => <th key={header} style={{ ...cell, fontSize: 13, textAlign: "left", color: "#48636d" }}>{header}</th>)}</tr></thead>
      <tbody>{shown.map(line => {
        const status = statusOf(line);
        return <tr key={line.lineKey} style={{ borderBottom: "1px solid #e6edef" }}>
          <td style={{ ...cell, whiteSpace: "nowrap", fontWeight: 700 }}>{line.skuId}</td>
          <td style={{ ...cell, color: "#1c2931" }}>{line.productName}</td>
          <td style={{ ...cell, whiteSpace: "nowrap", fontSize: 13, color: "#52646d" }}>{line.shipmentNumber}<br />발주 {line.purchaseOrderNumber}</td>
          <td style={{ ...cell, color: "#b42318", fontWeight: 800, whiteSpace: "nowrap" }}>{line.remainingQuantity ?? "-"}개</td>
          <td style={{ ...cell, whiteSpace: "nowrap", fontWeight: 700, color: status === "미분류" ? "#b42318" : status === "재발주요청" ? "#3f5a4b" : "#6b5a4a" }}>{status}</td>
          <td style={{ ...cell, textAlign: "right", width: 170 }}>
            {status === "재발주요청" ? null : status === "확인 필요" ? <span style={{ fontSize: 12, color: "#64757d" }}>입고결과에서 공급상태 확인</span> :
              <button type="button" className={status === "미분류" ? "softSageButton" : "softApricotButton"} style={{ minHeight: 34, width: 160, padding: "6px 10px", fontSize: 13, whiteSpace: "nowrap" }}
                disabled={Boolean(busyKey)} onClick={() => void toReorder(line)}>{busyKey === line.lineKey ? "넣는 중…" : status === "미분류" ? "재발주요청에 추가" : "재발주요청으로 바꾸기"}</button>}
          </td>
        </tr>;
      })}</tbody>
    </table></div>}
    {state === "error" && <p role="alert">{note}</p>}
  </section>;
}
