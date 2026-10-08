"use client";
import { useEffect, useState } from "react";

type Line = { lineKey: string; skuId: string; productName: string; shipmentNumber: string; purchaseOrderNumber: string; remainingQuantity: number | null;
  kind: string; state: string; target: { expectedDate: string } };

/**
 * 입고결과의 실제 미납 SKU 중 아직 분류하지 않은 줄(2026-10-08).
 * 재발주요청 목록과 비교해 놓친 게 있으면 여기서 바로 재발주요청에 넣는다.
 */
export default function MissedShortages({ onAdded }: { onAdded: () => void }) {
  const [lines, setLines] = useState<Line[]>([]), [collectedAt, setCollectedAt] = useState("");
  const [busyKey, setBusyKey] = useState(""), [state, setState] = useState<"loading" | "ready" | "error">("loading"), [note, setNote] = useState("");
  async function load() {
    setState("loading");
    try {
      const response = await fetch("/api/wms/logistics/receipts?view=board", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "입고결과를 불러오지 못했습니다.");
      const covered = new Set(Object.keys(data.coveredByVendorOrder || {}));
      setLines((data.board.lines as Line[]).filter(line => line.kind === "shortage" && line.state === "ready" && (line.remainingQuantity ?? 0) > 0 && !covered.has(line.lineKey)));
      setCollectedAt(data.board.collectedAt || "");
      setState("ready");
    } catch (error) { setNote(error instanceof Error ? error.message : "입고결과를 불러오지 못했습니다."); setState("error"); }
  }
  useEffect(() => { void load(); }, []);
  async function add(line: Line) {
    setBusyKey(line.lineKey); setNote("");
    try {
      const response = await fetch("/api/wms/logistics/receipts/route-item", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineKey: line.lineKey, decision: "reorder", expectedCollectedAt: collectedAt }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "재발주요청에 넣지 못했습니다.");
      setLines(current => current.filter(item => item.lineKey !== line.lineKey));
      setNote(`SKU ${line.skuId}를 재발주요청에 넣었습니다.`);
      onAdded();
    } catch (error) { setNote(error instanceof Error ? error.message : "재발주요청에 넣지 못했습니다."); }
    finally { setBusyKey(""); }
  }
  return <section aria-label="아직 분류하지 않은 실제 미납" style={{ marginTop: 28 }}>
    <h2 style={{ margin: "0 0 6px", paddingLeft: 10, borderLeft: "4px solid #60766a", fontSize: 18 }}>
      아직 분류하지 않은 실제 미납 <span style={{ color: "#b42318", fontSize: 15 }}>{state === "ready" ? `${lines.length}건` : ""}</span>
    </h2>
    <p style={{ margin: "0 0 8px", color: "#52646d", fontSize: 13 }}>입고결과(9/13 이후 마감 쉽먼트)의 미납 중 단종·거래처발주·재발주요청 어디에도 보내지 않은 줄이에요. 놓친 게 있으면 바로 넣으세요.</p>
    {note && <p role="status" style={{ margin: "0 0 8px", fontWeight: 700 }}>{note}</p>}
    {state === "loading" && <p>입고결과 확인 중…</p>}
    {state === "ready" && !lines.length && <p>놓친 미납이 없습니다.</p>}
    {state === "ready" && lines.length > 0 && <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead><tr style={{ background: "#f3f7f8" }}>{["SKU", "상품명", "쉽먼트·발주", "미납", ""].map(header => <th key={header} style={{ textAlign: "left", padding: "8px 10px" }}>{header}</th>)}</tr></thead>
      <tbody>{lines.map(line => <tr key={line.lineKey} style={{ borderBottom: "1px solid #e6edef" }}>
        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{line.skuId}</td>
        <td style={{ padding: "8px 10px" }}>{line.productName}</td>
        <td style={{ padding: "8px 10px", whiteSpace: "nowrap", fontSize: 12, color: "#52646d" }}>{line.shipmentNumber}<br />발주 {line.purchaseOrderNumber}</td>
        <td style={{ padding: "8px 10px", color: "#b42318", fontWeight: 800 }}>{line.remainingQuantity}개</td>
        <td style={{ padding: "8px 10px", textAlign: "right" }}>
          <button type="button" className="softSageButton" style={{ minHeight: 34, padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }}
            disabled={Boolean(busyKey)} onClick={() => void add(line)}>{busyKey === line.lineKey ? "넣는 중…" : "재발주요청에 추가"}</button>
        </td>
      </tr>)}</tbody>
    </table></div>}
    {state === "error" && <p role="alert">{note}</p>}
  </section>;
}
