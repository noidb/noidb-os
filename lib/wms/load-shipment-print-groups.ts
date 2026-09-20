import type { PickingWaveItem, ShipmentOutputGeneration } from "./picking-wave/types";
import type { ProductCatalogItem } from "./product-catalog";
import { inspectShipmentPdf, matchShipmentPrintGroups, parseBarcodeWorkbook, type ShipmentPdfFile } from "./shipment-print-client";
export interface ShipmentPrintLoadCache { pdfs: Map<string, ShipmentPdfFile>; catalog?: ProductCatalogItem[] }
export function createShipmentPrintLoadCache(): ShipmentPrintLoadCache { return { pdfs: new Map() }; }

async function inspectSources(sources: EncodedSource[], kind: "label" | "manifest", cache: ShipmentPrintLoadCache) {
  const result: ShipmentPdfFile[] = [];
  // At most two PDF workers at a time; the packing page reuses results across generations.
  for (let offset = 0; offset < sources.length; offset += 2) {
    result.push(...await Promise.all(sources.slice(offset, offset + 2).map(async source => {
      const key = `${kind}:${source.name}:${source.base64}`;
      const saved = cache.pdfs.get(key); if (saved) return saved;
      const parsed = await inspectShipmentPdf(decodeFile(source, "application/pdf"), kind);
      cache.pdfs.set(key, parsed); return parsed;
    })));
  }
  return result;
}

interface EncodedSource { name: string; base64: string }
function decodeFile(source: EncodedSource, type: string): File {
  const binary = atob(source.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], source.name, { type });
}
function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every(value => right.has(value));
}

/**
 * 입고예정일 단위(app/wms/logistics/dates/[expectedDate]) 출력세트 로딩 — InvoiceGroup 기준
 * (2026-09-18 신규). 원본 조회 API(/api/wms/shipment-print/auto-source)는 아래 loadShipmentPrintGroups
 * (웨이브 기준)와 완전히 동일하게 재사용한다 — 그 API는 waveId를 실제 매칭에 쓰지 않고 "값이
 * 비어있지 않은지"만 검증하므로, 웨이브가 없는 이 흐름에서는 자리표시 문자열을 넘긴다. 입고예정일
 * 자체가 이미 날짜를 확정하므로, 웨이브 아이템의 shippingGroupKey에서 날짜 토큰을 역산하던
 * 옛 로직(loadShipmentPrintGroups 본문 참고)은 필요 없다.
 */
export async function loadShipmentPrintGroupsByDate(
  expectedDate: string,
  purchaseOrderNumbers: string[],
  shipmentFileName: string,
  options: { cache?: ShipmentPrintLoadCache; expectedShipmentNumbers?: readonly string[] } = {},
) {
  const expected = new Set(purchaseOrderNumbers.map(String));
  const expectedShipments = new Set((options.expectedShipmentNumbers || []).map(String).map(value => value.trim()).filter(Boolean));
  const dateToken = expectedDate.replace(/-/g, "");
  if (!/^20\d{6}$/.test(dateToken) || expected.size === 0 || expectedShipments.size === 0 || [...expectedShipments].some(value => !/^\d{8}$/.test(value))) {
    throw new Error(`입고예정일·발주번호·쉽먼트번호가 올바르지 않습니다: ${expectedDate}`);
  }

  const sourceResponse = await fetch("/api/wms/shipment-print/auto-source", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      waveId: `date:${expectedDate}`,
      dateTokens: [dateToken],
      expectedPurchaseOrderNumbers: [...expected],
      expectedWorkbookName: shipmentFileName,
    }),
  });
  const source = await sourceResponse.json();
  if (!sourceResponse.ok || source.error) throw new Error(source.error || "출력세트 원본을 불러오지 못했습니다.");

  const cache = options.cache || createShipmentPrintLoadCache();
  const workbook = decodeFile(source.workbook as EncodedSource, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const [labels, manifests, barcodeRows] = await Promise.all([
    inspectSources(source.labels as EncodedSource[], "label", cache),
    inspectSources(source.manifests as EncodedSource[], "manifest", cache),
    parseBarcodeWorkbook(workbook),
  ]);

  const generationRows = barcodeRows.filter(row => expected.has(row.purchaseOrderNumber));
  const workbookPoSet = new Set(generationRows.map(row => row.purchaseOrderNumber));
  if (!sameSet(expected, workbookPoSet)) throw new Error(`이 날짜 발주 ${expected.size}건과 출력 원본 발주 ${workbookPoSet.size}건이 정확히 일치하지 않습니다.`);
  const sourceKeys = new Set<string>();
  for (const row of generationRows) {
    if (row.expectedDate.replace(/\D/g, "") !== dateToken || !row.fulfillmentCenter) {
      throw new Error(`쉽먼트 XLSX ${row.sourceRowNumber}행 ${row.purchaseOrderNumber}/${row.skuId}: 선택 날짜 또는 물류센터가 일치하지 않습니다.`);
    }
    const key = `${row.purchaseOrderNumber}\u0000${row.skuId}`;
    if (sourceKeys.has(key)) throw new Error(`쉽먼트 XLSX에 발주번호 ${row.purchaseOrderNumber} SKU ${row.skuId}가 중복되어 바코드 생성을 차단했습니다.`);
    sourceKeys.add(key);
  }
  const relevantLabels = labels.filter(label => label.purchaseOrderNumbers.some(po => expected.has(po)));
  const shipmentNumbers = new Set(relevantLabels.map(label => label.shipmentNumber));
  const relevantManifests = manifests.filter(manifest => shipmentNumbers.has(manifest.shipmentNumber));
  const manifestShipmentNumbers = new Set(relevantManifests.map(manifest => manifest.shipmentNumber));
  if (!sameSet(expectedShipments, shipmentNumbers) || !sameSet(expectedShipments, manifestShipmentNumbers)) {
    throw new Error(`기록된 쉽먼트번호와 Label/동봉내역서 쉽먼트번호가 정확히 일치하지 않습니다.`);
  }
  const groups = matchShipmentPrintGroups(relevantLabels, relevantManifests, generationRows, [], [], { requireBarcodeMetadata: false });
  for (const group of groups) {
    if (group.expectedDate.replace(/\D/g, "") !== dateToken || !group.fulfillmentCenter) {
      throw new Error(`쉽먼트 ${group.shipmentNumber}: 선택 날짜 또는 물류센터가 일치하지 않습니다.`);
    }
  }
  const matchedSourceKeys = new Set(groups.flatMap(group => group.barcodeRows).map(row => `${row.purchaseOrderNumber}\u0000${row.skuId}`));
  if (!sameSet(sourceKeys, matchedSourceKeys)) {
    const extra = [...sourceKeys].filter(key => !matchedSourceKeys.has(key));
    const missing = [...matchedSourceKeys].filter(key => !sourceKeys.has(key));
    throw new Error(`쉽먼트 XLSX/동봉내역서 SKU 완전성 검증 실패 (내역서 누락 ${extra.length} · 예상 외 ${missing.length})`);
  }
  const matchedPos = groups.flatMap(group => group.purchaseOrderNumbers);
  const matchedSet = new Set(matchedPos);
  if (!sameSet(expected, matchedSet) || matchedPos.length !== matchedSet.size) {
    const missing = [...expected].filter(po => !matchedSet.has(po));
    const extra = [...matchedSet].filter(po => !expected.has(po));
    throw new Error(`출력세트 발주 완전성 검증 실패 (누락 ${missing.length} · 예상 외 ${extra.length} · 중복 ${matchedPos.length - matchedSet.size})`);
  }
  return { groups, workbookName: workbook.name };
}

export async function loadShipmentPrintGroups(waveId: string, items: PickingWaveItem[], activeGeneration: ShipmentOutputGeneration, options: { forPacking?: boolean; cache?: ShipmentPrintLoadCache } = {}) {
    const expected = new Set(activeGeneration.purchaseOrderNumbers.map(String));
    const expectedDateTokens = [...new Set(items.flatMap(item => item.sources)
      .filter(source => expected.has(source.purchaseOrderNumber))
      .map(source => String(source.shippingGroupKey || "").split("\u0000")[0].replace(/\D/g, ""))
      .filter(value => /^20\d{6}$/.test(value)))];
    if (expectedDateTokens.length === 0) throw new Error("현재 묶음의 입고예정일을 확인할 수 없습니다.");
    const sourceResponse = await fetch("/api/wms/shipment-print/auto-source", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        waveId,
        dateTokens: expectedDateTokens,
        expectedPurchaseOrderNumbers: [...expected],
        expectedWorkbookName: activeGeneration.shipmentFileName,
      }),
    });
    const source = await sourceResponse.json();
    if (!sourceResponse.ok || source.error) throw new Error(source.error || "출력세트 원본을 불러오지 못했습니다.");

    const cache = options.cache || createShipmentPrintLoadCache();
    const workbook = decodeFile(source.workbook as EncodedSource, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const [labels, manifests, barcodeRows] = await Promise.all([
      inspectSources(source.labels as EncodedSource[], "label", cache),
      inspectSources(source.manifests as EncodedSource[], "manifest", cache),
      parseBarcodeWorkbook(workbook),
    ]);
    let catalog: ProductCatalogItem[];
    try {
      catalog = cache.catalog || await fetch("/api/wms/product-catalog", { cache: "no-store" }).then(async response => {
        const data = await response.json();
        if (!response.ok || data.error || !data.configured) throw new Error(data.error || "제품DB를 불러오지 못했습니다.");
        return data.items as ProductCatalogItem[];
      });
    } catch (catalogError) {
      if (window.location.hostname !== "localhost") throw catalogError;
      catalog = barcodeRows.map(row => ({
        skuId: row.skuId, modelSku: "", modelName: row.embeddedModelName, category: "", gender: "",
        productName: "", optionLabel: "", imageUrl: "", warehouseNumber: "", boxNumber: "",
        currentStock: "", currentStatus: "", orderableStatus: "", costVatIncluded: "", vendorName: "", barcode: "",
        countryOfOrigin: row.embeddedCountryOfOrigin, productLink: "",
      }));
    }

    cache.catalog = catalog;
    const generationRows = barcodeRows.filter(row => expected.has(row.purchaseOrderNumber));
    const workbookPoSet = new Set(generationRows.map(row => row.purchaseOrderNumber));
    if (!sameSet(expected, workbookPoSet)) throw new Error(`현재 묶음 발주 ${expected.size}건과 출력 원본 발주 ${workbookPoSet.size}건이 정확히 일치하지 않습니다.`);
    const relevantLabels = labels.filter(label => label.purchaseOrderNumbers.some(po => expected.has(po)));
    const shipmentNumbers = new Set(relevantLabels.map(label => label.shipmentNumber));
    const relevantManifests = manifests.filter(manifest => shipmentNumbers.has(manifest.shipmentNumber));
    const groups = matchShipmentPrintGroups(relevantLabels, relevantManifests, generationRows, catalog, items, { requireBarcodeMetadata: !options.forPacking });
    const matchedPos = groups.flatMap(group => group.purchaseOrderNumbers);
    const matchedSet = new Set(matchedPos);
    if (!sameSet(expected, matchedSet) || matchedPos.length !== matchedSet.size) {
      const missing = [...expected].filter(po => !matchedSet.has(po));
      const extra = [...matchedSet].filter(po => !expected.has(po));
      throw new Error(`출력세트 발주 완전성 검증 실패 (누락 ${missing.length} · 예상 외 ${extra.length} · 중복 ${matchedPos.length - matchedSet.size})`);
    }
    return { groups, workbookName: workbook.name, catalog };
  }
