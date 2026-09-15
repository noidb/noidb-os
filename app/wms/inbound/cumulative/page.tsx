"use client";

import { useEffect, useMemo, useState } from "react";
import { WMS_MOBILE_WIDTH, wmsColors, wmsGhostButton } from "@/lib/wms/ui-tokens";

type MonthlyInboundRow = {
  year: number;
  month: number;
  skuId: string;
  actualReceivedQuantity: number;
};

type CatalogItem = {
  skuId: string;
  productName: string;
  optionLabel: string;
};

type SortMode = "sku" | "quantity";

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export default function InboundCumulativePage() {
  const [rows, setRows] = useState<MonthlyInboundRow[]>([]);
  const [catalog, setCatalog] = useState<Map<string, CatalogItem>>(new Map());
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("sku");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceWarning, setSourceWarning] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/wms/supplier-hub-orders?includeHistorical=1", { cache: "no-store" }).then(async response => {
        const data = await response.json() as { cumulativeInboundBySku?: MonthlyInboundRow[]; monthlyInboundBySku?: MonthlyInboundRow[]; historicalInboundStats?: { sourceError?: string }; error?: string };
        if (!response.ok) throw new Error(data.error || "입고결과 누적을 불러오지 못했습니다.");
        return { rows: data.cumulativeInboundBySku || data.monthlyInboundBySku || [], warning: data.historicalInboundStats?.sourceError || "" };
      }),
      fetch("/api/wms/product-catalog", { cache: "no-store" }).then(async response => {
        const data = await response.json() as { items?: CatalogItem[] };
        if (!response.ok) return [];
        return data.items || [];
      }),
    ]).then(([result, items]) => {
      if (!active) return;
      const sorted = [...result.rows].sort((a, b) => b.year - a.year || b.month - a.month || a.skuId.localeCompare(b.skuId));
      setRows(sorted);
      setSourceWarning(result.warning);
      setCatalog(new Map(items.map(item => [item.skuId, item])));
      if (sorted.length) {
        setYear(sorted[0].year);
        setMonth(sorted[0].month);
      }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : "입고결과 누적을 불러오지 못했습니다.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const years = useMemo(() => [...new Set(rows.map(row => row.year))].sort((a, b) => b - a), [rows]);
  const months = useMemo(() => {
    if (year === null) return [];
    return [...new Set(rows.filter(row => row.year === year).map(row => row.month))].sort((a, b) => a - b);
  }, [rows, year]);

  useEffect(() => {
    if (year !== null && !years.includes(year)) setYear(years[0] ?? null);
  }, [year, years]);

  useEffect(() => {
    if (month !== null && !months.includes(month)) setMonth(months[0] ?? null);
  }, [month, months]);

  const visibleRows = useMemo(() => {
    const query = normalize(search);
    return rows
      .filter(row => row.year === year && row.month === month)
      .map(row => ({ ...row, item: catalog.get(row.skuId) }))
      .filter(row => !query || normalize(row.skuId).includes(query) || normalize(row.item?.productName).includes(query))
      .sort((a, b) => sortMode === "quantity"
        ? b.actualReceivedQuantity - a.actualReceivedQuantity || a.skuId.localeCompare(b.skuId)
        : a.skuId.localeCompare(b.skuId));
  }, [catalog, month, rows, search, sortMode, year]);

  return (
    <main style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: "18px 16px 32px", fontFamily: "sans-serif", color: wmsColors.ink, background: wmsColors.background, minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
        <h1 style={{ fontSize: "22px", margin: 0 }}>입고결과 누적</h1>
        <a href="/wms/work-center" style={{ color: wmsColors.slateDark, fontSize: "13px" }}>← 작업센터</a>
      </div>
      <p style={{ color: wmsColors.muted, fontSize: "13px", margin: "0 0 18px" }}>저장된 실제 입고이력을 연도·월과 SKU별로 조회합니다. 원본 이력은 변경하지 않습니다.</p>
      {sourceWarning ? <p role="alert" style={{ color: "#9a5b00", background: "#fff5dc", padding: "10px", borderRadius: "8px" }}>현재 저장된 입고이력만 표시합니다. 전체 과거 파일을 합치려면 <a href="/api/auth/google-drive/start" target="_blank" rel="noreferrer">Google Drive를 다시 연결</a>해 주세요. ({sourceWarning})</p> : null}

      {loading ? <p style={{ color: wmsColors.muted }}>입고결과를 불러오는 중...</p> : error ? <p role="alert" style={{ color: "#a33" }}>{error}</p> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <label style={{ fontSize: "12px", fontWeight: 700 }}>연도<select value={year ?? ""} onChange={event => setYear(event.target.value ? Number(event.target.value) : null)} style={{ display: "block", width: "100%", marginTop: "4px", padding: "9px", border: `1px solid ${wmsColors.border}`, borderRadius: "8px", background: "#fff" }}><option value="">선택</option>{years.map(value => <option key={value} value={value}>{value}년</option>)}</select></label>
            <label style={{ fontSize: "12px", fontWeight: 700 }}>월<select value={month ?? ""} onChange={event => setMonth(event.target.value ? Number(event.target.value) : null)} style={{ display: "block", width: "100%", marginTop: "4px", padding: "9px", border: `1px solid ${wmsColors.border}`, borderRadius: "8px", background: "#fff" }}><option value="">선택</option>{months.map(value => <option key={value} value={value}>{value}월</option>)}</select></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px", marginBottom: "14px" }}>
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="SKU 또는 상품명 검색" aria-label="SKU 또는 상품명 검색" style={{ minWidth: 0, padding: "10px", border: `1px solid ${wmsColors.border}`, borderRadius: "8px", background: "#fff" }} />
            <select value={sortMode} onChange={event => setSortMode(event.target.value as SortMode)} aria-label="정렬 기준" style={{ padding: "9px", border: `1px solid ${wmsColors.border}`, borderRadius: "8px", background: "#fff" }}><option value="sku">SKU순</option><option value="quantity">수량순</option></select>
          </div>
          {!visibleRows.length ? <p style={{ color: wmsColors.muted }}>선택한 조건에 입고결과가 없습니다.</p> : <div style={{ overflowX: "auto", background: "#fff", border: `1px solid ${wmsColors.border}`, borderRadius: "10px" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}><thead><tr>{["SKU ID", "상품명", "옵션명", "누적 입고수량"].map(label => <th key={label} scope="col" style={{ padding: "10px 8px", textAlign: "left", whiteSpace: "nowrap", background: wmsColors.surfaceBeige, borderBottom: `1px solid ${wmsColors.border}` }}>{label}</th>)}</tr></thead><tbody>{visibleRows.map(row => <tr key={row.skuId}><td style={{ padding: "10px 8px", borderBottom: `1px solid ${wmsColors.border}`, whiteSpace: "nowrap" }}>{row.skuId}</td><td style={{ padding: "10px 8px", borderBottom: `1px solid ${wmsColors.border}` }}>{row.item?.productName || ""}</td><td style={{ padding: "10px 8px", borderBottom: `1px solid ${wmsColors.border}` }}>{row.item?.optionLabel || ""}</td><td style={{ padding: "10px 8px", borderBottom: `1px solid ${wmsColors.border}`, whiteSpace: "nowrap", fontWeight: 800 }}>{row.actualReceivedQuantity.toLocaleString()}개</td></tr>)}</tbody></table></div>}
          <a href="/wms/work-center" style={{ ...wmsGhostButton, display: "inline-flex", marginTop: "14px", textDecoration: "none" }}>작업센터로 돌아가기</a>
        </>
      )}
    </main>
  );
}
