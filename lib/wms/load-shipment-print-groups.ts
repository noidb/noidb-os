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
        currentStock: "", currentStatus: "", costVatIncluded: "", vendorName: "", barcode: "",
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
