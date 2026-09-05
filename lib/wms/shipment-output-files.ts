import ExcelJS from "exceljs";
import { resolveBarcodeModelIdentifier } from "./barcode-model-identifier";
import { resolveDisplayNameAndOption } from "./display-name";
import { summarizeFulfillmentCenterLabels } from "./fulfillment-center-label-summary";
import { normalizeSkuId } from "./sku-normalize";
import type { ProductCatalogItem } from "./product-catalog";
import type { PurchaseOrderSourceRecord } from "./purchase-order-source/types";
import type { ShipmentOutputGroup } from "./shipment-output-context";

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
          catalog.warehouseNumber,
          record.barcode,
          display.name,
          display.option,
          catalog.countryOfOrigin,
          modelName,
          "상품",
        ]);
      }
    }
  }
  if (errors.length > 0) throw new Error(`바코드 파일 생성을 차단했습니다. ${errors.join(" | ")}`);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("템플릿1");
  sheet.addRow(["SKU ID", "번호", "바코드", "상품명", "옵션명", "제조국명", "모델명", "출력유형"]);
  for (const row of outputRows.reverse()) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [12, 14, 18, 48, 36, 18, 24, 14].map(width => ({ width }));
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
  const sheet = workbook.addWorksheet("템플릿1");
  sheet.addRow(["SKU ID", "번호", "바코드", "상품명", "옵션명", "제조국명", "모델명", "출력유형"]);
  for (let index = 0; index < quantity; index += 1) {
    sheet.addRow([skuId, catalog.warehouseNumber, record.barcode, display.name, display.option, catalog.countryOfOrigin, modelName, "상품"]);
  }
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [12, 14, 18, 48, 36, 18, 24, 14].map(width => ({ width }));
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
  for (const { record, catalog, quantity } of items) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error("바코드 출력수량은 SKU별 1~1000 사이 정수여야 합니다.");
    const skuId = normalizeSkuId(record.skuId);
    const modelName = resolveBarcodeModelIdentifier(catalog);
    if (!record.barcode.trim()) throw new Error(`SKU ${skuId}: 발주서 원본 바코드가 없습니다.`);
    if (!modelName || !catalog.countryOfOrigin) throw new Error(`SKU ${skuId}: 영문·숫자 모델SKU/모델명 또는 제조국명이 없습니다.`);
    const display = resolveDisplayNameAndOption(record.productName, record.optionName);
    for (let index = 0; index < quantity; index += 1) {
      outputRows.push([skuId, catalog.warehouseNumber, record.barcode, display.name, display.option, catalog.countryOfOrigin, modelName, "상품"]);
    }
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("템플릿1");
  sheet.addRow(["SKU ID", "번호", "바코드", "상품명", "옵션명", "제조국명", "모델명", "출력유형"]);
  for (const row of outputRows.reverse()) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [12, 14, 18, 48, 36, 18, 24, 14].map(width => ({ width }));
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}
