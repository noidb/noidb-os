import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { resolveDisplayNameAndOption } from "../lib/wms/display-name";
import { buildBarTenderWorkbook, type ShipmentPrintGroup } from "../lib/wms/shipment-print-client";
import { buildBatchBarcodeWorkbook, buildManifestOrderedBarcodeWorkbook, buildSingleBarcodeWorkbook, type ManifestBarcodeGroup } from "../lib/wms/shipment-output-files";
import { buildDefaultConfirmedQuantities } from "../lib/wms/picking-wave/po-confirm-rows";
import { selectShipmentPrintWorkbook } from "../lib/wms/shipment-print-workbook-source";

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

  const singleRecord: Parameters<typeof buildSingleBarcodeWorkbook>[0] = {
    purchaseOrderNumber: "139999999", sourceContainerFile: "fixture", sourceEntryFile: "po.xlsx", sourceSheet: "상품목록", sourceRow: 22,
    fulfillmentCenterName: "인천36", expectedArrivalDate: "2026-08-28", recipientName: "", phone: "01000000000", postalCode: "", address: "인천",
    skuId: "50138268", barcode: "R123456789001", productName: "노이드비 테스트 여성 반지, 실버, 25호", optionName: "실버, 25호", orderedQuantity: 2,
  };
  const singleCatalog: Parameters<typeof buildSingleBarcodeWorkbook>[1] = {
    skuId: "50138268", modelSku: "TEST-RG-25", modelName: "", category: "여성반지", gender: "여성", productName: "", optionLabel: "", imageUrl: "", warehouseNumber: "여성반지-1", boxNumber: "", currentStock: "", currentStatus: "", costVatIncluded: "", vendorName: "", barcode: "R123456789001", countryOfOrigin: "중국", productLink: "",
  };
  const singleBytes = await buildSingleBarcodeWorkbook(singleRecord, singleCatalog, 1);
  const singleWorkbook = new ExcelJS.Workbook();
  await singleWorkbook.xlsx.load(singleBytes as unknown as ArrayBuffer);
  const singleSheet = singleWorkbook.getWorksheet("템플릿1");
  assert(singleSheet);
  assert.equal(singleSheet.getTables().length, 1, "1장 재출력 파일에도 Excel 테이블이 있어야 합니다.");
  assert.equal(singleSheet.rowCount, 2, "바코드 1장 재출력은 헤더 외 상품행이 정확히 1개여야 합니다.");
  assert.equal(singleSheet.getRow(2).getCell(5).value, "실버, 25호");
  assert.equal(singleSheet.getRow(2).getCell(2).value, 1, "1장 재출력 번호는 숫자 1이어야 합니다.");
  assert.equal(singleSheet.getRow(2).getCell(8).value, "상품");

  const repeatedBytes = await buildSingleBarcodeWorkbook(singleRecord, singleCatalog, 3);
  const repeatedWorkbook = new ExcelJS.Workbook();
  await repeatedWorkbook.xlsx.load(repeatedBytes as unknown as ArrayBuffer);
  const repeatedSheet = repeatedWorkbook.getWorksheet("템플릿1");
  assert(repeatedSheet);
  assert.equal(repeatedSheet.rowCount, 4, "한 SKU를 3장 재출력하면 상품행은 정확히 3개여야 합니다.");
  assert.deepEqual([2, 3, 4].map(row => repeatedSheet.getRow(row).getCell(2).value), [3, 2, 1], "한 SKU 여러 장도 숫자 순번을 전체 역순으로 저장해야 합니다.");
  assert.deepEqual([2, 3, 4].map(row => [
    repeatedSheet.getRow(row).getCell(3).value,
    repeatedSheet.getRow(row).getCell(5).value,
    repeatedSheet.getRow(row).getCell(8).value,
  ]), Array.from({ length: 3 }, () => [singleRecord.barcode, "실버, 25호", "상품"]), "반복 라벨의 바코드·전체 옵션을 보존하고 구분행을 추가하지 않아야 합니다.");

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

  const manifestRecords = [
    { ...singleRecord, productName: `노이드비 ${split.name}, ${split.option}` },
    { ...singleRecord, skuId: "50138269", barcode: "R123456789002", productName: "노이드비 둘째 반지, 골드, 12호", optionName: "골드, 12호", orderedQuantity: 1, sourceRow: 23 },
  ];
  const manifestCatalog = [
    { ...singleCatalog, modelSku: "TEST-MODEL" },
    { ...singleCatalog, skuId: "50138269", modelSku: "TEST-MODEL-2" },
  ];
  const finalQuantityRows = manifestRecords.map(record => ({
    purchaseOrderNumber: record.purchaseOrderNumber,
    fulfillmentCenter: record.fulfillmentCenterName,
    transportType: "쉽먼트",
    expectedDate: record.expectedArrivalDate,
    skuId: record.skuId,
    barcode: record.barcode,
    productName: record.productName,
    confirmedQuantity: String(record.orderedQuantity),
    trackingNumber: "463000000001",
    shippedQuantity: String(record.orderedQuantity),
  }));
  const orderedManifest: ManifestBarcodeGroup = {
    shipmentNumber: group.shipmentNumber,
    fulfillmentCenter: group.fulfillmentCenter,
    expectedDate: group.expectedDate,
    purchaseOrderNumbers: group.purchaseOrderNumbers,
    items: [...manifestRecords].reverse().map(record => ({ purchaseOrderNumber: record.purchaseOrderNumber, skuId: record.skuId, barcode: record.barcode, quantity: record.orderedQuantity })),
  };
  const fullSetGroup = {
    ...group,
    barcodeRows: [
      { ...group.barcodeRows[0], skuId: "50138269", barcode: "R123456789002", productName: "둘째 반지", optionLabel: "골드, 12호", quantity: 1, modelName: "TEST-MODEL-2" },
      group.barcodeRows[0],
    ],
  };
  const expectedManifestBook = new ExcelJS.Workbook();
  await expectedManifestBook.xlsx.load(await buildBarTenderWorkbook([fullSetGroup]) as unknown as ArrayBuffer);
  const onlyBarcodeBook = new ExcelJS.Workbook();
  await onlyBarcodeBook.xlsx.load(await buildManifestOrderedBarcodeWorkbook([{
    ...orderedManifest,
    items: orderedManifest.items.map(item => ({ ...item, productName: "클라이언트 상품명은 사용 금지", countryOfOrigin: "클라이언트 제조국은 사용 금지" })),
  }], manifestRecords, manifestCatalog, finalQuantityRows) as unknown as ArrayBuffer);
  assert.deepEqual(onlyBarcodeBook.getWorksheet("템플릿1")?.getSheetValues(), expectedManifestBook.getWorksheet("템플릿1")?.getSheetValues(), "바코드만 생성해도 전체 출력세트와 모든 행·순번·구분표가 같아야 하며 상품정보는 서버 원본을 사용해야 합니다.");
  assert.equal(onlyBarcodeBook.getWorksheet("템플릿1")?.getTables().length, 1);
  const reducedManifest = {
    ...orderedManifest,
    items: orderedManifest.items.map(item => item.skuId === singleRecord.skuId ? { ...item, quantity: 1 } : item),
  };
  const reducedFinalQuantityRows = finalQuantityRows.map(row => row.skuId === singleRecord.skuId
    ? { ...row, confirmedQuantity: "1", shippedQuantity: "1" }
    : row);
  const reducedFullSetBook = new ExcelJS.Workbook();
  await reducedFullSetBook.xlsx.load(await buildBarTenderWorkbook([{
    ...fullSetGroup,
    barcodeRows: fullSetGroup.barcodeRows.map(row => row.skuId === singleRecord.skuId ? { ...row, quantity: 1 } : row),
  }]) as unknown as ArrayBuffer);
  const reducedOnlyBarcodeBook = new ExcelJS.Workbook();
  await reducedOnlyBarcodeBook.xlsx.load(await buildManifestOrderedBarcodeWorkbook([reducedManifest], manifestRecords, manifestCatalog, reducedFinalQuantityRows) as unknown as ArrayBuffer);
  assert.deepEqual(reducedOnlyBarcodeBook.getWorksheet("템플릿1")?.getSheetValues(), reducedFullSetBook.getWorksheet("템플릿1")?.getSheetValues(), "원발주보다 감소한 최종 납품수량도 선택된 Shipment XLSX와 일치하면 전체 출력세트와 같아야 합니다.");

  await assert.rejects(buildManifestOrderedBarcodeWorkbook(undefined, manifestRecords, manifestCatalog, finalQuantityRows), /동봉내역서 순서/);
  await assert.rejects(buildManifestOrderedBarcodeWorkbook([{ ...orderedManifest, items: orderedManifest.items.slice(1) }], manifestRecords, manifestCatalog, finalQuantityRows), /누락/, "같은 발주번호여도 SKU 한 행이 빠지면 전체 생성을 차단해야 합니다.");
  await assert.rejects(buildManifestOrderedBarcodeWorkbook([{ ...orderedManifest, items: [...orderedManifest.items, orderedManifest.items[0]] }], manifestRecords, manifestCatalog, finalQuantityRows), /중복/);
  await assert.rejects(buildManifestOrderedBarcodeWorkbook([{ ...orderedManifest, items: orderedManifest.items.map((item, index) => index === 0 ? { ...item, barcode: "R-WRONG" } : item) }], manifestRecords, manifestCatalog, finalQuantityRows), /바코드·수량/);
  await assert.rejects(buildManifestOrderedBarcodeWorkbook([orderedManifest], manifestRecords, manifestCatalog, reducedFinalQuantityRows), /최종 납품수량/, "클라이언트 수량이 선택된 Shipment XLSX와 다르면 생성을 차단해야 합니다.");
  await assert.rejects(buildManifestOrderedBarcodeWorkbook([{ ...orderedManifest, items: orderedManifest.items.map((item, index) => index === 0 ? { ...item, quantity: item.quantity + 1 } : item) }], manifestRecords, manifestCatalog, finalQuantityRows), /바코드·수량/);
  await assert.rejects(buildManifestOrderedBarcodeWorkbook([{ ...orderedManifest, items: orderedManifest.items.map((item, index) => index === 0 ? { ...item, purchaseOrderNumber: "140000000" } : item) }], manifestRecords, manifestCatalog, finalQuantityRows), /선택 발주 외/);
  await assert.rejects(buildManifestOrderedBarcodeWorkbook([orderedManifest, orderedManifest], manifestRecords, manifestCatalog, finalQuantityRows), /쉽먼트번호.*중복/);
  await assert.rejects(buildManifestOrderedBarcodeWorkbook([orderedManifest], manifestRecords, manifestCatalog, [
    ...finalQuantityRows,
    { ...finalQuantityRows[0], skuId: "59999999", barcode: "R999999999999" },
  ]), /현재 선택 발주 원본에 없는 SKU/, "선택된 Shipment XLSX에 원발주 외 SKU가 섞이면 생성을 차단해야 합니다.");

  const selectorWorkbook = new ExcelJS.Workbook();
  const selectorSheet = selectorWorkbook.addWorksheet("상품목록");
  selectorSheet.addRow(["발주번호(PO ID)"]);
  selectorSheet.addRow([singleRecord.purchaseOrderNumber]);
  const selectorBuffer = Buffer.from(await selectorWorkbook.xlsx.writeBuffer() as unknown as ArrayBuffer);
  const selectorSource = { name: "쉽먼트생성_업로드파일_검증.xlsx", modifiedTime: "2026-09-05T00:00:00.000Z", buffer: selectorBuffer };
  assert.equal((await selectShipmentPrintWorkbook([selectorSource], [singleRecord.purchaseOrderNumber], {
    expectedWorkbookName: selectorSource.name,
    strictName: true,
  })).name, selectorSource.name, "바코드 전용 생성은 실제 선택된 파일명과 발주 집합이 모두 같은 XLSX만 사용해야 합니다.");
  await assert.rejects(selectShipmentPrintWorkbook([selectorSource, { ...selectorSource, modifiedTime: "2026-09-04T00:00:00.000Z" }], [singleRecord.purchaseOrderNumber], {
    expectedWorkbookName: selectorSource.name,
    strictName: true,
  }), /같은 이름의 쉽먼트 XLSX가 2개/, "같은 이름의 원본이 여러 개면 임의 선택하지 않아야 합니다.");
  await assert.rejects(selectShipmentPrintWorkbook([selectorSource], ["140000000"], {
    expectedWorkbookName: selectorSource.name,
    strictName: true,
  }), /정확히 일치하지 않습니다/, "파일명이 같아도 발주 집합이 다르면 최종수량 원본으로 사용하면 안 됩니다.");

  console.log("WMS 고정 규칙 검증 통과: 브랜드 제거, 첫 쉼표 옵션 분리, 호수 보존, BarTender XLSX, 구분행, 전체 역순, 바코드 1장·다건 재출력, 동봉내역서 기준 단독/전체 출력 일치");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
