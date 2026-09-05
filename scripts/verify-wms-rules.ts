import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { resolveDisplayNameAndOption } from "../lib/wms/display-name";
import { buildBarTenderWorkbook, type ShipmentPrintGroup } from "../lib/wms/shipment-print-client";
import { buildBatchBarcodeWorkbook, buildSingleBarcodeWorkbook } from "../lib/wms/shipment-output-files";
import { buildDefaultConfirmedQuantities } from "../lib/wms/picking-wave/po-confirm-rows";

async function main() {
  assert.deepEqual(buildDefaultConfirmedQuantities([
    { skuId: "SKU-ORDERED", productName: "테스트", originalQuantity: 12, foundQuantity: 0, shortageQuantity: 12 },
  ]), { "SKU-ORDERED": 12 }, "발주확정 기본수량은 피킹수량이 아니라 발주수량이어야 한다");
  const split = resolveDisplayNameAndOption(
    "노이드비 써지컬스틸 큐빅포인트 투라인 여성 반지, 실버, 25호",
    "",
  );
  assert.deepEqual(split, {
    name: "써지컬스틸 큐빅포인트 투라인 여성 반지",
    option: "실버, 25호",
  });

  const noComma = resolveDisplayNameAndOption("NOID-B 써지컬스틸 반지 실버 25호", "실버");
  assert.deepEqual(noComma, { name: "써지컬스틸 반지", option: "실버 25호" });

  const inferredSize = resolveDisplayNameAndOption("노이드비 체인패턴 반지 로즈골드 11호", "");
  assert.deepEqual(inferredSize, { name: "체인패턴 반지", option: "로즈골드 11호" });

  const group = {
    shipmentNumber: "49848770",
    purchaseOrderNumbers: ["139999999"],
    fulfillmentCenter: "인천36",
    expectedDate: "2026-08-28",
    boxNumber: "1",
    barcodeRows: [{
      purchaseOrderNumber: "139999999", fulfillmentCenter: "인천36", expectedDate: "2026-08-28",
      skuId: "50138268", warehouseNumber: "R0001", barcode: "R123456789001",
      productName: split.name, optionLabel: split.option, quantity: 2, sourceRowNumber: 1,
      embeddedModelName: "", embeddedCountryOfOrigin: "", trackingNumber: "1234567890",
      modelName: "TEST-MODEL", countryOfOrigin: "중국",
    }],
    label: {} as ShipmentPrintGroup["label"],
    manifest: {} as ShipmentPrintGroup["manifest"],
  } satisfies ShipmentPrintGroup;

  const bytes = await buildBarTenderWorkbook([group]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet("템플릿1");
  assert(sheet);
  assert.equal(sheet.getTables().length, 1, "BarTender가 인식할 수 있는 Excel 테이블이 정확히 1개 있어야 합니다.");
  assert.deepEqual((sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1), ["SKU ID", "번호", "바코드", "상품명", "옵션명", "제조국명", "모델명", "출력유형"]);
  assert.equal(sheet.getRow(2).getCell(8).value, "상품", "역순 출력의 첫 데이터 행은 상품이어야 합니다.");
  assert.equal(sheet.getRow(2).getCell(4).value, split.name);
  assert.equal(sheet.getRow(2).getCell(5).value, split.option);
  assert.equal(sheet.getRow(2).getCell(2).value, 2, "역순 파일의 번호는 창고분류가 아니라 숫자 순번이어야 합니다.");
  assert.equal(sheet.getRow(sheet.rowCount).getCell(8).value, "쉽먼트구분", "역순 출력의 마지막 행은 쉽먼트 구분행이어야 합니다.");

  const singleBytes = await buildSingleBarcodeWorkbook({
    purchaseOrderNumber: "139999999", sourceContainerFile: "fixture", sourceEntryFile: "po.xlsx", sourceSheet: "상품목록", sourceRow: 22,
    fulfillmentCenterName: "인천36", expectedArrivalDate: "2026-08-28", recipientName: "", phone: "01000000000", postalCode: "", address: "인천",
    skuId: "50138268", barcode: "R123456789001", productName: "노이드비 테스트 여성 반지, 실버, 25호", optionName: "실버, 25호", orderedQuantity: 2,
  }, {
    skuId: "50138268", modelSku: "TEST-RG-25", modelName: "", category: "여성반지", gender: "여성", productName: "", optionLabel: "", imageUrl: "", warehouseNumber: "여성반지-1", boxNumber: "", currentStock: "", currentStatus: "", costVatIncluded: "", vendorName: "", barcode: "R123456789001", countryOfOrigin: "중국", productLink: "",
  }, 1);
  const singleWorkbook = new ExcelJS.Workbook();
  await singleWorkbook.xlsx.load(singleBytes as unknown as ArrayBuffer);
  const singleSheet = singleWorkbook.getWorksheet("템플릿1");
  assert(singleSheet);
  assert.equal(singleSheet.getTables().length, 1, "1장 재출력 파일에도 Excel 테이블이 있어야 합니다.");
  assert.equal(singleSheet.rowCount, 2, "바코드 1장 재출력은 헤더 외 상품행이 정확히 1개여야 합니다.");
  assert.equal(singleSheet.getRow(2).getCell(5).value, "실버, 25호");
  assert.equal(singleSheet.getRow(2).getCell(2).value, 1, "1장 재출력 번호는 숫자 1이어야 합니다.");
  assert.equal(singleSheet.getRow(2).getCell(8).value, "상품");

  const batchBytes = await buildBatchBarcodeWorkbook([
    {
      record: { purchaseOrderNumber: "139999999", sourceContainerFile: "fixture", sourceEntryFile: "po.xlsx", sourceSheet: "상품목록", sourceRow: 22, fulfillmentCenterName: "인천36", expectedArrivalDate: "2026-08-28", recipientName: "", phone: "", postalCode: "", address: "", skuId: "50138268", barcode: "R123456789001", productName: "노이드비 첫 상품, 실버", optionName: "실버", orderedQuantity: 1 },
      catalog: { skuId: "50138268", modelSku: "TEST-1", modelName: "", category: "", gender: "", productName: "", optionLabel: "", imageUrl: "", warehouseNumber: "A-1", boxNumber: "", currentStock: "", currentStatus: "", costVatIncluded: "", vendorName: "", barcode: "R123456789001", countryOfOrigin: "중국", productLink: "" },
      quantity: 1,
    },
    {
      record: { purchaseOrderNumber: "139999998", sourceContainerFile: "fixture", sourceEntryFile: "po.xlsx", sourceSheet: "상품목록", sourceRow: 23, fulfillmentCenterName: "인천36", expectedArrivalDate: "2026-08-28", recipientName: "", phone: "", postalCode: "", address: "", skuId: "50138269", barcode: "R123456789002", productName: "노이드비 둘째 상품, 골드", optionName: "골드", orderedQuantity: 1 },
      catalog: { skuId: "50138269", modelSku: "TEST-2", modelName: "", category: "", gender: "", productName: "", optionLabel: "", imageUrl: "", warehouseNumber: "A-2", boxNumber: "", currentStock: "", currentStatus: "", costVatIncluded: "", vendorName: "", barcode: "R123456789002", countryOfOrigin: "중국", productLink: "" },
      quantity: 2,
    },
  ]);
  const batchWorkbook = new ExcelJS.Workbook();
  await batchWorkbook.xlsx.load(batchBytes as unknown as ArrayBuffer);
  const batchSheet = batchWorkbook.getWorksheet("템플릿1");
  assert(batchSheet);
  assert.equal(batchSheet.getTables().length, 1, "다건 재출력 파일에도 Excel 테이블이 있어야 합니다.");
  assert.equal(batchSheet.rowCount, 4, "2종 3장 선택 재출력은 헤더 외 상품행이 정확히 3개여야 합니다.");
  assert.deepEqual([2, 3, 4].map(row => batchSheet.getRow(row).getCell(1).value), ["50138269", "50138269", "50138268"], "선택 재출력 파일은 실제 적재 순서를 위해 전체 역순이어야 합니다.");
  assert.deepEqual([2, 3, 4].map(row => batchSheet.getRow(row).getCell(2).value), [3, 2, 1], "다건 재출력 번호는 선택 순서의 숫자 순번을 전체 역순으로 저장해야 합니다.");

  console.log("WMS 고정 규칙 검증 통과: 브랜드 제거, 첫 쉼표 옵션 분리, 호수 보존, BarTender XLSX, 구분행, 전체 역순, 바코드 1장·다건 재출력");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
