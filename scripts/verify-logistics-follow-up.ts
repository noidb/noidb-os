import assert from "node:assert/strict";
import { buildLogisticsReceiptBoard, logisticsReceiptLineKey, type LogisticsAsideBaseline, type LogisticsReceiptTarget } from "../lib/wms/logistics-receipts";
import { activeMarketingExclusionKeys, completeLogisticsFollowUp, generateLogisticsFollowUp, logisticsFollowUpResponse, logisticsFollowUpToken, queueMarketing, setMarketingExclusion } from "../lib/wms/logistics-follow-up";
import { reserveLogisticsReceiptRoute } from "../lib/wms/logistics-receipt-routing";
import { emptyWeeklyWorkspace, weeklyKoreaDay } from "../lib/wms/weekly-work-state";

const at = new Date(Date.now() - 60_000).toISOString();
const baseline: LogisticsAsideBaseline = { closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: [], excludedMarketingSkuIds: [], handledLines: [], source: "test" };
const targets: LogisticsReceiptTarget[] = ["99990001", "99990002"].map(shipmentNumber => ({ shipmentNumber, expectedDate: "2026-09-20", centerName: "테스트", purchaseOrderNumbers: ["111"], source: "dispatch" }));
function makeBoard(workspace: ReturnType<typeof emptyWeeklyWorkspace>, excluded = false) {
  return buildLogisticsReceiptBoard({ targets, snapshot: workspace.logisticsReceipts, baseline, routes: workspace.logisticsReceiptRoutes, excludedMarketingLineKeys: excluded ? [...activeMarketingExclusionKeys(workspace)] : [] });
}
const workspace = emptyWeeklyWorkspace();
workspace.logisticsReceipts = { source: "supplier-hub-shipments", schemaVersion: 3, collectedAt: at, requestedShipmentNumbers: targets.map(row => row.shipmentNumber), shipments: targets.map((target, index) => ({ shipmentNumber: target.shipmentNumber, status: "마감", totalDelivered: 1, totalReceived: 1, lines: [{ boxId: "B", purchaseOrderNumber: "111", skuId: String(222 + index), productName: `검증${index}`, barcode: `R${index}`, deliveredQuantity: 1, receivedQuantity: 1 }] })), skuStatuses: ["222", "223"].map(skuId => ({ skuId, orderStatus: "정상" as const })) };
let board = makeBoard(workspace);
const keys = board.lines.filter(row => row.kind === "marketing").map(row => row.lineKey);
assert.equal(keys.length, 2);
const token = logisticsFollowUpToken(workspace, board);
queueMarketing(workspace, targets, board, { token, expectedCollectedAt: at, lineKeys: [keys[0]], excludedLineKeys: [keys[1]], confirmMarketing: true }, at);
assert.equal(workspace.runs.length, 1, "bulk selection creates exactly one provenance run per source");
assert.deepEqual(workspace.runs[0].snapshot.couponReceiptKeys?.["222"], [keys[0]], "source run retains its exact receipt key for later coupon eligibility");
assert.equal(workspace.logisticsFollowUp?.exclusions?.length, 1, "unselected candidate persists as exact line exclusion");
board = makeBoard(workspace, true);
assert.equal(logisticsFollowUpResponse(workspace, board).queues.marketing.length, 1, "queued source remains available for the later combined-file action while exclusions stay hidden");
assert.throws(() => completeLogisticsFollowUp(workspace, board, { token: logisticsFollowUpToken(workspace, board), expectedCollectedAt: at, kind: "marketing", outputKey: "missing", confirmCoupon: true, confirmAdvertising: true, couponExpiresOn: "2026-12-31" }, at), /파일/);
const restoreToken = logisticsFollowUpToken(workspace, board);
setMarketingExclusion(workspace, board, { token: restoreToken, expectedCollectedAt: at, lineKeys: [keys[1]] }, true, at);
assert.equal(workspace.logisticsFollowUp?.exclusions?.[0].restoredAt, at, "history restoration is line-specific");
assert.throws(() => setMarketingExclusion(workspace, board, { token: restoreToken, expectedCollectedAt: at, lineKeys: [keys[0]] }, false, at), /목록이 변경/);
  void (async () => {
    const deps = {
      loadWeeklyAdvertisingSelection: async () => ({ resolved: [{ skuId: "222", optionId: "9001" }], missingSkuIds: [], conflictingSkuIds: [], optionIds: ["9001"], token: "mock-ad" }),
      buildWeeklyOutput: async () => ({ fileName: "mock.zip", base64: "bW9jaw==", generated: { at, reviewToken: "mock", couponCount: 1, vendors: [], discontinueCount: 0, advertisingCount: 1, advertisingFiles: ["3-1.xlsx"], advertisingToken: "mock-ad" } }),
    };
    const generated = await generateLogisticsFollowUp(workspace, makeBoard(workspace), { token: logisticsFollowUpToken(workspace, makeBoard(workspace)), expectedCollectedAt: at, kind: "marketing" }, deps);
    assert.equal(generated.proof.sourceKeys.length, 1, "mock generation preserves the exact queued source");
    workspace.logisticsFollowUp = { ...workspace.logisticsFollowUp, proofs: [generated.proof] };
    const discontinueFirst = structuredClone(workspace);
    const discontinueTargets = [...targets, { shipmentNumber: "99990003", expectedDate: "2026-09-20", centerName: "테스트", purchaseOrderNumbers: ["111"], source: "dispatch" as const }];
    discontinueFirst.logisticsReceipts!.requestedShipmentNumbers.push("99990003");
    discontinueFirst.logisticsReceipts!.shipments.push({ shipmentNumber: "99990003", status: "마감", totalDelivered: 2, totalReceived: 1, lines: [{ boxId: "DC", purchaseOrderNumber: "111", skuId: "222", productName: "단종 선처리", barcode: "DC", deliveredQuantity: 2, receivedQuantity: 1 }] });
    const discontinueBoard = buildLogisticsReceiptBoard({ targets: discontinueTargets, snapshot: discontinueFirst.logisticsReceipts, baseline, routes: discontinueFirst.logisticsReceiptRoutes });
    const discontinueLine = discontinueBoard.lines.find(row => row.kind === "shortage" && row.skuId === "222")!;
    reserveLogisticsReceiptRoute(discontinueFirst, discontinueTargets, { lineKey: discontinueLine.lineKey, decision: "discontinue", expectedCollectedAt: at }, baseline, at);
    const blockedBoard = buildLogisticsReceiptBoard({ targets: discontinueTargets, snapshot: discontinueFirst.logisticsReceipts, baseline, routes: discontinueFirst.logisticsReceiptRoutes });
    assert(activeMarketingExclusionKeys(discontinueFirst).has(keys[0]), "단종 선처리는 대기 중인 같은 SKU의 정확한 마케팅 출처만 제외합니다.");
    assert.throws(() => setMarketingExclusion(discontinueFirst, blockedBoard, { token: logisticsFollowUpToken(discontinueFirst, blockedBoard), expectedCollectedAt: at, lineKeys: [keys[0]] }, true, at), /단종 분류된 SKU/);
    const changed = structuredClone(workspace);
    changed.logisticsReceipts!.shipments[0].totalDelivered = 2;
    changed.logisticsReceipts!.shipments[0].lines[0].deliveredQuantity = 2;
    const changedBoard = makeBoard(changed);
    assert.throws(() => completeLogisticsFollowUp(changed, changedBoard, { token: logisticsFollowUpToken(changed, changedBoard), expectedCollectedAt: at, kind: "marketing", outputKey: generated.outputKey, confirmCoupon: true, confirmAdvertising: true, couponStartsOn: weeklyKoreaDay(), couponExpiresOn: weeklyKoreaDay(), validatedSavedProof: generated.proof }, at), /출처가 바뀌었습니다/);
    board = makeBoard(workspace);
    const addedKey = board.lines.find(row => row.kind === "marketing" && row.skuId === "223")!.lineKey;
    queueMarketing(workspace, targets, board, { token: logisticsFollowUpToken(workspace, board), expectedCollectedAt: at, lineKeys: [addedKey], confirmMarketing: true }, at);
    board = makeBoard(workspace);
    const completed = completeLogisticsFollowUp(workspace, board, { token: logisticsFollowUpToken(workspace, board), expectedCollectedAt: at, kind: "marketing", outputKey: generated.outputKey, confirmCoupon: true, confirmAdvertising: true, couponStartsOn: weeklyKoreaDay(), couponExpiresOn: weeklyKoreaDay(), validatedSavedProof: generated.proof }, at);
    assert.equal(completed.completedAt, at, "saved proof completes after both external confirmations");
    assert.equal(workspace.runs.find(run => run.logisticsReceiptLine?.skuId === "222")?.completedAt, at, "the generated source completes");
    assert.equal(workspace.runs.find(run => run.logisticsReceiptLine?.skuId === "223")?.completedAt, undefined, "a later queued SKU is not completed by an older file");
    assert.equal(completeLogisticsFollowUp(workspace, board, { token: logisticsFollowUpToken(workspace, board), expectedCollectedAt: at, kind: "marketing", outputKey: generated.outputKey, confirmCoupon: true, confirmAdvertising: true, couponStartsOn: weeklyKoreaDay(), couponExpiresOn: weeklyKoreaDay(), validatedSavedProof: generated.proof }, at), completed, "the same completed proof is retry-safe");
    workspace.logisticsReceipts!.shipments = workspace.logisticsReceipts!.shipments.filter(shipment => shipment.shipmentNumber !== "99990001");
    workspace.logisticsReceipts!.requestedShipmentNumbers = ["99990002"];
    workspace.logisticsReceipts!.skuStatuses = [{ skuId: "223", orderStatus: "정상" }];
    targets.splice(0, 1);
    board = makeBoard(workspace);
    const next = await generateLogisticsFollowUp(workspace, board, { token: logisticsFollowUpToken(workspace, board), expectedCollectedAt: at, kind: "marketing" }, deps);
    assert.deepEqual(next.proof.sourceKeys, [addedKey], "a missing completed source does not block the new queued SKU file");
    console.log("PASS logistics follow-up saved-proof completion/retry, source-change guard, later queue isolation, and missing completed source (memory only)");
  })().catch(error => { throw error; });
