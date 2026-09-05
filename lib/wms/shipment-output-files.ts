import ExcelJS from "exceljs";
import { resolveBarcodeModelIdentifier } from "./barcode-model-identifier";
import { resolveDisplayNameAndOption } from "./display-name";
import { summarizeFulfillmentCenterLabels } from "./fulfillment-center-label-summary";
import { normalizeSkuId } from "./sku-normalize";
import type { ProductCatalogItem } from "./product-catalog";
import type { PurchaseOrderSourceRecord } from "./purchase-order-source/types";
import type { ShipmentOutputGroup } from "./shipment-output-context";
import type { BarTenderPrintGroup } from "./shipment-print-client";
import type { ParsedTrackingRow } from "./hanjin-upload";

const BARTENDER_HEADERS = ["SKU ID", "번호", "바코드", "상품명", "옵션명", "제조국명", "모델명", "출력유형"] as const;

export interface ManifestBarcodeGroup {
  shipmentNumber: string;
  fulfillmentCenter: string;
  expectedDate: string;
  purchaseOrderNumbers: string[];
  items: { purchaseOrderNumber: string; skuId: string; barcode: string; quantity: number }[];
}

/** 브라우저에서 대조한 동봉내역서 순서만 받아, 출력 값은 서버의 발주서·제품DB로 다시 검증한다. */
export async function buildManifestOrderedBarcodeWorkbook(
  manifestGroups: unknown,
  records: readonly PurchaseOrderSourceRecord[],
  catalogItems: readonly ProductCatalogItem[],
  finalQuantityRows: readonly ParsedTrackingRow[],
): Promise<Buffer> {
  if (!Array.isArray(manifestGroups) || manifestGroups.length === 0 || records.length === 0 || finalQuantityRows.length === 0) {
    throw new Error("동봉내역서 순서를 확인하지 못했습니다. Shipment 출력세트 화면에서 다시 생성해 주세요.");
  }
  const sourceByKey = new Map<string, PurchaseOrderSourceRecord>();
  const finalByKey = new Map<string, { row: ParsedTrackingRow; quantity: number }>();
  const catalogBySku = new Map<string, ProductCatalogItem[]>();
  const keyFor = (po: string, sku: string) => `${normalizeSkuId(po)}\u0000${normalizeSkuId(sku)}`;
  const dateKey = (value: string) => value.replace(/\D/g, "");
  for (const record of records) {
    const key = keyFor(record.purchaseOrderNumber, normalizeSkuId(record.skuId));
    if (sourceByKey.has(key)) throw new Error(`발주서 ${record.purchaseOrderNumber}의 SKU ${record.skuId} 원본이 중복되어 바코드 생성을 차단했습니다.`);
    sourceByKey.set(key, record);
  }
  for (const row of finalQuantityRows) {
    const key = keyFor(row.purchaseOrderNumber, row.skuId);
    if (finalByKey.has(key)) throw new Error(`쉽먼트 XLSX의 발주서 ${row.purchaseOrderNumber} SKU ${row.skuId}가 중복되어 바코드 생성을 차단했습니다.`);
    const quantity = Number(String(row.shippedQuantity || "").replace(/,/g, "").trim());
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error(`쉽먼트 XLSX의 발주서 ${row.purchaseOrderNumber} SKU ${row.skuId}: 최종 납품수량을 확인할 수 없습니다.`);
    }
    finalByKey.set(key, { row, quantity });
  }
  for (const [key, final] of finalByKey) {
    const record = sourceByKey.get(key);
    if (!record) throw new Error(`쉽먼트 XLSX에 현재 선택 발주 원본에 없는 SKU가 포함되어 있습니다: ${final.row.purchaseOrderNumber}/${final.row.skuId}`);
    if (final.row.barcode.trim() !== record.barcode || final.row.fulfillmentCenter !== record.fulfillmentCenterName || dateKey(final.row.expectedDate) !== dateKey(record.expectedArrivalDate)) {
      throw new Error(`쉽먼트 XLSX의 발주서 ${record.purchaseOrderNumber} SKU ${record.skuId}: 바코드·물류센터·입고예정일이 현재 발주서 원본과 다릅니다.`);
    }
    if (final.quantity > record.orderedQuantity) {
      throw new Error(`쉽먼트 XLSX의 발주서 ${record.purchaseOrderNumber} SKU ${record.skuId}: 최종 납품수량 ${final.quantity}개가 발주수량 ${record.orderedQuantity}개를 초과합니다.`);
    }
  }
  if (finalByKey.size !== sourceByKey.size) {
    throw new Error(`쉽먼트 XLSX에 현재 선택 발주 상품 ${sourceByKey.size - finalByKey.size}행의 최종 납품수량이 누락되어 바코드 생성을 차단했습니다.`);
  }
  for (const item of catalogItems) {
    const sku = normalizeSkuId(item.skuId);
    catalogBySku.set(sku, [...(catalogBySku.get(sku) || []), item]);
  }
  const usedRows = new Set<string>();
  const usedPurchaseOrders = new Set<string>();
  const usedShipments = new Set<string>();
  const outputGroups: BarTenderPrintGroup[] = [];
  for (const raw of manifestGroups) {
    if (!raw || typeof raw !== "object") throw new Error("동봉내역서 묶음 정보가 올바르지 않습니다.");
    const group = raw as Partial<ManifestBarcodeGroup>;
    const shipmentNumber = String(group.shipmentNumber || "").trim();
    const fulfillmentCenter = String(group.fulfillmentCenter || "").trim();
    const expectedDate = String(group.expectedDate || "").trim();
    if (!/^\d{8}$/.test(shipmentNumber) || usedShipments.has(shipmentNumber)) throw new Error("쉽먼트번호가 없거나 중복되어 바코드 생성을 차단했습니다.");
    usedShipments.add(shipmentNumber);
    if (!Array.isArray(group.purchaseOrderNumbers) || !group.purchaseOrderNumbers.length || !Array.isArray(group.items) || !group.items.length) {
      throw new Error(`쉽먼트 ${shipmentNumber}: 발주번호 또는 동봉내역서 상품목록이 없습니다.`);
    }
    const purchaseOrderNumbers = group.purchaseOrderNumbers.map(value => String(value).trim());
    for (const po of purchaseOrderNumbers) {
      if (!po || usedPurchaseOrders.has(po)) throw new Error("발주번호가 여러 쉽먼트에 중복되어 바코드 생성을 차단했습니다.");
      usedPurchaseOrders.add(po);
    }
    const groupPurchaseOrders = new Set(purchaseOrderNumbers);
    const matchedPurchaseOrders = new Set<string>();
    const barcodeRows: BarTenderPrintGroup["barcodeRows"] = [];
    for (const item of group.items) {
      if (!item || typeof item !== "object") throw new Error(`쉽먼트 ${shipmentNumber}: 동봉내역서 상품정보가 올바르지 않습니다.`);
      const po = String(item.purchaseOrderNumber || "").trim();
      const sku = normalizeSkuId(String(item.skuId || ""));
      const key = keyFor(po, sku);
      const record = sourceByKey.get(key);
      if (!record || !groupPurchaseOrders.has(po)) throw new Error(`쉽먼트 ${shipmentNumber}: 선택 발주 외 SKU ${sku}가 포함되어 있습니다.`);
      if (usedRows.has(key)) throw new Error(`발주서 ${po}의 SKU ${sku}가 중복되어 바코드 생성을 차단했습니다.`);
      const final = finalByKey.get(key);
      if (!final) throw new Error(`발주서 ${po}의 SKU ${sku}: 쉽먼트 XLSX 최종 납품수량이 없습니다.`);
      if (String(item.barcode || "").trim() !== record.barcode || !Number.isInteger(item.quantity) || item.quantity !== final.quantity || item.quantity < 1) {
        throw new Error(`발주서 ${po}의 SKU ${sku}: 동봉내역서 바코드·수량이 발주서 원본 또는 쉽먼트 XLSX 최종 납품수량과 다릅니다.`);
      }
      if (record.fulfillmentCenterName !== fulfillmentCenter || record.expectedArrivalDate !== expectedDate) {
        throw new Error(`발주서 ${po}: 동봉내역서 물류센터·입고예정일이 현재 발주서 원본과 다릅니다.`);
      }
      const matches = catalogBySku.get(sku) || [];
      if (matches.length !== 1) throw new Error(`SKU ${sku}: 제품DB 매칭 ${matches.length}건(정확히 1건 필요)`);
      const catalog = matches[0];
      const modelName = resolveBarcodeModelIdentifier(catalog);
      if (!modelName || !catalog.countryOfOrigin) throw new Error(`SKU ${sku}: 영문·숫자 모델SKU/모델명 또는 제조국명이 없습니다.`);
      const display = resolveDisplayNameAndOption(record.productName, record.optionName);
      barcodeRows.push({
        purchaseOrderNumber: po, fulfillmentCenter, expectedDate, skuId: sku,
        barcode: record.barcode, productName: display.name, optionLabel: display.option,
        quantity: final.quantity, sourceRowNumber: record.sourceRow,
        warehouseNumber: "", embeddedModelName: "", embeddedCountryOfOrigin: "", trackingNumber: "",
        modelName, countryOfOrigin: catalog.countryOfOrigin,
      });
      usedRows.add(key);
      matchedPurchaseOrders.add(po);
    }
    if (matchedPurchaseOrders.size !== groupPurchaseOrders.size) throw new Error(`쉽먼트 ${shipmentNumber}: 동봉내역서에 누락된 발주번호가 있습니다.`);
    outputGroups.push({ shipmentNumber, fulfillmentCenter, expectedDate, purchaseOrderNumbers, barcodeRows });
  }
  if (usedRows.size !== sourceByKey.size) throw new Error(`동봉내역서에 발주서 상품 ${sourceByKey.size - usedRows.size}행이 누락되어 바코드 생성을 차단했습니다.`);
  const { buildBarTenderWorkbook } = await import("./shipment-print-client");
  return Buffer.from(await buildBarTenderWorkbook(outputGroups));
}

function addBarTenderDataSheet(workbook: ExcelJS.Workbook, rows: (string | number)[][]): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("템플릿1");
  sheet.addTable({
    name: "BarTenderData",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleLight1", showRowStripes: false },
    columns: BARTENDER_HEADERS.map(name => ({ name })),
    rows,
  });
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [12, 14, 18, 48, 36, 18, 24, 14].map(width => ({ width }));
  return sheet;
}

export async function buildFulfillmentCenterLabelWorkbook(records: readonly PurchaseOrderSourceRecord[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("물류센터라벨");
  sheet.columns = [
    { header: "물류센터", key: "fulfillmentCenter", width: 32 },
    { header: "입고예정일", key: "expectedDate", width: 24 },
    { header: "발주서번호", key: "purchaseOrderNumber", width: 42 },
    { header: "총SKU", key: "totalSku", width: 12 },
    { header: "총수량", key: "totalQuantity", width: 12 },
    { header: "라벨수량", key: "labelQuantity", width: 12 },
  ];
  for (const entry of summarizeFulfillmentCenterLabels(records)) {
    sheet.addRow({
      fulfillmentCenter: entry.fulfillmentCenter,
      expectedDate: entry.expectedDate,
      purchaseOrderNumber: entry.purchaseOrderNumbers.join(" / "),
      totalSku: entry.totalSku,
      totalQuantity: entry.totalQuantity,
      labelQuantity: 1,
    });
  }
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn(1).font = { name: "맑은 고딕", size: 36, bold: true };
  sheet.getColumn(3).alignment = { wrapText: true, vertical: "middle" };
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) sheet.getRow(rowNumber).height = 54;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

export async function buildGenerationBarcodeWorkbook(
  groups: readonly ShipmentOutputGroup[],
  catalogItems: readonly ProductCatalogItem[]
): Promise<Buffer> {
  const catalogBySku = new Map<string, ProductCatalogItem[]>();
  for (const item of catalogItems) {
    const skuId = normalizeSkuId(item.skuId);
    catalogBySku.set(skuId, [...(catalogBySku.get(skuId) || []), item]);
  }

  const errors: string[] = [];
  const outputRows: (string | number)[][] = [];
  for (const group of groups) {
    let sequenceNumber = 1;
    const purchaseOrderNumbers = [...new Set(group.records.map(record => record.purchaseOrderNumber))].sort();
    const skuCount = new Set(group.records.map(record => normalizeSkuId(record.skuId))).size;
    const totalQuantity = group.records.reduce((sum, record) => sum + record.orderedQuantity, 0);
    outputRows.push([
      "물류센터 구분",
      "",
      "",
      group.fulfillmentCenterName,
      `입고예정일 ${group.expectedArrivalDate}`,
      `발주번호 ${purchaseOrderNumbers.join(" / ")}`,
      `SKU ${skuCount}종 / 총 ${totalQuantity}개`,
      "쉽먼트구분",
    ]);

    for (const record of group.records) {
      const skuId = normalizeSkuId(record.skuId);
      const matches = catalogBySku.get(skuId) || [];
      if (matches.length !== 1) {
        errors.push(`SKU ${skuId}: 제품DB 매칭 ${matches.length}건(정확히 1건 필요)`);
        continue;
      }
      const catalog = matches[0];
      const modelName = resolveBarcodeModelIdentifier(catalog);
      if (!modelName || !catalog.countryOfOrigin) {
        errors.push(`SKU ${skuId}: 영문·숫자 모델SKU/모델명 또는 제조국명 누락`);
        continue;
      }
      const display = resolveDisplayNameAndOption(record.productName, record.optionName);
      for (let count = 0; count < record.orderedQuantity; count += 1) {
        outputRows.push([
          skuId,
          sequenceNumber,
          record.barcode,
          display.name,
          display.option,
          catalog.countryOfOrigin,
          modelName,
          "상품",
        ]);
        sequenceNumber += 1;
      }
    }
  }
  if (errors.length > 0) throw new Error(`바코드 파일 생성을 차단했습니다. ${errors.join(" | ")}`);

  const workbook = new ExcelJS.Workbook();
  addBarTenderDataSheet(workbook, outputRows.reverse());
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

/** 재출력센터 전용. 발주서 원본 한 행을 원하는 장수만큼 넣고 구분행은 만들지 않는다. */
export async function buildSingleBarcodeWorkbook(
  record: PurchaseOrderSourceRecord,
  catalog: ProductCatalogItem,
  quantity: number
): Promise<Buffer> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error("바코드 출력수량은 1~1000 사이 정수여야 합니다.");
  const skuId = normalizeSkuId(record.skuId);
  const modelName = resolveBarcodeModelIdentifier(catalog);
  if (!record.barcode.trim()) throw new Error(`SKU ${skuId}: 발주서 원본 바코드가 없습니다.`);
  if (!modelName || !catalog.countryOfOrigin) throw new Error(`SKU ${skuId}: 영문·숫자 모델SKU/모델명 또는 제조국명이 없습니다.`);
  const display = resolveDisplayNameAndOption(record.productName, record.optionName);
  const workbook = new ExcelJS.Workbook();
  const rows: (string | number)[][] = [];
  for (let index = 0; index < quantity; index += 1) {
    rows.push([skuId, index + 1, record.barcode, display.name, display.option, catalog.countryOfOrigin, modelName, "상품"]);
  }
  addBarTenderDataSheet(workbook, rows.reverse());
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

export interface BatchBarcodeWorkbookItem {
  record: PurchaseOrderSourceRecord;
  catalog: ProductCatalogItem;
  quantity: number;
}

/** 재출력센터 다건 출력 전용. 화면에 담은 순서를 실제 적재 순서로 유지하도록 전체 행을 역순 저장한다. */
export async function buildBatchBarcodeWorkbook(items: readonly BatchBarcodeWorkbookItem[]): Promise<Buffer> {
  if (items.length < 1 || items.length > 200) throw new Error("한 파일에는 바코드를 1~200종까지 담을 수 있습니다.");
  const outputRows: (string | number)[][] = [];
  let sequenceNumber = 1;
  for (const { record, catalog, quantity } of items) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error("바코드 출력수량은 SKU별 1~1000 사이 정수여야 합니다.");
    const skuId = normalizeSkuId(record.skuId);
    const modelName = resolveBarcodeModelIdentifier(catalog);
    if (!record.barcode.trim()) throw new Error(`SKU ${skuId}: 발주서 원본 바코드가 없습니다.`);
    if (!modelName || !catalog.countryOfOrigin) throw new Error(`SKU ${skuId}: 영문·숫자 모델SKU/모델명 또는 제조국명이 없습니다.`);
    const display = resolveDisplayNameAndOption(record.productName, record.optionName);
    for (let index = 0; index < quantity; index += 1) {
      outputRows.push([skuId, sequenceNumber, record.barcode, display.name, display.option, catalog.countryOfOrigin, modelName, "상품"]);
      sequenceNumber += 1;
    }
  }
  const workbook = new ExcelJS.Workbook();
  addBarTenderDataSheet(workbook, outputRows.reverse());
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}
