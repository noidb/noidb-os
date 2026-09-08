import { applyPickingWaveStoreMutation } from "../lib/wms/picking-wave/server-store";
import { emptyPickingWaveStoreSnapshot } from "../lib/wms/picking-wave/shared-store-types";
import assert from "node:assert/strict";
import { resolveVendorOrderCatalog } from "../lib/wms/vendor-order/resolve-catalog";
import { resolveDisplayNameAndOption } from "../lib/wms/display-name";
import { buildKakaoOrderText } from "../lib/wms/vendor-order/export-text";
import { renderVendorOrderImage } from "../lib/wms/vendor-order/render-order-image";
import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraft, type VendorOrderDraftLine } from "../lib/wms/vendor-order/types";

async function main() {
  const now = "2026-09-08T12:00:00.000Z", waveId = "VENDOR-QUEUE-TEST";
  const baseName = "써지컬스틸 하프 큐빅라인 여성 반지";
  const catalog = ["로즈골드", "실버"].flatMap((color, group) => [9, 11, 14, 17, 20].map((size, index) => ({ skuId: String(78490103 + group * 5 + index), vendorName: "창성", productName: `${baseName}, ${color}, ${size}호`, optionLabel: color, imageUrl: `https://example.com/${78490103 + group * 5 + index}.jpg` })));
  for (const [skuId, option] of [["39129599", "실버 9호(한국사이즈 20호) 랜덤발송(패키지)"], ["39129600", "실버 6호(한국사이즈 11호) 랜덤발송(패키지)"], ["39129601", "로즈골드 5호(한국사이즈 9호) 랜덤발송(패키지)"]]) catalog.push({ skuId, vendorName: "창성", productName: `${baseName}, ${option}`, optionLabel: "", imageUrl: "" });
  const source: VendorOrderDraft = { id: `${waveId}::${UNASSIGNED_VENDOR_NAME}`, waveId, vendorName: UNASSIGNED_VENDOR_NAME, status: "draft", createdAt: "old", updatedAt: "old" };
  const lines: VendorOrderDraftLine[] = catalog.map((item, index) => ({ id: `${waveId}::${item.skuId}`, draftId: source.id, waveId, vendorName: UNASSIGNED_VENDOR_NAME, skuId: item.skuId, modelName: "wr011699", category: "반지", productName: item.productName, optionLabel: index < 10 ? item.productName.split(",").at(-1)!.trim() : "", imageUrl: "", barcode: "", shortageQuantity: 24 + index, actualShortageQuantity: 3, currentStock: "0", relatedPurchaseOrderNumbers: ["123"], memo: `사용자 메모 ${index}`, isManuallyAdded: index === 2, createdAt: "old", updatedAt: "old" }));
  const original = JSON.stringify({ lines, source, catalog });
  const result = resolveVendorOrderCatalog({ lines, drafts: [source], catalogItems: [...catalog, ...catalog], now });
  assert.equal(result.changes.length, 13);assert.equal(result.drafts.length, 2);
  assert.equal(JSON.stringify({ lines, source, catalog }), original, "source input must remain immutable");
  const text = buildKakaoOrderText("창성", result.lines, waveId);
  for (const [index, line] of result.lines.entries()) {
    const expected = catalog[index].productName.split(",").slice(1).map(value => value.trim()).join(", ");
    assert.equal(line.vendorName, "창성");assert.equal(line.draftId, `${waveId}::창성`);assert.equal(line.id, lines[index].id);
    assert.equal(line.optionLabel, expected);assert.equal(resolveDisplayNameAndOption(line.productName, line.optionLabel).option, expected);
    assert.equal(line.imageUrl, catalog[index].imageUrl);assert.equal(line.shortageQuantity, lines[index].shortageQuantity);assert.equal(line.memo, lines[index].memo);
    assert(text.includes(`SKU ${line.skuId} · ${expected} ×`));
  }
  assert.equal(result.lines.find(line => line.skuId === "78490105")!.optionLabel, "로즈골드, 14호");
  assert.equal(result.lines.find(line => line.skuId === "78490107")!.optionLabel, "로즈골드, 20호");
  assert.equal(resolveVendorOrderCatalog({ ...result, catalogItems: catalog, now: "later" }).changes.length, 0, "repeat resolution is stable");
  const edited = { ...lines[0], vendorName: "직접 지정", imageUrl: "https://example.com/manual.jpg", optionLabel: "직접 지정 옵션", shortageQuantity: 77, memo: "수정된 메모" };
  assert.deepEqual(resolveVendorOrderCatalog({ lines: [edited], drafts: [source], catalogItems: catalog, now }).lines[0], edited);
  assert.deepEqual(resolveVendorOrderCatalog({ lines, drafts: [{ ...source, status: "sent" }], catalogItems: catalog, now }).lines, lines);
  const approvedSource: VendorOrderDraft = { ...source, status: "approved", approvedAt: "original-approval" };
  const approvedTarget: VendorOrderDraft = { ...source, id: waveId + "::창성", vendorName: "창성", status: "approved", approvedAt: "target-approval" };
  const untouchedApproved: VendorOrderDraft = { ...source, id: waveId + "::다른 거래처", vendorName: "다른 거래처", status: "approved", approvedAt: "keep-approval" };
  const approvedInputBefore = JSON.stringify({ lines, approvedSource, approvedTarget, untouchedApproved });
  const approvedFill = resolveVendorOrderCatalog({ lines, drafts: [approvedSource, approvedTarget, untouchedApproved], catalogItems: catalog, now });
  assert.equal(approvedFill.changes.length, 13, "approval must not leave missing vendor, color or image unresolved");
  assert.deepEqual(approvedFill.lines, result.lines);
  for (const draft of [approvedSource, approvedTarget]) {
    const changed = approvedFill.drafts.find(item => item.id === draft.id)!;
    assert.equal(changed.status, "resend_needed"); assert.equal(changed.approvedAt, draft.approvedAt); assert.equal(changed.updatedAt, now);
  }
  assert.deepEqual(approvedFill.drafts.find(item => item.id === untouchedApproved.id), untouchedApproved);
  assert.equal(JSON.stringify({ lines, approvedSource, approvedTarget, untouchedApproved }), approvedInputBefore);
  const completeApproved = resolveVendorOrderCatalog({ lines: result.lines, drafts: [approvedTarget], catalogItems: catalog, now: "later" });
  assert.equal(completeApproved.changes.length, 0); assert.deepEqual(completeApproved.drafts, [approvedTarget]);
  assert.deepEqual(resolveVendorOrderCatalog({ lines: [edited], drafts: [approvedSource], catalogItems: catalog, now }).lines[0], edited);
  assert.deepEqual(resolveVendorOrderCatalog({ lines: [edited], drafts: [approvedSource], catalogItems: catalog, now }).drafts, [approvedSource]);
  const approvedReceived = resolveVendorOrderCatalog({ lines: [{ ...lines[0], receivedQuantity: 1 }], drafts: [approvedSource], catalogItems: catalog, now });
  assert.equal(approvedReceived.changes.length, 0); assert.deepEqual(approvedReceived.drafts, [approvedSource]);
  const imageOnly = { ...result.lines[0], imageUrl: "" };
  const approvedImageFill = resolveVendorOrderCatalog({ lines: [imageOnly], drafts: [approvedTarget], catalogItems: catalog, now });
  assert.deepEqual(approvedImageFill.changes[0].fields, ["imageUrl"]); assert.equal(approvedImageFill.drafts[0].status, "resend_needed");
  assert.equal(approvedImageFill.drafts[0].approvedAt, approvedTarget.approvedAt);
  const received = { ...lines[0], receivedQuantity: 1 };
  assert.deepEqual(resolveVendorOrderCatalog({ lines: [received], drafts: [source], catalogItems: catalog, now }).lines[0], received);
  assert.equal(resolveVendorOrderCatalog({ lines, drafts: [source], catalogItems: [{ ...catalog[0], skuId: "99999999" }], now }).changes.length, 0, "same name is never an identity match");
  assert.equal(resolveVendorOrderCatalog({ lines: [lines[0]], drafts: [source], catalogItems: [catalog[0], { ...catalog[0], vendorName: "상충 거래처" }, catalog[0]], now }).changes.length, 0, "conflicting exact SKU blocks hydration");
  const duplicate = { ...lines[0], id: "other-line", vendorName: "창성", draftId: `${waveId}::창성` };
  assert.equal(resolveVendorOrderCatalog({ lines: [lines[0], duplicate], drafts: [source], catalogItems: catalog, now }).lines[0].vendorName, UNASSIGNED_VENDOR_NAME);
  const targetSent: VendorOrderDraft = { ...source, id: `${waveId}::창성`, vendorName: "창성", status: "sent" };
  assert.equal(resolveVendorOrderCatalog({ lines: [lines[0]], drafts: [source, targetSent], catalogItems: catalog, now }).lines[0].vendorName, UNASSIGNED_VENDOR_NAME);
  const store = emptyPickingWaveStoreSnapshot();
  store.vendorOrderDrafts = [source]; store.vendorOrderLines = lines; store.activeVendorQueueId = waveId;
  const deletedTargetId = waveId + "::창성";
  const deletedTargetStore = structuredClone(store);
  deletedTargetStore.deletedVendorDraftIds[deletedTargetId] = now;
  const afterDeletedTarget = applyPickingWaveStoreMutation(deletedTargetStore, { action: "consolidateVendorOrders", operationId: "CATALOG-DELETED-TARGET", lines: [], now }, undefined, catalog);
  const versionTarget = afterDeletedTarget.vendorOrderLines[0].draftId;
  assert.notEqual(versionTarget, deletedTargetId, "catalog hydration must never reuse a deleted vendor draft");
  assert(versionTarget.startsWith(deletedTargetId + "::new-catalog-"));
  assert.equal(afterDeletedTarget.deletedVendorDraftIds[deletedTargetId], now);
  assert(afterDeletedTarget.vendorOrderLines.every(line => line.draftId === versionTarget && line.vendorName === "창성"));
  assert.doesNotThrow(() => applyPickingWaveStoreMutation(afterDeletedTarget, { action: "saveVendorLine", line: afterDeletedTarget.vendorOrderLines[0], expectedUpdatedAt: afterDeletedTarget.vendorOrderLines[0].updatedAt }));
  const reconsolidated = applyPickingWaveStoreMutation(afterDeletedTarget, { action: "consolidateVendorOrders", operationId: "CATALOG-DELETED-TARGET-RETRY", lines: [], now }, undefined, catalog);
  assert.equal(reconsolidated.vendorOrderLines.length, 13);
  assert(reconsolidated.vendorOrderLines.every(line => line.draftId === versionTarget));
  const storedBefore = JSON.stringify(store);
  const mutation = { action: "consolidateVendorOrders" as const, operationId: "CATALOG-TEST", lines: [], now };
  const consolidated = applyPickingWaveStoreMutation(store, mutation, undefined, catalog);
  assert.equal(consolidated.activeVendorQueueId, waveId);
  for (const hydrated of consolidated.vendorOrderLines) {
    const resolved = result.lines.find(line => line.id === hydrated.id)!;
    assert.equal(hydrated.vendorName, resolved.vendorName); assert.equal(hydrated.imageUrl, resolved.imageUrl); assert.equal(hydrated.optionLabel, resolved.optionLabel);
    assert.equal(hydrated.draftId, resolved.draftId); assert.equal(hydrated.memo, resolved.memo); assert.equal(hydrated.shortageQuantity, resolved.shortageQuantity);
  }
  assert.equal(JSON.stringify(store), storedBefore);
  assert.deepEqual(consolidated.vendorQueueReceipts!["CATALOG-TEST"].sourceLines, lines, "source receipts retain missing values as historical evidence");
  assert.equal(applyPickingWaveStoreMutation(consolidated, mutation, undefined, catalog), consolidated, "retry must not rewrite a committed operation");
  const noCatalog = applyPickingWaveStoreMutation(store, mutation, undefined, []);
  assert.equal(noCatalog.vendorOrderLines[0].vendorName, UNASSIGNED_VENDOR_NAME);
  // Inspect the actual Canvas renderer's text calls without loading images or contacting any service.
  const drawn: string[] = [];
  const context = new Proxy({ measureText: (value: string) => ({ width: value.length * 10 }), fillText: (value: string) => drawn.push(value) }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => undefined });
  const priorDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ getContext: () => context, toBlob: (done: (blob: Blob) => void) => done(new Blob(["fixture"])) }) } });
  try {
    assert(await renderVendorOrderImage("창성", result.lines.map(line => ({ ...line, imageUrl: "" })), waveId));
    for (const line of result.lines) assert(drawn.includes(line.optionLabel), `image output must preserve ${line.skuId} color and size`);
  } finally { Object.defineProperty(globalThis, "document", { configurable: true, value: priorDocument }); }
  console.log("PASS vendor catalog resolution: all 13 exact model SKUs, preserved edits/history/IDs, missing fields on unsent approvals require review, unchanged approvals preserved, no guessed images, 78490105/107 color+size, UI/text/Canvas option parity, duplicate/catalog conflict safety.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
