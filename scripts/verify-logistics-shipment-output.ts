import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  buildLogisticsBarTenderWorkbook,
  matchShipmentPrintGroups,
  type BarcodeSourceRow,
  type ShipmentPdfFile,
} from "../lib/wms/shipment-print-client";

const shipmentNumber = "50129648";

function pdfFile(kind: "label" | "manifest", quantity = 3): ShipmentPdfFile {
  return {
    shipmentNumber,
    file: new File([kind], `${kind}(${shipmentNumber}).pdf`, { type: "application/pdf" }),
    pageCount: 1,
    pageWidth: 595,
    pageHeight: 842,
    pblCode: "PBL0108037352",
    trackingNumber: "463196755151",
    expectedDate: "2026-09-17",
    fulfillmentCenter: "인천14",
    purchaseOrderNumbers: kind === "label" ? ["140000001", "140000002"] : [],
    boxNumber: "1-1",
    // sourceRows 순서(574... 다음 420...)와 반대로 동봉내역서 순서를 둔다.
    items: kind === "manifest" ? [
      { skuId: "42085186", barcode: "R42085186", quantity: 1 },
      { skuId: "57450341", barcode: "R57450341", quantity },
    ] : [],
  };
}

const sourceRows: BarcodeSourceRow[] = [
  { purchaseOrderNumber: "140000001", fulfillmentCenter: "인천14", expectedDate: "2026-09-17", skuId: "57450341", warehouseNumber: "", barcode: "R57450341", productName: "테스트 목걸이, model-x | 블랙, S", optionLabel: "", quantity: 2, sourceRowNumber: 2, embeddedModelName: "", embeddedCountryOfOrigin: "", trackingNumber: "463196755151" },
  { purchaseOrderNumber: "140000002", fulfillmentCenter: "인천14", expectedDate: "2026-09-17", skuId: "57450341", warehouseNumber: "", barcode: "R57450341", productName: "테스트 목걸이, model-x | 블랙, S", optionLabel: "", quantity: 1, sourceRowNumber: 3, embeddedModelName: "", embeddedCountryOfOrigin: "", trackingNumber: "463196755151" },
  { purchaseOrderNumber: "140000001", fulfillmentCenter: "인천14", expectedDate: "2026-09-17", skuId: "42085186", warehouseNumber: "", barcode: "R42085186", productName: "테스트 반지, model-y | 실버", optionLabel: "", quantity: 1, sourceRowNumber: 4, embeddedModelName: "", embeddedCountryOfOrigin: "", trackingNumber: "463196755151" },
];

async function main() {
  // 제품DB 없이, 동일 SKU가 여러 PO에 합산된 실제 동봉내역서 수량을 보존해야 한다.
  const groups = matchShipmentPrintGroups([pdfFile("label")], [pdfFile("manifest")], sourceRows, [], [], { requireBarcodeMetadata: false });
  assert.deepEqual(groups[0].barcodeRows.map(row => [row.skuId, row.purchaseOrderNumber, row.quantity]), [["42085186", "140000001", 1], ["57450341", "140000001", 2], ["57450341", "140000002", 1]]);

  const secondShipment = {
    ...groups[0],
    shipmentNumber: "50129649",
    purchaseOrderNumbers: ["140000003"],
    barcodeRows: [{ ...groups[0].barcodeRows[0], purchaseOrderNumber: "140000003", skuId: "78453238", barcode: "R78453238", productName: "테스트 귀걸이, model-z | 골드", quantity: 2 }],
  };
  const bytes = await buildLogisticsBarTenderWorkbook([...groups, secondShipment]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet("템플릿1")!;
  assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), ["SKU ID", "번호", "바코드", "상품명", "옵션명", "제조국명", "출력유형"]);
  // 두 번째 쉽먼트가 먼저 저장되고, 그 상품 번호 2→1 뒤 구분행이 온다.
  assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1), ["78453238", 2, "R78453238", "테스트 귀걸이", "골드", "중국", "상품"]);
  assert.deepEqual((sheet.getRow(3).values as unknown[]).slice(1), ["78453238", 1, "R78453238", "테스트 귀걸이", "골드", "중국", "상품"]);
  assert.equal(sheet.getRow(4).getCell(1).value, "쉽먼트 구분");
  assert.equal(sheet.getRow(4).getCell(5).value, "2026-09-17\n쉽먼트번호 50129649");
  // 첫 쉽먼트는 동봉내역서 순서 420...→574...로 번호를 매긴 뒤, XLSX에는 역순으로 저장한다.
  assert.deepEqual((sheet.getRow(5).values as unknown[]).slice(1), ["57450341", 4, "R57450341", "테스트 목걸이", "블랙, S", "중국", "상품"]);
  assert.deepEqual((sheet.getRow(6).values as unknown[]).slice(1), ["57450341", 3, "R57450341", "테스트 목걸이", "블랙, S", "중국", "상품"]);
  assert.deepEqual((sheet.getRow(7).values as unknown[]).slice(1), ["57450341", 2, "R57450341", "테스트 목걸이", "블랙, S", "중국", "상품"]);
  assert.deepEqual((sheet.getRow(8).values as unknown[]).slice(1), ["42085186", 1, "R42085186", "테스트 반지", "실버", "중국", "상품"]);
  assert.equal(sheet.getRow(9).getCell(1).value, "쉽먼트 구분");
  assert.equal(sheet.getRow(9).getCell(4).value, "인천14");
  assert.equal(sheet.getRow(9).getCell(5).value, "2026-09-17\n쉽먼트번호 50129648");
  assert.equal(sheet.getRow(9).getCell(6).value, "발주번호 140000001 / 140000002\nSKU 2종 / 총 4개");
  assert.equal(sheet.getRow(9).getCell(7).value, "쉽먼트구분");

  assert.throws(
    () => matchShipmentPrintGroups([pdfFile("label")], [pdfFile("manifest", 2)], sourceRows, [], [], { requireBarcodeMetadata: false }),
    /최종 납품수량 불일치/,
  );
  assert.throws(
    () => matchShipmentPrintGroups([pdfFile("label")], [pdfFile("manifest")], [{ ...sourceRows[0], fulfillmentCenter: "호법" }, sourceRows[1]], [], [], { requireBarcodeMetadata: false }),
    /입고예정일 또는 물류센터 불일치/,
  );
  assert.throws(
    () => matchShipmentPrintGroups([pdfFile("label")], [pdfFile("manifest")], [{ ...sourceRows[0], barcode: "WRONG" }, sourceRows[1], sourceRows[2]], [], [], { requireBarcodeMetadata: false }),
    /상품바코드 불일치/,
  );
  assert.throws(
    () => matchShipmentPrintGroups([pdfFile("label"), pdfFile("label")], [pdfFile("manifest")], sourceRows, [], [], { requireBarcodeMetadata: false }),
    /Label 중복 쉽먼트번호/,
  );
  console.log(JSON.stringify({ headers: 7, productRows: 6, manifestOrderPreserved: true, separatorLastPerShipment: true, emptyCatalog: true, aggregateSkuAcrossPos: true, quantityMismatchBlocked: true, centerMismatchBlocked: true, barcodeMismatchBlocked: true, duplicateShipmentBlocked: true }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
