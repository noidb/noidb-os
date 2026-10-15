"use client";

import { useEffect, useMemo, useState } from "react";
import { useInvoiceGroupRepositoryState } from "@/lib/wms/invoice-group/context";
import { readLocalInvoiceGroupSnapshot } from "@/lib/wms/invoice-group/local-repository";
import type { InvoiceGroup } from "@/lib/wms/invoice-group/types";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import { loadShipmentPrintGroupsByDate } from "@/lib/wms/load-shipment-print-groups";
import type { ShipmentPrintGroup } from "@/lib/wms/shipment-print-client";
import ProductThumb from "../ProductThumb";
import { initialQueryFromUrl, OrderedProductsSwitch, PickBar, PickButton, ProductInfo, useOutboundPicks } from "../OrderedProductsShared";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";
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

/** 2026-10-13 사용자 요청: 원발주서 공급가(부가세 포함 단가)를 발주번호+SKU 기준으로 붙인다. */
const priceKey = (purchaseOrderNumber: string, skuId: string) => `${normalizeSkuId(purchaseOrderNumber)}\u0000${normalizeSkuId(skuId)}`;
const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

export default function ShipmentSkuListPage({ params }: { params: { expectedDate: string } }) {
  const expectedDate = decodeURIComponent(params.expectedDate);
  const { repository, ready, fixture } = useInvoiceGroupRepositoryState();
  const [shipments, setShipments] = useState<ShipmentPrintGroup[] | null>(null);
  const [catalogBySku, setCatalogBySku] = useState<Map<string, ProductCatalogItem>>(new Map());
  const [unitPriceByPoSku, setUnitPriceByPoSku] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQueryFromUrl);
  const [openShipment, setOpenShipment] = useState<string | null>(null);
  // 2026-10-15: 발주제품보기 — SKU별 총수량과 같은 '발주 담기' 목록을 쓴다(SKU 단위, 수량은 이 날짜 SKU 총수량).
  const picks = useOutboundPicks(expectedDate);
  // 2026-10-15: 원본(Drive의 Label·내역서 PDF + 쉽먼트 XLSX)을 매번 다시 읽으면 오래 걸려서,
  // 마지막으로 읽은 결과를 이 기기에 남겨 두고 바로 보여준다. 쉽먼트 구성이 바뀌었거나 '원본 다시 읽기'를 누를 때만 다시 읽는다.
  const cacheKey = `noidb_sku_list_cache_v1_${expectedDate}`;
  const [reloadToken, setReloadToken] = useState(0);
  const [reloading, setReloading] = useState(false);
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
        // 2026-10-15: 같은 날짜에 추가 발주가 따로 쉽먼트로 나가면 쉽먼트 파일이 여러 개다.
        // 파일마다 그 파일로 만든 발주만 읽어 합친다(예: 아침 33건 + 추가 3건).
        const byShipmentFile = new Map<string, InvoiceGroup[]>();
        for (const group of groups) if (group.shipmentFileName) byShipmentFile.set(group.shipmentFileName, [...(byShipmentFile.get(group.shipmentFileName) || []), group]);
        if (!byShipmentFile.size) throw new Error("쉽먼트 업로드파일 기록이 없습니다. 먼저 쉽먼트를 생성해 주세요.");
        const purchaseOrderNumbers = groups.flatMap(group => group.purchaseOrderNumbers);
        const fingerprint = JSON.stringify(groups.map(group => [group.id, group.shipmentFileName || "", group.shipmentNumbers, [...group.purchaseOrderNumbers].sort(), group.outputSetGeneratedAt || ""]).sort());
        if (reloadToken === 0) {
          try {
            const cached = JSON.parse(localStorage.getItem(cacheKey) || "null") as { fingerprint: string; shipments: ShipmentPrintGroup[]; catalog: ProductCatalogItem[]; prices: [string, number][] } | null;
            if (cached?.fingerprint === fingerprint && Array.isArray(cached.shipments)) {
              setCatalogBySku(new Map(cached.catalog.map(item => [item.skuId, item])));
              setUnitPriceByPoSku(new Map(cached.prices));
              setShipments(cached.shipments);
              return;
            }
          } catch { /* 저장본이 없거나 깨졌으면 원본을 읽는다 */ }
        }
        setReloading(true);
        const [printGroupLists, catalogItems, priceDocuments] = await Promise.all([
          Promise.all([...byShipmentFile.entries()].map(([shipmentFileName, fileGroups]) =>
            loadShipmentPrintGroupsByDate(expectedDate, fileGroups.flatMap(group => group.purchaseOrderNumbers), shipmentFileName, {
              expectedShipmentNumbers: fileGroups.flatMap(group => group.shipmentNumbers),
            }).then(result => result.groups))),
          fetch("/api/wms/product-catalog", { cache: "no-store" })
            .then(response => response.json())
            .then(data => (Array.isArray(data.items) ? data.items : []) as ProductCatalogItem[])
            .catch(() => [] as ProductCatalogItem[]),
          // 공급가는 못 읽어도 목록은 그대로 보여 준다(공급가 칸만 비움).
          fetch("/api/wms/logistics/sku-summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseOrderNumbers }) })
            .then(response => response.json())
            .then(data => (Array.isArray(data.documents) ? data.documents : []) as { purchaseOrderNumber: string; lines: { skuId: string; unitPrice: number }[] }[])
            .catch(() => []),
        ]);
        if (cancelled) return;
        const merged = printGroupLists.flat().sort((left, right) => left.fulfillmentCenter.localeCompare(right.fulfillmentCenter, "ko") || String(left.shipmentNumber).localeCompare(String(right.shipmentNumber)));
        const skuSet = new Set(merged.flatMap(group => group.barcodeRows.map(row => row.skuId)));
        const usedCatalog = catalogItems.filter(item => skuSet.has(item.skuId));
        const prices = priceDocuments.flatMap(document => document.lines.filter(line => line.unitPrice > 0).map(line => [priceKey(document.purchaseOrderNumber, line.skuId), line.unitPrice] as [string, number]));
        setCatalogBySku(new Map(usedCatalog.map(item => [item.skuId, item])));
        setUnitPriceByPoSku(new Map(prices));
        try { localStorage.setItem(cacheKey, JSON.stringify({ fingerprint, shipments: merged, catalog: usedCatalog, prices })); } catch { /* 저장 공간 부족 — 다음에 다시 읽음 */ }
        // 동봉내역서와 같은 순서(센터 → 쉽먼트번호)로 합친다.
        setShipments(merged);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "SKU리스트를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setReloading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fixture, repository, expectedDate, reloadToken]);

  // 2026-10-13 사용자 요청: 이 날짜 전체 총수량(모든 쉽먼트 합계)을 보여 준다.
  const totalBySku = new Map<string, number>();
  for (const group of shipments || []) for (const row of group.barcodeRows) totalBySku.set(row.skuId, (totalBySku.get(row.skuId) || 0) + row.quantity);
  const grandTotal = (shipments || []).reduce((sum, group) => sum + group.barcodeRows.reduce((rowSum, row) => rowSum + row.quantity, 0), 0);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (row: Row) => !normalizedQuery || [row.barcode, row.skuId, row.productName, row.optionLabel, row.warehouseNumber]
    .some(value => String(value || "").toLowerCase().includes(normalizedQuery));
  const visibleShipments = useMemo(
    () => (shipments || []).map(group => ({ group, rows: group.barcodeRows.filter(matches) })).filter(entry => entry.rows.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shipments, normalizedQuery],
  );

  return (
    <main style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: `12px 12px ${Object.keys(picks.picked).length ? "110px" : "32px"}`, fontFamily: "sans-serif", color: wmsColors.ink, background: wmsColors.background, minHeight: "100vh" }}>
      <a href="/wms/work-center" style={{ color: wmsColors.slateDark, fontSize: "13px" }}>← 입고센터</a>
      <h1 style={{ margin: "10px 0 2px", fontSize: "20px" }}>발주제품보기</h1>
      <OrderedProductsSwitch expectedDate={expectedDate} current="shipments" query={query} />
      <p style={{ margin: "0 0 12px", color: wmsColors.muted, fontSize: "12px" }}>입고예정일 {expectedDate} · 동봉내역서와 같은 순서{shipments ? ` · 쉽먼트 ${shipments.length}개 · 총 ${grandTotal.toLocaleString("ko-KR")}개` : ""} · 쉽먼트를 누르면 열립니다</p>

      {error && <p style={{ padding: "12px", borderRadius: "12px", background: wmsColors.warnSoft, color: wmsColors.warn, fontSize: "13px", whiteSpace: "pre-wrap" }}>{error}</p>}
      {!error && !shipments && <p style={{ color: wmsColors.muted, fontSize: "13px" }}>동봉내역서 원본을 읽는 중… (처음 한 번만 오래 걸리고, 다음부터는 바로 열립니다)</p>}
      {shipments && (
        <button type="button" className="softApricotButton" disabled={reloading} onClick={() => { setError(null); setReloadToken(value => value + 1); }} style={{ width: "100%", marginBottom: "8px", minHeight: "36px", fontSize: "12px" }}>
          {reloading ? "원본 다시 읽는 중…" : "동봉내역서 원본 다시 읽기"}
        </button>
      )}

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
                    const unitPrice = unitPriceByPoSku.get(priceKey(row.purchaseOrderNumber, row.skuId)) || 0;
                    const isPicked = Boolean(picks.picked[row.skuId]);
                    return (
                      <li key={`${row.purchaseOrderNumber}-${row.skuId}-${row.sourceRowNumber}`} style={{ display: "grid", gridTemplateColumns: "24px 72px 1fr auto", gap: "10px", alignItems: "center", padding: "10px", borderRadius: "14px", background: isPicked ? "#fbf1ee" : "#fff", border: `1px solid ${isPicked ? "#dfbdb2" : "#e5dace"}` }}>
                        <span style={{ fontSize: "12px", color: wmsColors.muted, textAlign: "center" }}>{order}</span>
                        <ProductThumb key={row.skuId} catalog={catalog} skuId={row.skuId} alt={row.productName} />
                        <ProductInfo name={row.productName} option={row.optionLabel} skuId={row.skuId} warehouseNumber={row.warehouseNumber} barcode={row.barcode} priceMax={unitPrice} productLink={catalog?.productLink} />
                        <div style={{ display: "grid", justifyItems: "end", gap: "6px" }}>
                          <div style={{ fontSize: "20px", fontWeight: 800, minWidth: "36px", textAlign: "right" }}>{row.quantity}<span style={{ fontSize: "11px", fontWeight: 600 }}>개</span></div>
                          <PickButton picked={isPicked} onClick={() => picks.toggle(row.skuId, totalBySku.get(row.skuId) || row.quantity)} />
                        </div>
                      </li>
                    );
                  })}
                </ol>
                )}
              </section>
            );
          })}
          {!normalizedQuery && shipments.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", padding: "12px 14px", marginTop: "4px", borderRadius: "14px", border: "1px solid #e5dace", background: "#fff" }}>
              <span style={{ fontSize: "14px", fontWeight: 800 }}>전체 쉽먼트 {shipments.length}개</span>
              <span style={{ fontSize: "18px", fontWeight: 800 }}>총 {grandTotal.toLocaleString("ko-KR")}<span style={{ fontSize: "12px", fontWeight: 600 }}>개</span></span>
            </div>
          )}
        </>
      )}
      <PickBar expectedDate={expectedDate} picks={picks} />
    </main>
  );
}
