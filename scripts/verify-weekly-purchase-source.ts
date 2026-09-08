import assert from "node:assert/strict";
import { mergeWeeklyPurchaseRows, weeklyOperationsWithPurchaseFiles, weeklyPurchaseManifestToken } from "../lib/wms/weekly-purchase-source";
import type { OAuthDriveFileInfo } from "../lib/wms/google-drive-oauth-reader";
import type { WeeklyPurchaseResolution, WeeklyPurchaseRow } from "../lib/wms/weekly-purchase-files";

const headers = ["발주번호", "SKU ID", "상품명", "발주수량", "확정수량", "발주현황", "기존추가정보"];
const sourceRow = (po: string, sku: string, confirmed: number | null, received: number | null, ordered = 12): WeeklyPurchaseRow => ({
  purchaseOrderNumber: po, skuId: sku, orderedQuantity: ordered, confirmedQuantity: confirmed, receivedQuantity: received,
  productName: `원문 상품 ${sku}`, optionName: "실버, one size", sourceContainerFile: "발주서리스트_최신.zip",
  sourceEntryFile: `PO_${po}.xlsx`, sourceSheet: "Sheet1", sourceRow: 22, sourceModifiedTime: "2026-09-08T01:00:00.000Z", sourceId: "latest-source",
});
const resolution = (rows: WeeklyPurchaseRow[], errors: WeeklyPurchaseResolution["errors"] = []): WeeklyPurchaseResolution => ({
  resolvedRows: rows, errors, sourceFiles: [{ name: "발주서리스트_최신.zip", modifiedTime: "2026-09-08T01:00:00.000Z", id: "latest-source" }],
});
const records = (rows: string[][]) => rows.slice(1).map(row => Object.fromEntries(rows[0].map((header, index) => [header, row[index]])));
const file = (id: string): OAuthDriveFileInfo => ({ id, name: `${id}.zip`, mimeType: "application/zip", modifiedTime: "2026-09-08T01:00:00.000Z", size: "5000" });

const history = [headers,
  ["140245699", "39136021", "기존 상품 이름", "12", "1", "발주확정", "보존할 메모"],
  ["140245699", "39323459", "기존 확정 0", "12", "0", "발주확정", "0도 보존"],
  ["140246781", "41074430", "관련 없는 발주", "6", "6", "발주확정", "기존 정보"],
];
const inputSource = resolution([
  sourceRow("140245699", "39136021", 1, 1), sourceRow("140245699", "39323459", 0, 0),
  sourceRow("140245699", "50138268", 5, 0), sourceRow("140245699", "50138269", 0, 0),
  sourceRow("140246833", "76343191", 3, 1), sourceRow("140246833", "76343193", 2, 0),
]);
const originalHistory = JSON.stringify(history), originalSource = JSON.stringify(inputSource);
const supplemented = mergeWeeklyPurchaseRows(history, inputSource);
assert.equal(supplemented.addedCount, 4);
assert.deepEqual(supplemented.rows[0].slice(0, headers.length), headers, "All original columns retain their order");
assert.deepEqual(supplemented.rows.slice(1, 4).map(row => row.slice(0, headers.length)), history.slice(1), "Supplementing sources does not replace any original ledger value");
assert.equal(JSON.stringify(history), originalHistory, "Never mutate the original operating history");
assert.equal(JSON.stringify(inputSource), originalSource, "Never mutate parsed source evidence");
const supplementedRecords = records(supplemented.rows);
const exact = (po: string, sku: string) => supplementedRecords.find(row => row["발주번호"] === po && row["SKU ID"] === sku)!;
assert.equal(exact("140245699", "39136021")["_주간원문입고수량"], "1");
assert.equal(exact("140245699", "39323459")["확정수량"], "0");
assert.equal(exact("140245699", "39323459")["_주간원문검증오류"], "", "Matching explicit zero is valid; never substitute ordered twelve");
assert.equal(exact("140245699", "50138268")["확정수량"], "5");
assert.equal(exact("140245699", "50138268")["_주간원문입고수량"], "0", "A zero-receipt sibling is still supplemented for its received PO");
assert.equal(exact("140245699", "50138269")["확정수량"], "0", "New source zero also stays zero");
assert.equal(exact("140246833", "76343193")["_주간원문입고수량"], "0", "A new PO includes its entire source SKU set, including zero-receipt siblings");
assert.equal(exact("140246833", "76343191")["상품명"], "원문 상품 76343191, 실버, one size");
assert.equal(exact("140246833", "76343191")["기존추가정보"], "");
assert.equal(exact("140246781", "41074430")["_주간원문검증오류"], "", "Missing source for an unrelated PO does not invalidate legacy data");
assert.ok(!supplemented.rows[0].includes("입고수량"), "Source I stays in its diagnostic column and does not manufacture ledger receipt events");
const repeated = mergeWeeklyPurchaseRows(supplemented.rows, inputSource);
assert.equal(repeated.addedCount, 0);
assert.deepEqual(repeated.rows, supplemented.rows, "Repeated read-only supplementation is stable");

const conflicting = records(mergeWeeklyPurchaseRows(history, resolution([
  sourceRow("140245699", "39136021", 2, 1), sourceRow("140245699", "39323459", 12, 0),
])).rows);
assert.equal(conflicting[0]["확정수량"], "1");
assert.equal(conflicting[1]["확정수량"], "0", "An explicit history zero must not be overwritten by a newer positive H");
assert.ok(conflicting[0]["_주간원문검증오류"].includes("확정수량이 달라"));
assert.ok(conflicting[1]["_주간원문검증오류"].includes("확정수량이 달라"));
const missingSku = records(mergeWeeklyPurchaseRows(history, resolution([sourceRow("140245699", "39136021", 1, 1)])).rows);
assert.ok(missingSku[1]["_주간원문검증오류"].includes("해당 SKU가 없어"), "A legacy SKU absent from the newest full source cannot silently use an older PO snapshot");
assert.equal(missingSku[2]["_주간원문검증오류"], "");

const latestFailure: WeeklyPurchaseResolution["errors"][number] = {
  code: "ITEM_INVALID", purchaseOrderNumber: "140245699", skuId: "39136021", sourceRow: 42,
  sourceFile: "발주서리스트_최신.zip", sourceEntryFile: "PO_140245699.xlsx", sourceModifiedTime: "2026-09-08T01:00:00.000Z",
  message: "H42: 업체납품가능수량이 비어 있어 확정수량을 확인할 수 없습니다.",
};
const damaged = records(mergeWeeklyPurchaseRows(history, resolution([], [latestFailure])).rows);
assert.ok(damaged[0]["_주간원문검증오류"].includes("H42"));
assert.ok(damaged[1]["_주간원문검증오류"].includes("H42"), "An incomplete newest document invalidates every candidate in its PO, not only the malformed SKU");
assert.equal(damaged[2]["_주간원문검증오류"], "");
assert.equal(damaged[0]["확정수량"], "1", "Latest parser errors carry forward without changing existing history");
const withEarlierIssue = [
  [...headers, "_주간원문검증오류"], [...history[1], "이전 검토 필요"],
];
assert.ok(records(mergeWeeklyPurchaseRows(withEarlierIssue, resolution([], [latestFailure])).rows)[0]["_주간원문검증오류"].includes("이전 검토 필요"));
const blankConfirmed = mergeWeeklyPurchaseRows([], resolution([sourceRow("140245699", "39136021", null, 0)]));
assert.equal(blankConfirmed.addedCount, 0);
assert.equal(blankConfirmed.rows.length, 1, "Unknown H never borrows ordered quantity to add a source row");
const nullReceived = records(mergeWeeklyPurchaseRows([], resolution([sourceRow("140245699", "39136021", 2, null)])).rows)[0];
assert.equal(nullReceived["_주간원문입고수량"], "", "Unknown diagnostic I remains unknown, distinct from explicit zero");
const legacyBlank = [["발주번호", "SKU ID", "발주수량", "확정수량"], ["140245699", "39136021", "12", ""]];
const legacyBlankResult = records(mergeWeeklyPurchaseRows(legacyBlank, resolution([sourceRow("140245699", "39136021", 12, 1)])).rows)[0];
assert.equal(legacyBlankResult["확정수량"], "", "The pre-existing blank confirmed field stays untouched");
assert.equal(legacyBlankResult["_주간원문검증오류"], "");
assert.throws(() => mergeWeeklyPurchaseRows([["발주번호", "SKU ID", "SKU ID"]], resolution([])), /중복된 열/);
assert.throws(() => mergeWeeklyPurchaseRows([["SKU ID"], ["39136021"]], resolution([])), /발주번호/);

const manifest = [file("a"), file("b")];
const manifestOriginal = JSON.stringify(manifest);
const token = weeklyPurchaseManifestToken(manifest);
assert.equal(token, weeklyPurchaseManifestToken([...manifest].reverse()), "Drive listing order is not a source revision");
assert.equal(JSON.stringify(manifest), manifestOriginal);
for (const change of [
  { id: "changed-id" }, { name: "renamed.zip" }, { modifiedTime: "2026-09-08T01:00:00.001Z" }, { size: "5001" },
]) assert.notEqual(token, weeklyPurchaseManifestToken([{ ...manifest[0], ...change }, manifest[1]]), `${Object.keys(change)[0]} changes must invalidate source freshness`);
assert.notEqual(token, weeklyPurchaseManifestToken(manifest.slice(0, 1)), "Removed sources invalidate analysis");
assert.notEqual(token, weeklyPurchaseManifestToken([...manifest, file("c")]), "New uploads invalidate analysis");
const combined = weeklyOperationsWithPurchaseFiles("operating-token", token);
assert.equal(combined, weeklyOperationsWithPurchaseFiles("operating-token", token));
assert.notEqual(combined, weeklyOperationsWithPurchaseFiles("changed-operating-token", token));
assert.notEqual(combined, weeklyOperationsWithPurchaseFiles("operating-token", "changed-file-token"));
console.log("PASS weekly purchase source: immutable ledger supplementation, explicit zero and all PO siblings, source conflicts and errors, unknown H/I, fresh file manifest and operating tokens");
