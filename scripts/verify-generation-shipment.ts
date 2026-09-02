import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildAutoShipmentFile, inspectAutoShipmentTracking, inspectAutoShipmentTrackingRows, type ReprintDetailRow } from "../lib/wms/hanjin-shipment-auto";
import { summarizeFulfillmentCenterLabels } from "../lib/wms/fulfillment-center-label-summary";
import type { PurchaseOrderSourceRecord } from "../lib/wms/purchase-order-source/types";
import { buildShipmentOutputContext } from "../lib/wms/shipment-output-context";

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

console.log(JSON.stringify({ tenOfTen: allMatched, sixOfEight: partial, label: labels[0] }, null, 2));

async function verifyActualFiles() {
  const response = await fetch("https://noidb-os.vercel.app/api/wms/picking-waves");
  const data = await response.json() as { snapshot?: { waves?: Array<{ id: string; sourcePurchaseOrderNumbers?: string[]; outputGenerations?: Array<{ generationId: string; purchaseOrderNumbers: string[] }> }> } };
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
  const shipment = await buildAutoShipmentFile(generationRequests, generationContext.records);
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

if (process.argv.includes("--actual")) verifyActualFiles().catch(error => { console.error(error); process.exitCode = 1; });
