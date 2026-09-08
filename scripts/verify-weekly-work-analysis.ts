import assert from "node:assert/strict";
import { buildWeeklySnapshot, validateWeeklyPeriod, weeklyOperationalToken } from "../lib/wms/weekly-work-analysis";
import { mergeWeeklySourceDatasets, parseWeeklyBrowserSource, weeklyCarryPurchaseOrders } from "../lib/wms/weekly-work-source";
import { emptyWeeklyWorkspace } from "../lib/wms/weekly-work-state";
import { buildInboundEventFingerprint, parseInboundSourceRows, type InboundImportDataset, type InboundImportItem } from "../lib/wms/inbound-import-safety";
import { emptyPickingWaveStoreSnapshot } from "../lib/wms/picking-wave/shared-store-types";
import type { ProductCatalogItem } from "../lib/wms/product-catalog";
import type { VendorOrderDraftLine } from "../lib/wms/vendor-order/types";
import type { WeeklyBrowserSource } from "../lib/wms/weekly-work-types";

const period = { startDate: "2026-09-01", endDate: "2026-09-07" };
const event = (po: string, sku: string, at: string, amount: number, kind = "입고") => parseInboundSourceRows([
  { 발주번호: po, "SKU ID": sku, "입고/반출시각": at, 구분: kind, 수량: String(amount), SKU명: `상품 ${sku}`, 입고예정일: "2026-09-03" },
], "fixture.xlsx")[0];
const dataset = (items: InboundImportItem[], name = "fixture.xlsx"): InboundImportDataset => ({ sourceFile: name, fingerprint: "a".repeat(64), items });
const historyHeaders = ["데이터세트", "발주번호", "입고예정일", "SKU ID", "상품명", "입고수량", "반출", "순입고", "최근입고일", "이전공급가일", "이전공급가", "최근공급가일", "최근공급가", "반영일"];
const historyRow = (item: InboundImportItem) => [buildInboundEventFingerprint(item), item.po, item.expectedDate, item.sku, item.name, String(item.totalInbound), String(item.outbound), String(item.netInbound), item.actualAt, "", "0", item.latestSupplyDate, "0", "2026-09-07"];
const purchaseHeaders = ["발주번호", "SKU ID", "상품명", "입고예정일", "발주수량", "확정수량", "발주현황"];
const po = (number: string, sku: string, expected: string, confirmed: string, status = "발주확정") => [number, sku, `상품 ${sku}`, expected, "12", confirmed, status];
const product = (skuId: string): ProductCatalogItem => ({ skuId, modelSku: "", modelName: "MODEL", category: "", gender: "", productName: `상품 ${skuId}`, optionLabel: "", imageUrl: "https://example.com/item.png", warehouseNumber: "", boxNumber: "", currentStock: "50", currentStatus: "", costVatIncluded: "", vendorName: "거래처A", barcode: "R001", countryOfOrigin: "", productLink: "" });
const inbound1 = event("PO-A", "SKU-A", "2026-09-03 10:00:00", 4);
const inbound2 = event("PO-A", "SKU-A", "2026-09-07 10:00:00", 2);
const singleInbound = event("PO-ONE", "SKU-ONE", "2026-09-07 11:00:00", 1);
const earlier = event("PO-A", "SKU-A", "2026-08-31 10:00:00", 3);
const input = {
  period, datasets: [dataset([inbound1, inbound2, singleInbound, event("PO-OLD", "SKU-OLD", "2026-07-20 10:00:00", 9), event("PO-RETURN", "SKU-RETURN", "2026-09-04 10:00:00", 1, "반출")]), dataset([inbound1, inbound2], "overlap.xlsx")],
  historyRows: [historyHeaders, historyRow(earlier), historyRow(inbound1)],
  purchaseRows: [purchaseHeaders, po("PO-A", "SKU-A", "2026-09-03", "12"), po("PO-B", "SKU-B", "2026-09-05", "5"), po("PO-ZERO", "SKU-ZERO", "2026-09-05", "0"), po("PO-CANCEL", "SKU-CANCEL", "2026-09-05", "12", "발주취소"), po("PO-FUTURE", "SKU-FUTURE", "2026-09-20", "12"), po("PO-OLD", "SKU-OLD", "2026-07-20", "12"), po("PO-ONE", "SKU-ONE", "2026-09-07", "1")],
  catalogItems: [product("SKU-A"), product("SKU-B")], pickingStore: emptyPickingWaveStoreSnapshot(), mode: "upload" as const, now: "2026-09-07T12:00:00.000Z",
};
const original = JSON.stringify(input);
const result = buildWeeklySnapshot(input);
assert.deepEqual(result.couponItems.map(item => item.skuId), ["SKU-ONE"], "coupon SKU must total exactly one actual inbound in selected period");
assert.deepEqual(result.vendorItems.filter(item => item.shortageQuantity > 0).map(item => item.skuId), ["SKU-A"], "only positively received POs qualify, regardless of expected dates on untouched POs");
assert.ok(!result.vendorItems.some(item => item.skuId === "SKU-RETURN"), "return-only PO with no actual inbound evidence is not a shortage candidate");
assert.equal(result.vendorItems.find(item => item.skuId === "SKU-A")?.shortageQuantity, 3, "history + new events merge without overlap double counting");
assert.ok(!result.vendorItems.some(item => item.skuId === "SKU-B"), "fully unreceived PO is excluded even when confirmed and due within the period");
assert.equal(result.vendorItems.find(item => item.skuId === "SKU-A")?.confirmedQuantity, 12);
assert.equal(result.vendorItems.find(item => item.skuId === "SKU-A")?.receivedQuantity, 9);
assert.deepEqual(result.vendorItems.find(item => item.skuId === "SKU-A")?.shortageDetails, [
  { purchaseOrderNumber: "PO-A", confirmedQuantity: 12, receivedQuantity: 9, shortageQuantity: 3 },
], "exact PO detail uses cumulative receipts once, independently of rounded supplier order quantity");
assert.ok(!result.vendorItems.some(item => item.skuId === "SKU-ONE"), "fully received PO/SKU is excluded");
assert.equal(result.vendorItems.find(item => item.skuId === "SKU-A")?.suggestedQuantity, 12, "catalog stock is not deducted and proposed vendor quantity retains the 12-unit rule");
assert.equal(result.rulesVersion, 3, "snapshot declares confirmed-shortage-only business rules");
assert.equal(result.source.selectedEventCount, 4);
assert.equal(result.source.duplicateCount, 3);
assert.equal(JSON.stringify(input), original, "pure function preserves every input including operating store");
assert.equal(result.sourceToken, buildWeeklySnapshot({ ...input, now: "2026-09-08T00:00:00.000Z" }).sourceToken, "same data keeps stable source token across analysis times");
assert.equal(result.sourceToken, buildWeeklySnapshot({ ...input, datasets: [...input.datasets].reverse().map(item => ({ ...item, sourceFile: `redownload-${item.sourceFile}`, fingerprint: "b".repeat(64) })) }).sourceToken, "download descriptors and order do not create another weekly work id");
assert.equal(result.operationalToken, weeklyOperationalToken(input));
assert.notEqual(result.operationalToken, weeklyOperationalToken({ ...input, pickingStore: { ...input.pickingStore, revision: 2 } }), "post-analysis operational changes invalidate token");

const receiptScoped = buildWeeklySnapshot({ ...input, datasets: [dataset([inbound1])], historyRows: [historyHeaders],
  purchaseRows: [purchaseHeaders,
    po("PO-A", "SKU-A", "2026-09-30", "12"),
    po("PO-A", "SKU-NONE", "", "5"),
    po("PO-A", "SKU-ZERO", "", "0"),
    po("PO-A", "SKU-CANCEL", "", "12", "발주취소"),
    po("PO-TODAY", "SKU-TODAY", "2026-09-07", "12"),
    po("PO-YESTERDAY", "SKU-YESTERDAY", "2026-09-06", "12"),
  ], catalogItems: [product("SKU-A"), product("SKU-NONE")],
});
assert.deepEqual(receiptScoped.vendorItems.map(item => item.skuId).sort(), ["SKU-A", "SKU-NONE"], "one positive PO receipt admits its partially received and zero-receipt siblings only");
assert.equal(receiptScoped.vendorItems.find(item => item.skuId === "SKU-NONE")?.shortageQuantity, 5);
assert.equal(receiptScoped.vendorItems.find(item => item.skuId === "SKU-NONE")?.receivedQuantity, 0);
assert.deepEqual(receiptScoped.vendorItems.find(item => item.skuId === "SKU-NONE")?.shortageDetails, [
  { purchaseOrderNumber: "PO-A", confirmedQuantity: 5, receivedQuantity: 0, shortageQuantity: 5 },
], "zero-receipt SKU in a positively received PO retains its own original confirmed shortage");
assert.ok(receiptScoped.vendorItems.every(item => item.suggestedQuantity === 12 && !item.issues.some(issue => issue.includes("입고예정일"))), "actual receipt evidence overrides missing or future expected dates");
assert.ok(!receiptScoped.vendorItems.some(item => ["SKU-TODAY", "SKU-YESTERDAY"].includes(item.skuId)), "today/yesterday confirmed but unreceived shipments are not shortage candidates");
const allReceived = buildWeeklySnapshot({ ...input, datasets: [dataset([event("PO-FULL", "SKU-FULL", "2026-09-07 10:00:00", 12)])],
  historyRows: [historyHeaders], purchaseRows: [purchaseHeaders, po("PO-FULL", "SKU-FULL", "", "12")], catalogItems: [product("SKU-FULL")],
});
assert.equal(allReceived.vendorItems.length, 0, "fully received lines never become an order candidate from missing expected-date metadata");
const overreceived = buildWeeklySnapshot({ ...input, datasets: [dataset([event("PO-FULL", "SKU-FULL", "2026-09-07 10:00:00", 13)])],
  historyRows: [historyHeaders], purchaseRows: [purchaseHeaders, po("PO-FULL", "SKU-FULL", "", "12")], catalogItems: [product("SKU-FULL")],
});
assert.equal(overreceived.vendorItems.length, 0, "greater-than-confirmed receipt is never a shortage or automatic order");
assert.ok(overreceived.warnings.some(warning => warning.includes("확정수량보다 커")), "unexpected overreceipt remains a defensive source warning");
const multiPoInput = { ...input, datasets: [dataset([
  event("PO-M1", "SKU-M", "2026-09-03 10:00:00", 3),
  event("PO-M2", "SKU-M", "2026-09-04 10:00:00", 4),
  event("PO-MFULL", "SKU-M", "2026-09-04 10:00:00", 7),
  event("PO-MZERO", "SKU-M", "2026-09-04 10:00:00", 1),
  event("PO-MCANCEL", "SKU-M", "2026-09-04 10:00:00", 1),
])], historyRows: [historyHeaders], catalogItems: [product("SKU-M")], purchaseRows: [purchaseHeaders,
  po("PO-M2", "SKU-M", "", "10"), po("PO-M1", "SKU-M", "", "8"), po("PO-MFULL", "SKU-M", "", "7"),
  po("PO-MZERO", "SKU-M", "", "0"), po("PO-MCANCEL", "SKU-M", "", "12", "발주취소"),
] };
const multiPo = buildWeeklySnapshot(multiPoInput).vendorItems.find(item => item.skuId === "SKU-M")!;
assert.deepEqual(multiPo.shortageDetails, [
  { purchaseOrderNumber: "PO-M1", confirmedQuantity: 8, receivedQuantity: 3, shortageQuantity: 5 },
  { purchaseOrderNumber: "PO-M2", confirmedQuantity: 10, receivedQuantity: 4, shortageQuantity: 6 },
], "one SKU's separate underreceived POs keep exact quantities; full/zero/cancelled POs are excluded");
assert.equal(multiPo.shortageQuantity, 11);
assert.equal(multiPo.suggestedQuantity, 12, "exact reorder shortage is distinct from twelve-unit supplier order suggestion");
assert.deepEqual(multiPo.relatedPurchaseOrderNumbers, ["PO-M1", "PO-M2"]);
assert.equal(multiPo.shortageDetails!.reduce((sum, item) => sum + item.shortageQuantity, 0), multiPo.shortageQuantity);
assert.equal(multiPo.shortageDetails!.reduce((sum, item) => sum + item.confirmedQuantity, 0), multiPo.confirmedQuantity);
assert.equal(multiPo.shortageDetails!.reduce((sum, item) => sum + item.receivedQuantity, 0), multiPo.receivedQuantity);
const ambiguousMultiPo = buildWeeklySnapshot({ ...multiPoInput, purchaseRows: [...multiPoInput.purchaseRows, multiPoInput.purchaseRows[2]] });
assert.equal(ambiguousMultiPo.vendorItems.length, 0, "one ambiguous PO excludes the entire SKU rather than exposing a partial shortage");
assert.ok(ambiguousMultiPo.unresolvedItems?.some(item => item.skuId === "SKU-M" && item.issues.some(issue => issue.includes("중복"))));
const missingHistoryMultiPo = buildWeeklySnapshot({ ...multiPoInput, historyRows: [] });
assert.equal(missingHistoryMultiPo.vendorItems.length, 0, "unavailable cumulative history never appears in confirmed shortage work");
assert.ok(missingHistoryMultiPo.unresolvedItems?.some(item => item.skuId === "SKU-M"));
const carriedUnreceived = buildWeeklySnapshot({ ...input, carryPurchaseOrders: ["PO-B", "PO-FUTURE", "PO-RETURN"] });
assert.deepEqual(carriedUnreceived.vendorItems, result.vendorItems, "old hold/order reviews cannot resurrect entirely unreceived or return-only POs");
const historyCarryReceipt = event("PO-HISTORY", "SKU-HISTORY", "2026-08-20 10:00:00", 3);
const historyCarryInput = { ...input, historyRows: [historyHeaders, historyRow(historyCarryReceipt)],
  purchaseRows: [purchaseHeaders, po("PO-HISTORY", "SKU-HISTORY", "", "12")],
  carryPurchaseOrders: ["PO-HISTORY"], catalogItems: [product("SKU-HISTORY")],
};
assert.equal(buildWeeklySnapshot(historyCarryInput).vendorItems.find(item => item.skuId === "SKU-HISTORY")?.shortageQuantity, 9, "valid positive history proves actual receipt for explicitly unresolved old PO");
const invalidHistoryCarry = structuredClone(historyCarryInput); invalidHistoryCarry.historyRows[1][8] = "invalid-date";
assert.ok(!buildWeeklySnapshot(invalidHistoryCarry).vendorItems.some(item => item.skuId === "SKU-HISTORY"), "invalid history cannot prove a carried PO was actually received");
const returnHistoryCarry = structuredClone(historyCarryInput); returnHistoryCarry.historyRows = [historyHeaders, historyRow(event("PO-HISTORY", "SKU-HISTORY", "2026-08-20 10:00:00", 3, "반출"))];
assert.ok(!buildWeeklySnapshot(returnHistoryCarry).vendorItems.some(item => item.skuId === "SKU-HISTORY"), "return-only historical record cannot prove actual inbound");

const oneCouponEvent = event("PO-C1", "SKU-ONE", "2026-09-07 10:00:00", 1);
const couponCriteria = buildWeeklySnapshot({ ...input, datasets: [dataset([
  oneCouponEvent,
  event("PO-C2", "SKU-TWO", "2026-09-07 10:00:00", 2),
  event("PO-C3", "SKU-TWICE", "2026-09-03 10:00:00", 1),
  event("PO-C3", "SKU-TWICE", "2026-09-04 10:00:00", 1),
  event("PO-C4", "SKU-ACROSS", "2026-09-03 10:00:00", 1),
  event("PO-C5", "SKU-ACROSS", "2026-09-04 10:00:00", 1),
  event("PO-C6", "SKU-NETONE", "2026-09-03 10:00:00", 2),
  event("PO-C6", "SKU-NETONE", "2026-09-04 10:00:00", 1, "반출"),
  event("PO-C1", "SKU-ONE", "2026-08-31 10:00:00", 20),
]), dataset([oneCouponEvent], "same-receipt-redownload.xlsx")], historyRows: [historyHeaders], purchaseRows: [purchaseHeaders],
});
assert.deepEqual(couponCriteria.couponItems.map(item => item.skuId), ["SKU-ONE"], "coupon total is selected-period gross inbound per SKU across POs/events, never net of returns or all-time quantity");
assert.equal(couponCriteria.couponReceiptKeys?.["SKU-ONE"].length, 1, "overlapping receipt files do not turn one physical receipt into two coupon units");

const openStore = structuredClone(input.pickingStore);
openStore.vendorOrderDrafts.push({ id: "draft-a", waveId: "wave-a", vendorName: "거래처A", status: "sent", createdAt: input.now, updatedAt: input.now });
const line: VendorOrderDraftLine = { id: "line-a", draftId: "draft-a", waveId: "wave-a", vendorName: "거래처A", skuId: "SKU-A", modelName: "", category: "", optionLabel: "", productName: "상품 SKU-A", imageUrl: "", barcode: "", shortageQuantity: 5, receivedQuantity: 3, currentStock: "", relatedPurchaseOrderNumbers: ["PO-A"], memo: "", isManuallyAdded: false, createdAt: input.now, updatedAt: input.now };
openStore.vendorOrderLines.push(line, { ...line, id: "unrelated", shortageQuantity: 100, relatedPurchaseOrderNumbers: ["PO-OTHER"] });
const openResult = buildWeeklySnapshot({ ...input, pickingStore: openStore }).vendorItems.find(item => item.skuId === "SKU-A")!;
assert.equal(openResult.openOrderQuantity, 2, "only the linked remaining vendor order is deducted");
assert.equal(openResult.suggestedQuantity, 12, "subtract open order before rounding the remaining need to the supplier unit");
assert.ok(openResult.issues.some(issue => issue.includes("다른 발주")), "unrelated/manual order requires review, never silently reduces amount");

const legacyHistory = [historyHeaders, ["old-hash", "PO-A", "2026-09-03", "SKU-A", "상품 SKU-A", "4", "0", "4", "2026-09-03", "", "0", "", "0", ""]];
const legacy = buildWeeklySnapshot({ ...input, historyRows: legacyHistory });
assert.equal(legacy.vendorItems.find(item => item.skuId === "SKU-A")?.shortageQuantity, 6, "matching legacy daily total is not counted twice");
const conflictingLegacy = structuredClone(legacyHistory); conflictingLegacy[1][5] = "5";
const legacyConflict = buildWeeklySnapshot({ ...input, historyRows: conflictingLegacy });
assert.equal(legacyConflict.couponItems.length, 1, "reliable raw coupon does not depend on product/history repair");
assert.ok(!legacyConflict.vendorItems.some(item => item.skuId === "SKU-A"), "ambiguous legacy cumulative amount is excluded from shortage work");
assert.ok(legacyConflict.unresolvedItems?.some(item => item.skuId === "SKU-A" && item.issues.some(issue => issue.includes("수량이 달라"))));
const duplicatePo = buildWeeklySnapshot({ ...input, purchaseRows: [...input.purchaseRows, input.purchaseRows[1]] });
assert.ok(!duplicatePo.vendorItems.some(item => item.skuId === "SKU-A"));
assert.equal(duplicatePo.couponItems.length, 1);
const conflictingCancellation = buildWeeklySnapshot({ ...input, purchaseRows: [purchaseHeaders, po("PO-A", "SKU-A", "2026-09-03", "0", "발주취소"), input.purchaseRows[1]] });
assert.ok(!conflictingCancellation.vendorItems.some(item => item.skuId === "SKU-A"));
assert.ok(conflictingCancellation.unresolvedItems?.some(item => item.skuId === "SKU-A"), "duplicate cancellation conflict remains in source issues, outside shortage work");
const noPurchases = buildWeeklySnapshot({ ...input, purchaseRows: [purchaseHeaders] });
assert.equal(noPurchases.vendorItems.length, 0, "missing PO metadata is never classified as a shortage");
const missingSku = noPurchases.unresolvedItems?.find(item => item.skuId === "SKU-A")!;
assert.deepEqual(missingSku.relatedPurchaseOrderNumbers, ["PO-A"]);
assert.ok(missingSku.issues.some(issue => issue.includes("대응 발주이력")), "unmatched PO/SKU is recorded separately for source reconciliation");
assert.equal(noPurchases.couponItems.length, 1, "missing PO metadata does not block valid raw coupons");
const sourceHeaders = [...purchaseHeaders, "_주간원문검증오류", "_주간원문입고수량"];
const sourceCheck = buildWeeklySnapshot({ ...input,
  purchaseRows: [sourceHeaders, [...input.purchaseRows[1], "", "9"], ...input.purchaseRows.slice(2)] });
assert.equal(sourceCheck.vendorItems.find(item => item.skuId === "SKU-A")?.shortageQuantity, 3, "matching PO cumulative receipt corroborates existing detail events");
assert.deepEqual(sourceCheck.couponItems, result.couponItems, "PO receipt validation never changes actual-date coupon eligibility");
const sourceMismatch = buildWeeklySnapshot({ ...input,
  purchaseRows: [sourceHeaders, [...input.purchaseRows[1], "", "8"], ...input.purchaseRows.slice(2)] });
assert.ok(!sourceMismatch.vendorItems.some(item => item.skuId === "SKU-A"), "PO receipt mismatch is not displayed as shortage");
assert.ok(sourceMismatch.unresolvedItems?.some(item => item.skuId === "SKU-A" && item.issues.some(issue => issue.includes("발주서 입고수량 8개"))));
assert.notEqual(sourceCheck.operationalToken, sourceMismatch.operationalToken, "PO receipt corroboration changes operational freshness");
const sourceIssue = buildWeeklySnapshot({ ...input,
  purchaseRows: [sourceHeaders, [...input.purchaseRows[1], "최신 발주서와 확정수량이 다릅니다.", "9"], ...input.purchaseRows.slice(2)] });
assert.ok(!sourceIssue.vendorItems.some(item => item.skuId === "SKU-A"));
assert.ok(sourceIssue.unresolvedItems?.some(item => item.skuId === "SKU-A" && item.issues.some(issue => issue.includes("확정수량이 다릅니다"))));
const malformedSourceReceived = buildWeeklySnapshot({ ...input,
  purchaseRows: [sourceHeaders, [...input.purchaseRows[1], "", "invalid"], ...input.purchaseRows.slice(2)] });
assert.ok(!malformedSourceReceived.vendorItems.some(item => item.skuId === "SKU-A"));
const invalidConfirmed = buildWeeklySnapshot({ ...input,
  purchaseRows: [purchaseHeaders, po("PO-A", "SKU-A", "", "unknown"), ...input.purchaseRows.slice(2)] });
assert.ok(!invalidConfirmed.vendorItems.some(item => item.skuId === "SKU-A"), "invalid confirmed quantity cannot become a zero or guessed shortage");
assert.ok(invalidConfirmed.unresolvedItems?.some(item => item.skuId === "SKU-A" && item.issues.some(issue => issue.includes("확정수량"))));
const negativeCumulative = buildWeeklySnapshot({ ...input, historyRows: [historyHeaders],
  datasets: [dataset([inbound1, event("PO-A", "SKU-A", "2026-09-05 10:00:00", 5, "반출")])] });
assert.ok(!negativeCumulative.vendorItems.some(item => item.skuId === "SKU-A"));
assert.ok(negativeCumulative.unresolvedItems?.some(item => item.skuId === "SKU-A" && item.issues.some(issue => issue.includes("반출이 입고보다"))));
const mixedMissing = buildWeeklySnapshot({ ...multiPoInput, purchaseRows: multiPoInput.purchaseRows.filter(row => row[0] !== "PO-M1") });
assert.equal(mixedMissing.vendorItems.length, 0, "a valid shortage plus an unmatched PO must not expose a partial SKU total");
assert.deepEqual(mixedMissing.unresolvedItems?.find(item => item.skuId === "SKU-M")?.relatedPurchaseOrderNumbers, ["PO-M1", "PO-M2"]);
const mixedOverreceived = buildWeeklySnapshot({ ...multiPoInput,
  purchaseRows: multiPoInput.purchaseRows.map(row => row[0] === "PO-MFULL" ? po("PO-MFULL", "SKU-M", "", "6") : row) });
assert.equal(mixedOverreceived.vendorItems.length, 0, "unexpected overreceipt on one PO excludes another PO's partial shortage for the same SKU");
const unrelatedValid = buildWeeklySnapshot({ ...input, datasets: [dataset([inbound1, event("PO-UNKNOWN", "SKU-UNKNOWN", "2026-09-05 10:00:00", 1)])] });
assert.ok(unrelatedValid.vendorItems.some(item => item.skuId === "SKU-A"), "unrelated unmatched SKU does not suppress a verified shortage");
assert.ok(!unrelatedValid.vendorItems.some(item => item.skuId === "SKU-UNKNOWN"));
assert.ok(unrelatedValid.unresolvedItems?.some(item => item.skuId === "SKU-UNKNOWN"));
assert.ok(result.vendorItems[0].issues.some(issue => issue.includes("현재고")), "inventory confirmation remains a normal review of a verified shortage");
const missingReviewMetadata = buildWeeklySnapshot({ ...input, catalogItems: [] });
assert.equal(missingReviewMetadata.vendorItems.find(item => item.skuId === "SKU-A")?.shortageQuantity, 3, "missing photo/vendor fields do not make an exact receipt shortage uncertain");
assert.ok(missingReviewMetadata.vendorItems[0].issues.some(issue => issue.includes("거래처")));
assert.ok(missingReviewMetadata.vendorItems[0].issues.some(issue => issue.includes("사진")));
for (const checked of [result, receiptScoped, sourceCheck, unrelatedValid]) {
  assert.ok(checked.vendorItems.every(item => item.shortageQuantity > 0 && item.shortageDetails?.length
    && item.shortageDetails.reduce((sum, detail) => sum + detail.shortageQuantity, 0) === item.shortageQuantity), "every visible shortage has a complete positive per-PO breakdown");
}
const carried = buildWeeklySnapshot({ ...input, carryPurchaseOrders: ["PO-OLD", "PO-FUTURE"] });
assert.ok(carried.vendorItems.some(item => item.skuId === "SKU-OLD" && item.shortageQuantity === 3), "explicitly unfinished old PO is carried forward");
assert.ok(!carried.vendorItems.some(item => item.skuId === "SKU-FUTURE"), "saved carry without positive receipt proof never turns a PO into shortage work");
assert.deepEqual(carried.couponItems, result.couponItems, "carried vendor work never adds old receipts to weekly coupons");
assert.notEqual(carried.sourceToken, result.sourceToken, "carry selection is part of snapshot identity");
const workspace = emptyWeeklyWorkspace();
workspace.runs.push({ id: "previous", snapshot: carried, reviews: {
  "SKU-OLD": { skuId: "SKU-OLD", vendorName: "A", imageUrl: "", quantity: 12, decision: "hold", quantityConfirmed: false },
  "SKU-A": { skuId: "SKU-A", vendorName: "B", imageUrl: "", quantity: 12, decision: "order", quantityConfirmed: true },
  "SKU-B": { skuId: "SKU-B", vendorName: "C", imageUrl: "", quantity: 12, decision: "discontinue", quantityConfirmed: false },
}, revision: 0, updatedAt: input.now, sentVendors: { B: input.now } });
assert.deepEqual(weeklyCarryPurchaseOrders(workspace), ["PO-OLD"], "only hold or unsent reviews carry; sent/discontinued do not");
workspace.productOverrides["SKU-OLD"] = { vendorName: "A", imageUrl: "", discontinued: true };
assert.deepEqual(weeklyCarryPurchaseOrders(workspace), [], "saved discontinued SKU never carries forward");
const laterWorkspace = structuredClone(workspace);
laterWorkspace.productOverrides = {};
laterWorkspace.runs[0].updatedAt = "2026-09-30T00:00:00.000Z";
const laterRun = structuredClone(laterWorkspace.runs[0]);
laterRun.id = "newer-analysis"; laterRun.snapshot.createdAt = "2026-09-08T00:00:00.000Z"; laterRun.updatedAt = laterRun.snapshot.createdAt;
laterRun.reviews["SKU-OLD"].decision = "order"; laterRun.sentVendors.A = laterRun.updatedAt;
laterWorkspace.runs.push(laterRun);
assert.deepEqual(weeklyCarryPurchaseOrders(laterWorkspace), [], "newer sent decision resolves earlier hold even when old run was updated more recently");
assert.deepEqual(weeklyCarryPurchaseOrders({ ...laterWorkspace, runs: [...laterWorkspace.runs].reverse() }), [], "carry result does not depend on persisted array order");
laterRun.reviews["SKU-OLD"].decision = "discontinue";
assert.deepEqual(weeklyCarryPurchaseOrders(laterWorkspace), [], "newer discontinuation resolves an old hold without requiring a global override");
laterRun.reviews["SKU-OLD"].decision = "hold";
assert.deepEqual(weeklyCarryPurchaseOrders(laterWorkspace), ["PO-OLD"], "a newer explicitly unresolved decision remains eligible to carry");
const duplicateHistory = buildWeeklySnapshot({ ...input, historyRows: [...input.historyRows, historyRow(earlier)] });
assert.ok(!duplicateHistory.vendorItems.some(item => item.skuId === "SKU-A"), "duplicate history without matching fresh raw events is excluded");
const sourceConflict = buildWeeklySnapshot({ ...input, datasets: [...input.datasets, dataset([{ ...inbound1, totalInbound: 6, netInbound: 6 }], "conflict.xlsx")] });
assert.ok(sourceConflict.blockers.length > 0);
assert.equal(sourceConflict.vendorItems.length, 0, "conflicting raw source prevents every shortage classification");
assert.equal(sourceConflict.couponItems.length, 0, "conflicting raw event fails closed, no partial coupon list");
const duplicateSameFile = buildWeeklySnapshot({ ...input, datasets: [dataset([inbound1, inbound1])] });
assert.ok(duplicateSameFile.blockers.length > 0, "same-file identical event is ambiguous rather than silently removed");
assert.throws(() => validateWeeklyPeriod({ startDate: "2026-02-30", endDate: "2026-09-07" }));

const browser: WeeklyBrowserSource = { headers: ["발주번호", "SKU ID", "SKU명", "입고/반출일자", "구분", "수량"],
  rows: [["PO-A", "SKU-A", "상품 SKU-A", "2026-09-07 10:00:00", "입고", "1"]], coverageComplete: true, totalCount: 1,
  ...period, collectedAt: input.now, transferId: "fixture-browser" };
assert.equal(parseWeeklyBrowserSource(browser, period).items[0].actualDate, "2026-09-07", "browser actual receipt date alias");
assert.equal(parseWeeklyBrowserSource({ ...browser, headers: ["번호", ...browser.headers.slice(1)] }, period).items[0].po, "PO-A", "live browser PO header is 번호");
assert.throws(() => parseWeeklyBrowserSource({ ...browser, totalCount: 2 }, period), /전체 행/);
assert.throws(() => parseWeeklyBrowserSource({ ...browser, startDate: "2026-09-02" }, period), /전체 행/);
assert.throws(() => parseWeeklyBrowserSource({ ...browser, rows: [["PO-A", "SKU-A", "상품 SKU-A", "2026-08-31 10:00:00", "입고", "2"]] }, period), /기간 밖/);
assert.equal(parseWeeklyBrowserSource({ ...browser, rows: [], totalCount: 0 }, period).items.length, 0, "confirmed complete zero-row browser search is valid");
const emptyBrowserDataset = parseWeeklyBrowserSource({ ...browser, rows: [], totalCount: 0 }, period);
const zeroBrowserSnapshot = buildWeeklySnapshot({ ...input, datasets: mergeWeeklySourceDatasets(input.datasets, [emptyBrowserDataset], period), mode: "browser" });
assert.equal(zeroBrowserSnapshot.couponItems.length, 0, "authoritative empty browser period does not resurrect stale Drive coupons");
assert.equal(zeroBrowserSnapshot.source.selectedEventCount, 0);
const correctedBrowserDataset = parseWeeklyBrowserSource(browser, period);
const correctedBrowserSnapshot = buildWeeklySnapshot({ ...input, datasets: mergeWeeklySourceDatasets(input.datasets, [correctedBrowserDataset], period), mode: "browser" });
assert.equal(correctedBrowserSnapshot.source.selectedEventCount, 1, "browser full coverage replaces stale selected-period Drive rows");
assert.equal(correctedBrowserSnapshot.couponReceiptKeys?.["SKU-A"].length, 1, "coupon processing keys contain current browser events only");
assert.equal(mergeWeeklySourceDatasets(input.datasets, [correctedBrowserDataset]).flatMap(item => item.items).length, input.datasets.flatMap(item => item.items).length + 1, "partial file uploads supplement rather than replace historical raw data");
console.log("weekly-work-analysis: exact per-PO shortage/receipt-only PO scope/sibling shortage/one-unit coupon/carry/dedup/cumulative/zero/cancellation/open-order/ambiguity/browser/token checks passed; fixture-only, zero operating writes");
