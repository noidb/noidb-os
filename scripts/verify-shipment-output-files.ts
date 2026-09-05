import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { resolveBarcodeModelIdentifier } from "../lib/wms/barcode-model-identifier";
import { buildShipmentCreationUploadFile, type ParsedTrackingRow } from "../lib/wms/hanjin-upload";
import { findTrackingNumbersReusedAcrossShippingGroups } from "../lib/wms/hanjin-shipment-auto";
import { buildFulfillmentCenterLabelWorkbook, buildGenerationBarcodeWorkbook } from "../lib/wms/shipment-output-files";
import type { ProductCatalogItem } from "../lib/wms/product-catalog";
import type { PurchaseOrderSourceRecord } from "../lib/wms/purchase-order-source/types";
import type { ShipmentOutputGroup } from "../lib/wms/shipment-output-context";

async function main() {
assert.equal(resolveBarcodeModelIdentifier({ modelSku: "wr000123-SI20", modelName: "한글 상품명" }), "wr000123-SI20");
assert.equal(resolveBarcodeModelIdentifier({ modelSku: "", modelName: "we00011" }), "we00011");
assert.equal(resolveBarcodeModelIdentifier({ modelSku: "", modelName: "노이드비 써지컬스틸" }), "");
const records: PurchaseOrderSourceRecord[] = [
  { purchaseOrderNumber: "140000001", sourceContainerFile: "fixture", sourceEntryFile: "a.xlsx", sourceSheet: "상품목록", sourceRow: 2, fulfillmentCenterName: "서울", expectedArrivalDate: "2026-09-04", recipientName: "서울", phone: "01000000000", postalCode: "00000", address: "서울", skuId: "1001", barcode: "R1001", productName: "테스트 목걸이, 골드", optionName: "골드", orderedQuantity: 2 },
  { purchaseOrderNumber: "140000002", sourceContainerFile: "fixture", sourceEntryFile: "b.xlsx", sourceSheet: "상품목록", sourceRow: 2, fulfillmentCenterName: "호법", expectedArrivalDate: "2026-09-04", recipientName: "호법", phone: "01000000000", postalCode: "00000", address: "호법", skuId: "1002", barcode: "R1002", productName: "테스트 반지, 실버", optionName: "실버", orderedQuantity: 1 },
];
const groups: ShipmentOutputGroup[] = records.map(record => ({ key: record.purchaseOrderNumber, fulfillmentCenterName: record.fulfillmentCenterName, expectedArrivalDate: record.expectedArrivalDate, recipientName: record.recipientName, phone: record.phone, postalCode: record.postalCode, postalCodeSource: "fixture", address: record.address, purchaseOrderNumbers: [record.purchaseOrderNumber], records: [record] }));
const catalog = records.map((record, index) => ({ skuId: record.skuId, modelSku: `model-${index}`, modelName: `model-${index}`, category: "", gender: "", productName: record.productName, optionLabel: record.optionName, imageUrl: "", warehouseNumber: `귀걸이A-${index + 1}`, boxNumber: "", currentStock: "", currentStatus: "", costVatIncluded: "", vendorName: "", barcode: "제품DB값은사용하지않음", countryOfOrigin: "중국", productLink: "" })) satisfies ProductCatalogItem[];

const barcodeBuffer = await buildGenerationBarcodeWorkbook(groups, catalog);
const barcodeBook = new ExcelJS.Workbook();
await barcodeBook.xlsx.load(barcodeBuffer as unknown as ExcelJS.Buffer);
const barcodeSheet = barcodeBook.getWorksheet("템플릿1")!;
assert.equal(barcodeSheet.getTables().length, 1, "Shipment 바코드 파일에도 BarTender용 Excel 테이블이 있어야 합니다.");
assert.deepEqual((barcodeSheet.getRow(1).values as unknown[]).slice(1), ["SKU ID", "번호", "바코드", "상품명", "옵션명", "제조국명", "모델명", "출력유형"]);
assert.equal(barcodeSheet.rowCount, 6);
assert.equal([...barcodeSheet.getColumn(3).values].includes("제품DB값은사용하지않음"), false);
assert.deepEqual([2, 4, 5].map(row => barcodeSheet.getRow(row).getCell(2).value), [1, 2, 1], "쉽먼트별 번호는 창고분류가 아니라 1부터 시작하는 숫자 순번이어야 합니다.");

const labelBuffer = await buildFulfillmentCenterLabelWorkbook(records);
const labelBook = new ExcelJS.Workbook();
await labelBook.xlsx.load(labelBuffer as unknown as ExcelJS.Buffer);
assert.equal(labelBook.getWorksheet("물류센터라벨")?.rowCount, 3);

const trackingRows: ParsedTrackingRow[] = records.map((record, index) => ({ purchaseOrderNumber: record.purchaseOrderNumber, fulfillmentCenter: record.fulfillmentCenterName, transportType: "쉽먼트", expectedDate: record.expectedArrivalDate, skuId: record.skuId, barcode: record.barcode, productName: record.productName, confirmedQuantity: String(record.orderedQuantity), trackingNumber: `46300000000${index + 1}`, shippedQuantity: String(record.orderedQuantity) }));
assert.deepEqual(findTrackingNumbersReusedAcrossShippingGroups(trackingRows), []);
assert.deepEqual(findTrackingNumbersReusedAcrossShippingGroups(trackingRows.map(row => ({ ...row, trackingNumber: "463000000001" }))), ["463000000001"]);

const template = await readFile(path.join(process.cwd(), "public", "templates", "ShipmentsUpload_PARCEL_template.xlsx"));
const shipment = await buildShipmentCreationUploadFile(trackingRows, records.map(record => ({ purchaseOrderNumber: record.purchaseOrderNumber, fulfillmentCenter: record.fulfillmentCenterName })), template);
const shipmentBook = new ExcelJS.Workbook();
await shipmentBook.xlsx.load(shipment.buffer as unknown as ExcelJS.Buffer);
assert.deepEqual(shipmentBook.worksheets.map(sheet => sheet.name), ["상품목록", "송장번호입력", "입력방법"]);
assert.equal(shipmentBook.getWorksheet("상품목록")?.getCell("D2").value, "20260904");
assert.equal(shipmentBook.getWorksheet("송장번호입력")?.getCell("A2").value, "463000000001");
assert.equal(shipmentBook.getWorksheet("송장번호입력")?.getCell("A3").value, "463000000002");

const outputDir = path.join(process.cwd(), ".tmp", "shipment-output-verification");
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "shipment-template-result.xlsx"), shipment.buffer);
await writeFile(path.join(outputDir, "barcode-only.xlsx"), barcodeBuffer);
await writeFile(path.join(outputDir, "center-label-only.xlsx"), labelBuffer);
console.log(JSON.stringify({ shipmentSheets: shipmentBook.worksheets.map(sheet => sheet.name), shipmentRows: shipment.includedCount, trackingNumbers: ["463000000001", "463000000002"], barcodeRows: barcodeSheet.rowCount - 1, labelRows: (labelBook.getWorksheet("물류센터라벨")?.rowCount || 1) - 1, differentCenterDuplicateBlocked: true }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
