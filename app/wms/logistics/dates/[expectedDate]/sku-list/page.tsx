"use client";

import { useEffect, useMemo, useState } from "react";
import { useInvoiceGroupRepositoryState } from "@/lib/wms/invoice-group/context";
import { readLocalInvoiceGroupSnapshot } from "@/lib/wms/invoice-group/local-repository";
import type { InvoiceGroup } from "@/lib/wms/invoice-group/types";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import { loadShipmentPrintGroupsByDate } from "@/lib/wms/load-shipment-print-groups";
import type { ShipmentPrintGroup } from "@/lib/wms/shipment-print-client";
import ProductThumb from "../ProductThumb";
import { WMS_MOBILE_WIDTH, wmsColors } from "@/lib/wms/ui-tokens";

/**
 * 쉽먼트별 SKU리스트 (2026-10-02 신규 — 사용자 요청).
 *
 * 피킹 중 동봉내역서를 보다가 헷갈리는 상품을 바로 찾아보기 위한 화면. 출력세트의
 * "02_동봉내역서_통합.pdf"를 만드는 것과 똑같은 원본(Supplier Hub Label·내역서 PDF + 쉽먼트 XLSX)을
 * loadShipmentPrintGroupsByDate로 읽는다 — 그래서 쉽먼트 순서(입고예정일→센터→쉽먼트번호)와
 * 쉽먼트 안의 SKU 순서(내역서 manifest.items 순서)가 동봉내역서와 정확히 같다. 새 정렬을 하지 않는다.
 * 제품이미지·제품링크만 제품DB(/api/wms/product-catalog)에서 SKU ID로 붙인다.
 */

type Row = ShipmentPrintGroup["barcodeRows"][number];

export default function ShipmentSkuListPage({ params }: { params: { expectedDate: string } }) {
  const expectedDate = decodeURIComponent(params.expectedDate);
  const { repository, ready, fixture } = useInvoiceGroupRepositoryState();
  const [shipments, setShipments] = useState<ShipmentPrintGroup[] | null>(null);
  const [catalogBySku, setCatalogBySku] = useState<Map<string, ProductCatalogItem>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openShipment, setOpenShipment] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (fixture) { setError("개발용 예시자료에서는 실제 동봉내역서 원본을 읽지 않습니다."); return; }
    let cancelled = false;
    (async () => {
      try {
        // 발주묶음 정보는 마지막 저장 상태(로컬 미러)를 쓰고, 없을 때만 서버에서 가져온다.
        let all: InvoiceGroup[] = readLocalInvoiceGroupSnapshot();
        if (!all.some(group => group.expectedDate === expectedDate)) all = await repository.list();
        const groups = all.filter(group => !group.supersededByGroupId && group.expectedDate === expectedDate);
        if (!groups.length) throw new Error("이 날짜의 발주묶음을 찾지 못했습니다.");
        const shipmentFileName = groups.find(group => group.shipmentFileName)?.shipmentFileName;
        if (!shipmentFileName) throw new Error("쉽먼트 업로드파일 기록이 없습니다. 먼저 쉽먼트를 생성해 주세요.");
        const [{ groups: printGroups }, catalogItems] = await Promise.all([
          loadShipmentPrintGroupsByDate(expectedDate, groups.flatMap(group => group.purchaseOrderNumbers), shipmentFileName, {
            expectedShipmentNumbers: groups.flatMap(group => group.shipmentNumbers),
          }),
          fetch("/api/wms/product-catalog", { cache: "no-store" })
            .then(response => response.json())
            .then(data => (Array.isArray(data.items) ? data.items : []) as ProductCatalogItem[])
            .catch(() => [] as ProductCatalogItem[]),
        ]);
        if (cancelled) return;
        setCatalogBySku(new Map(catalogItems.map(item => [item.skuId, item])));
        setShipments(printGroups);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "SKU리스트를 불러오지 못했습니다.");
      }
    })();
    return () => { cancelled = true; };
  }, [ready, fixture, repository, expectedDate]);

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (row: Row) => !normalizedQuery || [row.barcode, row.skuId, row.productName, row.optionLabel, row.warehouseNumber]
    .some(value => String(value || "").toLowerCase().includes(normalizedQuery));
  const visibleShipments = useMemo(
    () => (shipments || []).map(group => ({ group, rows: group.barcodeRows.filter(matches) })).filter(entry => entry.rows.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shipments, normalizedQuery],
  );

  return (
    <main style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: "12px 12px 32px", fontFamily: "sans-serif", color: wmsColors.ink, background: wmsColors.background, minHeight: "100vh" }}>
      <a href="/wms/work-center" style={{ color: wmsColors.slateDark, fontSize: "13px" }}>← 입고센터</a>
      <h1 style={{ margin: "10px 0 2px", fontSize: "20px" }}>쉽먼트별 SKU리스트</h1>
      <p style={{ margin: "0 0 12px", color: wmsColors.muted, fontSize: "12px" }}>입고예정일 {expectedDate} · 동봉내역서와 같은 순서{shipments ? ` · 쉽먼트 ${shipments.length}개` : ""} · 쉽먼트를 누르면 열립니다</p>

      {error && <p style={{ padding: "12px", borderRadius: "12px", background: wmsColors.warnSoft, color: wmsColors.warn, fontSize: "13px", whiteSpace: "pre-wrap" }}>{error}</p>}
      {!error && !shipments && <p style={{ color: wmsColors.muted, fontSize: "13px" }}>동봉내역서 원본을 읽는 중…</p>}

      {shipments && (
        <>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="바코드·SKU·상품명으로 찾기"
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: "12px", border: `1px solid #ddd8cd`, fontSize: "14px", marginBottom: "12px" }}
          />
          {visibleShipments.length === 0 && <p style={{ color: wmsColors.muted, fontSize: "13px" }}>찾는 상품이 없습니다.</p>}
          {visibleShipments.map(({ group, rows }, shipmentIndex) => {
            const total = group.barcodeRows.reduce((sum, row) => sum + row.quantity, 0);
            // 검색 중이면 찾은 쉽먼트를 모두 펼친다. 아니면 누른 쉽먼트만 펼친다.
            const open = normalizedQuery ? true : openShipment === group.shipmentNumber;
            return (
              <section key={group.shipmentNumber} style={{ marginBottom: "8px" }}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenShipment(open ? null : group.shipmentNumber)}
                  style={{ position: open ? "sticky" : "static", top: 0, zIndex: 1, width: "100%", textAlign: "left", cursor: "pointer", display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: "8px", padding: "12px 14px", borderRadius: "14px", border: `1px solid ${open ? "#e3c0c8" : "#e5dace"}`, background: open ? "#f6e2e6" : "#faf8f4", color: wmsColors.ink, fontFamily: "inherit" }}
                >
                  <span>
                    <span style={{ display: "block", fontSize: "15px", fontWeight: 800 }}>{shipmentIndex + 1}. {group.fulfillmentCenter} · {group.shipmentNumber}</span>
                    <span style={{ display: "block", fontSize: "12px", color: wmsColors.muted, marginTop: "2px" }}>SKU {group.barcodeRows.length}종 · 총 {total}개 · 발주 {group.purchaseOrderNumbers.length}건</span>
                  </span>
                  <span style={{ fontSize: "13px", fontWeight: 700 }}>{open ? "접기 ▲" : "열기 ▼"}</span>
                </button>
                {open && (
                <ol style={{ listStyle: "none", margin: "8px 0 14px", padding: 0, display: "grid", gap: "8px" }}>
                  {rows.map(row => {
                    const order = group.barcodeRows.indexOf(row) + 1;
                    const catalog = catalogBySku.get(row.skuId);
                    return (
                      <li key={`${row.purchaseOrderNumber}-${row.skuId}-${row.sourceRowNumber}`} style={{ display: "grid", gridTemplateColumns: "24px 72px 1fr auto", gap: "10px", alignItems: "center", padding: "10px", borderRadius: "14px", background: "#fff", border: `1px solid #e5dace` }}>
                        <span style={{ fontSize: "12px", color: wmsColors.muted, textAlign: "center" }}>{order}</span>
                        <ProductThumb key={row.skuId} catalog={catalog} skuId={row.skuId} alt={row.productName} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "13px", fontWeight: 700, lineHeight: 1.35 }}>{row.productName}{row.optionLabel ? ` · ${row.optionLabel}` : ""}</div>
                          <div style={{ fontSize: "12px", color: wmsColors.muted, marginTop: "3px" }}>SKU {row.skuId}{row.warehouseNumber ? ` · 번호 ${row.warehouseNumber}` : ""}</div>
                          <div style={{ fontSize: "12px", fontFamily: "monospace", marginTop: "2px" }}>{row.barcode}</div>
                          {catalog?.productLink && (
                            <a href={catalog.productLink} target="_blank" rel="noreferrer" style={{ fontSize: "12px", color: wmsColors.slateDark, display: "inline-block", marginTop: "3px" }}>제품링크 ↗</a>
                          )}
                        </div>
                        <div style={{ fontSize: "20px", fontWeight: 800, minWidth: "36px", textAlign: "right" }}>{row.quantity}<span style={{ fontSize: "11px", fontWeight: 600 }}>개</span></div>
                      </li>
                    );
                  })}
                </ol>
                )}
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
