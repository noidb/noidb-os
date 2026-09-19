import assert from "node:assert/strict";
import JSZip from "jszip";
import { generateLogisticsFollowUp, logisticsFollowUpToken, queueMarketing } from "../lib/wms/logistics-follow-up";
import { reserveLogisticsReceiptRoute } from "../lib/wms/logistics-receipt-routing";
import { buildLogisticsReceiptBoard, type LogisticsAsideBaseline, type LogisticsReceiptTarget } from "../lib/wms/logistics-receipts";
import { emptyWeeklyWorkspace } from "../lib/wms/weekly-work-state";
import { resolveWeeklyAdvertising } from "../lib/wms/weekly-advertising";
import { buildWeeklyOutput } from "../lib/wms/weekly-work-output";

const at = new Date().toISOString();
const baseline: LogisticsAsideBaseline = { closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: [], excludedMarketingSkuIds: [], handledLines: [], source: "test" };
const targets: LogisticsReceiptTarget[] = ["99990001", "99990002"].map(shipmentNumber => ({ shipmentNumber, expectedDate: "2026-09-20", centerName: "테스트", purchaseOrderNumbers: ["111"], source: "dispatch" }));
const workspace = emptyWeeklyWorkspace();
workspace.logisticsReceipts = {
  source: "supplier-hub-shipments", schemaVersion: 2, collectedAt: at, requestedShipmentNumbers: targets.map(row => row.shipmentNumber),
  shipments: [
    { shipmentNumber: "99990001", status: "마감", totalDelivered: 1, totalReceived: 1, lines: [{ boxId: "M", purchaseOrderNumber: "111", skuId: "222", productName: "초도입고 검증", barcode: "MARKETING", deliveredQuantity: 1, receivedQuantity: 1 }] },
    { shipmentNumber: "99990002", status: "마감", totalDelivered: 2, totalReceived: 1, lines: [{ boxId: "D", purchaseOrderNumber: "111", skuId: "333", productName: "단종 검증", barcode: "DISCONTINUE", deliveredQuantity: 2, receivedQuantity: 1 }] },
  ],
};
const board = buildLogisticsReceiptBoard({ targets, snapshot: workspace.logisticsReceipts, baseline, routes: workspace.logisticsReceiptRoutes });
const marketing = board.lines.find(row => row.kind === "marketing");
const discontinue = board.lines.find(row => row.kind === "shortage");
assert(marketing && discontinue, "마케팅 후보와 마감 미납 행을 준비해야 합니다.");

queueMarketing(workspace, targets, board, { token: logisticsFollowUpToken(workspace, board), expectedCollectedAt: at, lineKeys: [marketing.lineKey], confirmMarketing: true }, at);
reserveLogisticsReceiptRoute(workspace, targets, { lineKey: discontinue.lineKey, decision: "discontinue", expectedCollectedAt: at }, baseline, at);
const currentBoard = buildLogisticsReceiptBoard({ targets, snapshot: workspace.logisticsReceipts, baseline, routes: workspace.logisticsReceiptRoutes });
const advertising = resolveWeeklyAdvertising(["222"], [["SKU ID", "옵션ID"], ["222", "9001"]]);

async function xlsxContains(zip: JSZip, fileName: string, value: string) {
  const file = zip.file(fileName);
  assert(file, `${fileName}이 ZIP에 있어야 합니다.`);
  const book = await JSZip.loadAsync(await file.async("nodebuffer"));
  const xml = await Promise.all(Object.values(book.files).filter(entry => /^(xl\/sharedStrings\.xml|xl\/worksheets\/.*\.xml)$/.test(entry.name)).map(entry => entry.async("string")));
  assert(xml.join("\n").includes(value), `${fileName}에 SKU ${value}가 있어야 합니다.`);
}

async function main() {
  const deps = { loadWeeklyAdvertisingSelection: async () => advertising, buildWeeklyOutput };
  const marketingOutput = await generateLogisticsFollowUp(workspace, currentBoard, { token: logisticsFollowUpToken(workspace, currentBoard), expectedCollectedAt: at, kind: "marketing" }, deps);
  const marketingZip = await JSZip.loadAsync(Buffer.from(marketingOutput.base64, "base64"));
  const marketingFiles = Object.keys(marketingZip.files).filter(name => !marketingZip.files[name].dir).sort();
  assert.equal(marketingOutput.proof.couponCount, 1);
  assert.equal(marketingOutput.proof.advertisingCount, 1);
  assert(marketingFiles.some(name => name.startsWith("쿠폰발행_30퍼센트_") && name.endsWith(".xlsx")), "쿠폰 일괄파일이 있어야 합니다.");
  assert(marketingFiles.some(name => /^3-\d+_광고등록\.xlsx$/.test(name)), "광고 일괄파일이 있어야 합니다.");
  await xlsxContains(marketingZip, marketingFiles.find(name => name.startsWith("쿠폰발행_30퍼센트_"))!, "222");
  await xlsxContains(marketingZip, marketingFiles.find(name => /^3-\d+_광고등록\.xlsx$/.test(name))!, "9001");

  const discontinueOutput = await generateLogisticsFollowUp(workspace, currentBoard, { token: logisticsFollowUpToken(workspace, currentBoard), expectedCollectedAt: at, kind: "discontinue" }, deps);
  const discontinueZip = await JSZip.loadAsync(Buffer.from(discontinueOutput.base64, "base64"));
  const discontinueFiles = Object.keys(discontinueZip.files).filter(name => !discontinueZip.files[name].dir).sort();
  assert.equal(discontinueOutput.proof.discontinueCount, 1);
  assert(discontinueFiles.some(name => /^단종신청\/단종_SKU_\d{8}\.xlsx$/.test(name)), "단종 SKU 엑셀이 있어야 합니다.");
  assert(discontinueFiles.some(name => /^단종신청\/단종요청_공문_\d{8}\.pdf$/.test(name)), "단종 요청 공문 PDF가 있어야 합니다.");
  await xlsxContains(discontinueZip, discontinueFiles.find(name => name.endsWith(".xlsx"))!, "333");
  console.log("PASS logistics follow-up real ZIPs: coupon, advertising, discontinue XLSX/PDF, and exact SKU contents (memory only)");
}

void main().catch(error => { throw error; });
