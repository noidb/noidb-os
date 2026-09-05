import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  buildAutoShipmentFile,
  inspectAutoShipmentTracking,
  inspectAutoShipmentTrackingCandidate,
  inspectAutoShipmentTrackingRows,
  parseConfirmedQuantityRowsFromBuffer,
  resolveConfirmedQuantityRowsForShipment,
  resolveStoredAutoShipmentGeneration,
  type ConfirmedQuantitySourceFile,
  type ReprintDetailRow,
} from "../lib/wms/hanjin-shipment-auto";
import { buildShipmentCreationUploadFile, parseTrackingRowsFromBuffer } from "../lib/wms/hanjin-upload";
import { summarizeFulfillmentCenterLabels } from "../lib/wms/fulfillment-center-label-summary";
import type { PurchaseOrderSourceRecord } from "../lib/wms/purchase-order-source/types";
import { buildShipmentOutputContext } from "../lib/wms/shipment-output-context";
import type { PickingWaveStoreSnapshot } from "../lib/wms/picking-wave/shared-store-types";

const requests = Array.from({ length: 10 }, (_, index) => ({
  purchaseOrderNumber: String(1000 + index), fulfillmentCenter: "동탄1", expectedDate: "2026-09-04",
}));
const trackingRows: ReprintDetailRow[] = requests.map((request, index) => ({
  trackingNumber: `T${index}`, fulfillmentCenter: "동탄1", kLabel: `동탄1 / 9월4일 / 발주서 번호 ${request.purchaseOrderNumber}`,
}));
const allMatched = inspectAutoShipmentTrackingRows(requests, trackingRows);
assert.equal(allMatched.matchedPurchaseOrderCount, 10);
assert.equal(allMatched.requestedPurchaseOrderCount, 10);
assert.equal(allMatched.canGenerate, true);
const exactFile = inspectAutoShipmentTrackingCandidate(requests, "exact.xlsx", trackingRows);
assert.equal(exactFile.exactMatch, true);
assert.deepEqual(exactFile.unexpectedPurchaseOrderNumbers, []);

const mixedFile = inspectAutoShipmentTrackingCandidate(requests.slice(0, 8), "mixed.xlsx", trackingRows);
assert.equal(mixedFile.exactMatch, false);
assert.deepEqual(mixedFile.unexpectedPurchaseOrderNumbers, ["1008", "1009"]);

const partial = inspectAutoShipmentTrackingRows(requests.slice(0, 8), trackingRows.slice(0, 6));
assert.equal(partial.matchedPurchaseOrderCount, 6);
assert.deepEqual(partial.missingPurchaseOrderNumbers, ["1006", "1007"]);
assert.equal(partial.canGenerate, false);

const records = [
  { purchaseOrderNumber: "1000", fulfillmentCenterName: "동탄1", expectedArrivalDate: "2026-09-04", skuId: "SKU-1", orderedQuantity: 3 },
  { purchaseOrderNumber: "1001", fulfillmentCenterName: "동탄1", expectedArrivalDate: "2026-09-04", skuId: "SKU-1", orderedQuantity: 5 },
  { purchaseOrderNumber: "1001", fulfillmentCenterName: "동탄1", expectedArrivalDate: "2026-09-04", skuId: "SKU-2", orderedQuantity: 2 },
] as PurchaseOrderSourceRecord[];
const labels = summarizeFulfillmentCenterLabels(records);
assert.equal(labels.length, 1);
assert.deepEqual(labels[0].purchaseOrderNumbers, ["1000", "1001"]);
assert.equal(labels[0].totalSku, 2);
assert.equal(labels[0].totalQuantity, 10);

console.log(JSON.stringify({ tenOfTen: allMatched, exactFile, mixedFile, sixOfEight: partial, label: labels[0] }, null, 2));

async function verifyConfirmedQuantityPipeline() {
  const purchaseOrderNumber = "900000001";
  const sourceRecords: PurchaseOrderSourceRecord[] = [
    {
      purchaseOrderNumber, sourceContainerFile: "orders.zip", sourceEntryFile: "order.xlsx", sourceSheet: "상품목록", sourceRow: 2,
      fulfillmentCenterName: "동탄1", expectedArrivalDate: "2026-09-10", recipientName: "담당자", phone: "01000000000", postalCode: "12345", address: "주소",
      skuId: "SKU-CANCEL", barcode: "R-CANCEL", productName: "취소 상품", optionName: "옵션", orderedQuantity: 5,
    },
    {
      purchaseOrderNumber, sourceContainerFile: "orders.zip", sourceEntryFile: "order.xlsx", sourceSheet: "상품목록", sourceRow: 3,
      fulfillmentCenterName: "동탄1", expectedArrivalDate: "2026-09-10", recipientName: "담당자", phone: "01000000000", postalCode: "12345", address: "주소",
      skuId: "SKU-REDUCED", barcode: "R-REDUCED", productName: "감소 상품", optionName: "12개", orderedQuantity: 12,
    },
  ];
  const confirmedWorkbook = new ExcelJS.Workbook();
  const confirmedSheet = confirmedWorkbook.addWorksheet("상품목록");
  confirmedSheet.addRow(["발주번호", "물류센터", "입고유형", "상품번호", "상품바코드", "상품이름", "발주수량", "확정수량", "입고예정일"]);
  confirmedSheet.addRow([purchaseOrderNumber, "동탄1", "쉽먼트", "SKU-CANCEL", "R-CANCEL", "클라이언트 값은 출력에 사용하지 않음", 5, 0, "20260910"]);
  confirmedSheet.addRow([purchaseOrderNumber, "동탄1", "쉽먼트", "SKU-REDUCED", "R-REDUCED", "클라이언트 값은 출력에 사용하지 않음", 12, 4, "20260910"]);
  const parsedConfirmedRows = await parseConfirmedQuantityRowsFromBuffer(Buffer.from(await confirmedWorkbook.xlsx.writeBuffer() as unknown as ArrayBuffer));
  assert.ok(parsedConfirmedRows, "앱이 다시 저장한 PO_FOR_CONFIRM 파일을 ExcelJS로 읽어야 합니다.");

  const confirmedFileName = "PO_FOR_CONFIRM_선택발주_1건_fixture.xlsx";
  const files: ConfirmedQuantitySourceFile[] = [{ name: confirmedFileName, rows: parsedConfirmedRows }];
  const requests = [{ purchaseOrderNumber, fulfillmentCenter: "동탄1", expectedDate: "2026-09-10" }];
  const resolved = resolveConfirmedQuantityRowsForShipment(requests, sourceRecords, files, { [purchaseOrderNumber]: confirmedFileName });
  assert.deepEqual(resolved.rows.map(row => [row.skuId, row.confirmedQuantity, row.shippedQuantity]), [
    ["SKU-CANCEL", "0", "0"],
    ["SKU-REDUCED", "4", "4"],
  ], "취소 0개와 12개 중 4개 확정수량을 H/J에 그대로 전달해야 합니다.");
  assert.equal(resolved.rows[1].productName, "감소 상품, 12개", "상품명·옵션은 확정파일이 아니라 발주서 원본을 사용해야 합니다.");

  const templateBuffer = await readFile(path.join(process.cwd(), "public", "templates", "ShipmentsUpload_PARCEL_template.xlsx"));
  const shipment = await buildShipmentCreationUploadFile(
    resolved.rows.map(row => ({ ...row, trackingNumber: "TRACK-1" })),
    [{ purchaseOrderNumber, fulfillmentCenter: "동탄1" }],
    templateBuffer,
  );
  const shipmentRows = await parseTrackingRowsFromBuffer(shipment.buffer);
  assert.deepEqual(shipmentRows.map(row => [row.skuId, row.confirmedQuantity, row.shippedQuantity]), [
    ["SKU-CANCEL", "0", "0"],
    ["SKU-REDUCED", "4", "4"],
  ], "확정수량 매핑이 실제 Supplier Hub Shipment XLSX의 H/J열까지 유지되어야 합니다.");

  assert.throws(() => resolveConfirmedQuantityRowsForShipment(requests, sourceRecords, [], { [purchaseOrderNumber]: confirmedFileName }), /찾지 못했습니다/);
  assert.throws(() => resolveConfirmedQuantityRowsForShipment(requests, sourceRecords, files, { [purchaseOrderNumber]: "PO_FOR_CONFIRM_wrong.xlsx" }), /찾지 못했습니다/);
  assert.throws(() => resolveConfirmedQuantityRowsForShipment(requests, sourceRecords, [{ name: confirmedFileName, rows: parsedConfirmedRows.map(row => ({ ...row, purchaseOrderNumber: "900000002" })) }], { [purchaseOrderNumber]: confirmedFileName }), /상품번호.*없습니다/);
  assert.throws(() => resolveConfirmedQuantityRowsForShipment(requests, sourceRecords, [{ name: confirmedFileName, rows: parsedConfirmedRows.map(row => row.skuId === "SKU-REDUCED" ? { ...row, skuId: "SKU-WRONG" } : row) }], { [purchaseOrderNumber]: confirmedFileName }), /상품번호 SKU-REDUCED.*없습니다/);
  assert.throws(() => resolveConfirmedQuantityRowsForShipment(requests, sourceRecords, [{ name: confirmedFileName, rows: parsedConfirmedRows.map(row => row.skuId === "SKU-REDUCED" ? { ...row, confirmedQuantity: "13" } : row) }], { [purchaseOrderNumber]: confirmedFileName }), /0 이상 12 이하/);
  assert.throws(() => resolveConfirmedQuantityRowsForShipment(requests, sourceRecords, [files[0], { ...files[0] }], { [purchaseOrderNumber]: confirmedFileName }), /같은 이름.*2개/);

  const generation = {
    generationId: "generation-fixture", waveId: "WAVE-FIXTURE", purchaseOrderNumbers: [purchaseOrderNumber],
    createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z", expectedShippingGroupCount: 1,
    invoiceFileName: "invoice.xlsx", status: "invoice_generated" as const,
  };
  const confirmationRecord = {
    poNumber: purchaseOrderNumber, waveId: "WAVE-FIXTURE", stage: "document_generated" as const,
    sourceFileName: "PO_FOR_CONFIRM_source.xlsx", sourceFileHash: "hash", sourcePurchaseOrderCount: 1,
    sourceRowCount: 2, selectedRowCount: 2, generatedFileName: confirmedFileName, updatedAt: "2026-09-05T00:00:00.000Z",
  };
  const waveSnapshot = {
    waves: [{ id: "WAVE-FIXTURE", outputGenerations: [generation] }], shipments: [], poConfirmationRecords: [confirmationRecord],
  } as unknown as Pick<PickingWaveStoreSnapshot, "waves" | "shipments" | "poConfirmationRecords">;
  assert.deepEqual(resolveStoredAutoShipmentGeneration(waveSnapshot, "WAVE-FIXTURE", generation.generationId, [purchaseOrderNumber]).confirmedQuantityFileNameByPo, { [purchaseOrderNumber]: confirmedFileName });
  assert.throws(() => resolveStoredAutoShipmentGeneration(waveSnapshot, "WAVE-FIXTURE", generation.generationId, ["900000002"]), /정확히 일치하지 않습니다/);

  const shipmentSnapshot = {
    waves: [],
    shipments: [{ id: "SHP-FIXTURE", name: "Shipment", status: "invoice_generated", purchaseOrders: [], outputGeneration: { ...generation, waveId: "SHP-FIXTURE" }, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z" }],
    poConfirmationRecords: [confirmationRecord],
  } as unknown as Pick<PickingWaveStoreSnapshot, "waves" | "shipments" | "poConfirmationRecords">;
  assert.doesNotThrow(() => resolveStoredAutoShipmentGeneration(shipmentSnapshot, "SHP-FIXTURE", generation.generationId, [purchaseOrderNumber]), "기존 /wms/shipment 흐름도 같은 generation 검증을 통과해야 합니다.");

  const autoRoute = await readFile(path.join(process.cwd(), "app", "api", "wms", "shipment-print", "auto-source", "route.ts"), "utf8");
  assert.match(autoRoute, /loadShipmentPrintWorkbookSources\(expectedWorkbookName\)/);
  assert.match(autoRoute, /expectedWorkbookName, strictName: true/);
  const sequenceSource = await readFile(path.join(process.cwd(), "app", "wms", "picking", "waves", "[waveId]", "complete", "HanjinStepSequence.tsx"), "utf8");
  assert.match(sequenceSource, /searchParams\.get\("generation"\)/);
  assert.match(sequenceSource, /return requested\?\.generationId \|\| null/, "없는 generation 딥링크는 다른 묶음을 임의 선택하면 안 됩니다.");
  assert.match(sequenceSource, /requestedGenerationMissing[\s\S]*연결된 Shipment 묶음을 찾지 못했습니다/, "없는 generation 딥링크는 화면에 차단 사유를 보여야 합니다.");
  for (const anchor of ["hanjin-step-1", "hanjin-step-3", "shipment-output-set"]) assert.match(sequenceSource, new RegExp(`id="${anchor}"`));
  const completePageSource = await readFile(path.join(process.cwd(), "app", "wms", "picking", "waves", "[waveId]", "complete", "page.tsx"), "utf8");
  assert.match(completePageSource, /id="po-confirm"/);
  const autoShipmentClient = await readFile(path.join(process.cwd(), "app", "wms", "picking", "waves", "[waveId]", "complete", "HanjinAutoShipmentSection.tsx"), "utf8");
  assert.match(autoShipmentClient, /waveId: generation\.waveId/);
  assert.match(autoShipmentClient, /generationId: generation\.generationId/);
  assert.match(autoShipmentClient, /X-NOIDB-Drive-File-Name/);
  const poConfirmClient = await readFile(path.join(process.cwd(), "app", "wms", "picking", "waves", "[waveId]", "complete", "GenerateAllPoConfirmButton.tsx"), "utf8");
  assert.match(poConfirmClient, /generatedFileName: driveSaved && driveFileName \? driveFileName : fileName/, "공용 상태에는 실제 Drive 저장 파일명을 연결해야 합니다.");
}

async function verifyActualFiles() {
  const response = await fetch("https://noidb-os.vercel.app/api/wms/picking-waves");
  const data = await response.json() as { snapshot?: PickingWaveStoreSnapshot };
  const wave = data.snapshot?.waves?.find(item => item.id === "WAVE-20260902-926d76fa");
  assert.ok(wave?.sourcePurchaseOrderNumbers?.length, "실제 검증 웨이브를 찾지 못했습니다.");
  const context = await buildShipmentOutputContext(wave.sourcePurchaseOrderNumbers, { requireDestination: false });
  const actualRequests = context.documents.map(document => ({ purchaseOrderNumber: document.purchaseOrderNumber, fulfillmentCenter: document.fulfillmentCenterName, expectedDate: document.expectedArrivalDate }));
  const actual = await inspectAutoShipmentTracking(actualRequests);
  console.log(JSON.stringify({ actualWave: wave.id, ...actual }, null, 2));

  const generation = wave.outputGenerations?.find(item => item.purchaseOrderNumbers.length === 5);
  assert.ok(generation, "실파일 5/5 검증 generation을 찾지 못했습니다.");
  const generationContext = await buildShipmentOutputContext(generation.purchaseOrderNumbers, { requireDestination: false });
  const generationRequests = generationContext.documents.map(document => ({ purchaseOrderNumber: document.purchaseOrderNumber, fulfillmentCenter: document.fulfillmentCenterName, expectedDate: document.expectedArrivalDate }));
  const generationPreview = await inspectAutoShipmentTracking(generationRequests);
  assert.equal(generationPreview.matchedPurchaseOrderCount, generation.purchaseOrderNumbers.length);
  assert.equal(generationPreview.canGenerate, true);
  const templateBuffer = await readFile(path.join(process.cwd(), "public", "templates", "ShipmentsUpload_PARCEL_template.xlsx"));
  const storedGeneration = resolveStoredAutoShipmentGeneration(data.snapshot!, wave.id, generation.generationId, generation.purchaseOrderNumbers);
  const shipment = await buildAutoShipmentFile(generationRequests, generationContext.records, templateBuffer, {
    confirmedQuantityFileNameByPo: storedGeneration.confirmedQuantityFileNameByPo,
  });
  assert.deepEqual(shipment.includedPurchaseOrderNumbers, [...generation.purchaseOrderNumbers].sort());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(shipment.buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet("상품목록") || workbook.worksheets[0];
  assert.ok(sheet, "Shipment 상품목록 시트를 찾지 못했습니다.");
  const header = sheet.getRow(1).values as unknown[];
  const poColumn = header.findIndex(value => String(value ?? "").trim().startsWith("발주번호"));
  if (poColumn <= 0) console.log(JSON.stringify({ shipmentSheet: sheet.name, headers: header.map(value => String(value ?? "")) }, null, 2));
  assert.ok(poColumn > 0, "Shipment 발주번호 열을 찾지 못했습니다.");
  const outputPoNumbers = new Set<string>();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const po = String(sheet.getCell(rowNumber, poColumn).value ?? "").trim();
    if (po) outputPoNumbers.add(po);
  }
  assert.deepEqual([...outputPoNumbers].sort(), [...generation.purchaseOrderNumbers].sort());
  console.log(JSON.stringify({ actualGeneration: generation.generationId, poNumbers: generation.purchaseOrderNumbers, tracking: generationPreview, shipmentRows: shipment.includedCount, outputPoNumbers: [...outputPoNumbers].sort() }, null, 2));
}

verifyConfirmedQuantityPipeline()
  .then(() => process.argv.includes("--actual") ? verifyActualFiles() : undefined)
  .then(() => console.log("Shipment 확정수량 검증 통과: 저장 generation·정확한 확정파일·PO/SKU/원수량 대조, 0개 취소와 감소수량 H/J 유지"))
  .catch(error => { console.error(error); process.exitCode = 1; });
