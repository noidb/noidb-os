"use client";

import { useEffect, useMemo, useState } from "react";
import { useInvoiceGroupRepositoryState } from "@/lib/wms/invoice-group/context";
import { readLocalInvoiceGroupSnapshot } from "@/lib/wms/invoice-group/local-repository";
import type { InvoiceGroup } from "@/lib/wms/invoice-group/types";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import { resolveDisplayNameAndOption } from "@/lib/wms/display-name";
import { WMS_MOBILE_WIDTH, wmsColors } from "@/lib/wms/ui-tokens";
import type { SkuSummaryRow } from "@/app/api/wms/logistics/sku-summary/route";

/**
 * 발주 SKU별 총수량 (2026-10-02 신규 — 사용자 요청).
 *
 * 쉽먼트 생성 전이라 쉽먼트별 목록(동봉내역서 순서)은 아직 없으므로, 이 날짜 발주서 원본의 품목을
 * SKU별로 합산해 보여준다(/api/wms/logistics/sku-summary, 읽기 전용). 쉽먼트 생성 후에는 같은
 * 자리에서 "쉽먼트별 SKU리스트"(../sku-list)를 쓴다. 이미지·제품링크는 제품DB에서 SKU ID로 붙인다.
 */
export default function PurchaseOrderSkuSummaryPage({ params }: { params: { expectedDate: string } }) {
  const expectedDate = decodeURIComponent(params.expectedDate);
  const { repository, ready, fixture } = useInvoiceGroupRepositoryState();
  const [rows, setRows] = useState<SkuSummaryRow[] | null>(null);
  const [summary, setSummary] = useState<{ poCount: number; centerCount: number; missing: string[] } | null>(null);
  const [catalogBySku, setCatalogBySku] = useState<Map<string, ProductCatalogItem>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!ready) return;
    if (fixture) { setError("개발용 예시자료에서는 실제 발주서 원본을 읽지 않습니다."); return; }
    let cancelled = false;
    (async () => {
      try {
        let all: InvoiceGroup[] = readLocalInvoiceGroupSnapshot();
        if (!all.some(group => group.expectedDate === expectedDate)) all = await repository.list();
        const groups = all.filter(group => !group.supersededByGroupId && group.expectedDate === expectedDate);
        if (!groups.length) throw new Error("이 날짜의 발주묶음을 찾지 못했습니다.");
        const purchaseOrderNumbers = [...new Set(groups.flatMap(group => group.purchaseOrderNumbers))];
        const [result, catalogItems] = await Promise.all([
          fetch("/api/wms/logistics/sku-summary", {
            method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
            body: JSON.stringify({ purchaseOrderNumbers }),
          }).then(async response => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.ok) throw new Error(data.error || "발주서 원본을 읽지 못했습니다.");
            return data as { rows: SkuSummaryRow[]; missingPurchaseOrderNumbers: string[] };
          }),
          fetch("/api/wms/product-catalog", { cache: "no-store" })
            .then(response => response.json())
            .then(data => (Array.isArray(data.items) ? data.items : []) as ProductCatalogItem[])
            .catch(() => [] as ProductCatalogItem[]),
        ]);
        if (cancelled) return;
        setCatalogBySku(new Map(catalogItems.map(item => [item.skuId, item])));
        setSummary({ poCount: purchaseOrderNumbers.length, centerCount: new Set(groups.map(group => group.fulfillmentCenter)).size, missing: result.missingPurchaseOrderNumbers });
        setRows(result.rows);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "SKU 목록을 불러오지 못했습니다.");
      }
    })();
    return () => { cancelled = true; };
  }, [ready, fixture, repository, expectedDate]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(
    () => (rows || []).filter(row => !normalizedQuery || [row.barcode, row.skuId, row.productName, row.optionName].some(value => String(value || "").toLowerCase().includes(normalizedQuery))),
    [rows, normalizedQuery],
  );
  const totalQuantity = (rows || []).reduce((sum, row) => sum + row.totalQuantity, 0);

  return (
    <main style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: "12px 12px 32px", fontFamily: "sans-serif", color: wmsColors.ink, background: wmsColors.background, minHeight: "100vh" }}>
      <a href="/wms/work-center" style={{ color: wmsColors.slateDark, fontSize: "13px" }}>← 입고센터</a>
      <h1 style={{ margin: "10px 0 2px", fontSize: "20px" }}>발주 SKU별 총수량</h1>
      <p style={{ margin: "0 0 12px", color: wmsColors.muted, fontSize: "12px" }}>
        입고예정일 {expectedDate}{rows && summary ? ` · 발주 ${summary.poCount}건 · 센터 ${summary.centerCount}곳 · SKU ${rows.length}종 · 총 ${totalQuantity}개` : ""}
      </p>

      {error && <p style={{ padding: "12px", borderRadius: "12px", background: wmsColors.warnSoft, color: wmsColors.warn, fontSize: "13px", whiteSpace: "pre-wrap" }}>{error}</p>}
      {!error && !rows && <p style={{ color: wmsColors.muted, fontSize: "13px" }}>발주서 원본을 읽는 중…</p>}
      {summary && summary.missing.length > 0 && (
        <p style={{ padding: "10px 12px", borderRadius: "12px", background: wmsColors.warnSoft, color: wmsColors.warn, fontSize: "12px" }}>
          발주서 원본을 찾지 못한 발주 {summary.missing.length}건은 합계에서 빠졌습니다: {summary.missing.join(", ")}
        </p>
      )}

      {rows && (
        <>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="바코드·SKU·상품명으로 찾기"
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: "12px", border: "1px solid #ddd8cd", fontSize: "14px", marginBottom: "12px" }}
          />
          {visibleRows.length === 0 && <p style={{ color: wmsColors.muted, fontSize: "13px" }}>찾는 상품이 없습니다.</p>}
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
            {visibleRows.map(row => {
              const catalog = catalogBySku.get(row.skuId);
              const display = resolveDisplayNameAndOption(row.productName, row.optionName);
              return (
                <li key={row.skuId || row.barcode} style={{ display: "grid", gridTemplateColumns: "72px 1fr auto", gap: "10px", alignItems: "center", padding: "10px", borderRadius: "14px", background: "#fff", border: "1px solid #e5dace" }}>
                  {catalog?.imageUrl ? (
                    <a href={catalog.imageUrl} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={catalog.imageUrl} alt={display.name} loading="lazy" style={{ width: "72px", height: "72px", objectFit: "cover", borderRadius: "10px", display: "block" }} />
                    </a>
                  ) : (
                    <div style={{ width: "72px", height: "72px", borderRadius: "10px", background: "#f2f2f2", fontSize: "11px", color: wmsColors.muted, display: "grid", placeItems: "center" }}>이미지 없음</div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, lineHeight: 1.35 }}>{display.name}{display.option ? ` · ${display.option}` : ""}</div>
                    <div style={{ fontSize: "12px", color: wmsColors.muted, marginTop: "3px" }}>SKU {row.skuId || "-"} · 발주 {row.purchaseOrderCount}건 · 센터 {row.fulfillmentCenters.length}곳</div>
                    <div style={{ fontSize: "12px", fontFamily: "monospace", marginTop: "2px" }}>{row.barcode}</div>
                    {catalog?.productLink && (
                      <a href={catalog.productLink} target="_blank" rel="noreferrer" style={{ fontSize: "12px", color: wmsColors.slateDark, display: "inline-block", marginTop: "3px" }}>제품링크 ↗</a>
                    )}
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: 800, minWidth: "36px", textAlign: "right" }}>{row.totalQuantity}<span style={{ fontSize: "11px", fontWeight: 600 }}>개</span></div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </main>
  );
}
