"use client";

import { useState } from "react";
import { wmsColors } from "@/lib/wms/ui-tokens";

type HistoryRow = {
  expectedDate: string;
  centerName: string;
  shipmentNumber: string;
  purchaseOrderNumber: string;
  skuId: string;
  productName: string;
  receivedQuantity: number;
};
type DateSummary = {
  expectedDate: string;
  shipmentCount: number;
  purchaseOrderCount: number;
  skuCount: number;
  receivedQuantity: number;
};
type HistoryResponse = { rows: HistoryRow[]; dates: DateSummary[]; error?: string };

export function ClosedShipmentHistory() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/wms/logistics/closed-receipt-history", { cache: "no-store" });
      const result = await response.json() as HistoryResponse;
      if (!response.ok) throw new Error(result.error || "마감 쉽먼트 이력을 불러오지 못했습니다.");
      setData(result);
      setSelectedDate(previous => previous && result.dates.some(date => date.expectedDate === previous) ? previous : result.dates[0]?.expectedDate || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "마감 쉽먼트 이력을 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) void load();
  }

  const visibleRows = data?.rows.filter(row => row.expectedDate === selectedDate) || [];
  return <section style={{ marginTop: "20px", paddingTop: "16px", borderTop: `1px solid ${wmsColors.border}` }}>
    <button type="button" onClick={toggle} style={{ padding: "10px 12px", border: `1px solid ${wmsColors.border}`, borderRadius: "8px", background: "#fff", fontWeight: 800, cursor: "pointer" }}>
      {open ? "마감 쉽먼트 이력 닫기" : "마감 쉽먼트 이력 보기"}
    </button>
    {open ? <div style={{ marginTop: "12px" }}>
      <p style={{ margin: "0 0 10px", color: wmsColors.muted, fontSize: "13px" }}>저장된 마감 수집본만 조회합니다. 월별 누적 수량에는 더하지 않습니다.</p>
      {loading ? <p style={{ color: wmsColors.muted }}>마감 쉽먼트 이력을 불러오는 중...</p> : error ? <p role="alert" style={{ color: "#a33" }}>{error}</p> : !data?.dates.length ? <p style={{ color: wmsColors.muted }}>저장된 마감 쉽먼트 이력이 없습니다.</p> : <>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          <label style={{ fontSize: "12px", fontWeight: 700 }}>입고예정일
            <select value={selectedDate} onChange={event => setSelectedDate(event.target.value)} style={{ display: "block", marginTop: "4px", padding: "8px", border: `1px solid ${wmsColors.border}`, borderRadius: "8px", background: "#fff" }}>
              {data.dates.map(date => <option key={date.expectedDate} value={date.expectedDate}>{date.expectedDate}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void load()} style={{ padding: "8px", border: `1px solid ${wmsColors.border}`, borderRadius: "8px", background: "#fff", cursor: "pointer" }}>새로고침</button>
        </div>
        <div style={{ display: "grid", gap: "6px", marginBottom: "12px" }}>
          {data.dates.map(date => <button type="button" key={date.expectedDate} onClick={() => setSelectedDate(date.expectedDate)} style={{ textAlign: "left", padding: "9px", border: `1px solid ${selectedDate === date.expectedDate ? wmsColors.slateDark : wmsColors.border}`, borderRadius: "8px", background: selectedDate === date.expectedDate ? wmsColors.surfaceBeige : "#fff", cursor: "pointer" }}>
            <strong>{date.expectedDate}</strong> · 쉽먼트 {date.shipmentCount}건 · 발주 {date.purchaseOrderCount}건 · SKU {date.skuCount}건 · 입고 {date.receivedQuantity.toLocaleString()}개
          </button>)}
        </div>
        <div style={{ overflowX: "auto", border: `1px solid ${wmsColors.border}`, borderRadius: "10px", background: "#fff" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}><thead><tr>{["입고예정일", "센터", "쉽먼트", "발주번호", "SKU", "상품명", "입고수량"].map(label => <th key={label} scope="col" style={{ padding: "9px 7px", textAlign: "left", whiteSpace: "nowrap", background: wmsColors.surfaceBeige, borderBottom: `1px solid ${wmsColors.border}` }}>{label}</th>)}</tr></thead><tbody>{visibleRows.map(row => <tr key={[row.shipmentNumber, row.purchaseOrderNumber, row.skuId, row.productName].join(":")}><td style={{ padding: "9px 7px", borderBottom: `1px solid ${wmsColors.border}`, whiteSpace: "nowrap" }}>{row.expectedDate}</td><td style={{ padding: "9px 7px", borderBottom: `1px solid ${wmsColors.border}` }}>{row.centerName}</td><td style={{ padding: "9px 7px", borderBottom: `1px solid ${wmsColors.border}`, whiteSpace: "nowrap" }}>{row.shipmentNumber}</td><td style={{ padding: "9px 7px", borderBottom: `1px solid ${wmsColors.border}`, whiteSpace: "nowrap" }}>{row.purchaseOrderNumber}</td><td style={{ padding: "9px 7px", borderBottom: `1px solid ${wmsColors.border}`, whiteSpace: "nowrap" }}>{row.skuId}</td><td style={{ padding: "9px 7px", borderBottom: `1px solid ${wmsColors.border}` }}>{row.productName}</td><td style={{ padding: "9px 7px", borderBottom: `1px solid ${wmsColors.border}`, fontWeight: 800, whiteSpace: "nowrap" }}>{row.receivedQuantity.toLocaleString()}개</td></tr>)}</tbody></table></div>
      </>}
    </div> : null}
  </section>;
}
