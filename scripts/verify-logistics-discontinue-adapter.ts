import assert from "node:assert/strict";
import { collectFollowUpDiscontinue, completeFollowUpDiscontinue, previewFollowUpDiscontinue } from "../lib/wms/logistics-discontinue-adapter";
import { emptyWeeklyWorkspace } from "../lib/wms/weekly-work-state";
import type { StatusRequestRecord } from "../lib/wms/vendor-order-actions";

const now = "2026-09-20T01:00:00.000Z";
const request = (id: string, skuId: string, po: string): StatusRequestRecord => ({ id, skuId, modelSku: "M", productName: skuId, optionLabel: "", currentStatus: "단종", requestType: "단종", requestedAt: now, supplyHubStatus: "처리대기", completedAt: "", requester: "테스트", processor: "", previousStatus: "정상", productLink: "", purchaseOrderNumber: po, sheetRow: 2 });
const requests = [request("status-1", "100", "PO-1"), request("status-2", "200", "PO-2")];
const source = { requests, catalogItems: [] };
void (async () => {
  const workspace = emptyWeeklyWorkspace();
  assert.deepEqual(previewFollowUpDiscontinue(source).map(row => row.requestId), ["status-1", "status-2"], "GET preview is source-only");
  const generated = collectFollowUpDiscontinue(workspace, source, now);
  assert.deepEqual(generated.requestIds, ["status-1", "status-2"]);
  requests.push(request("status-3", "300", "PO-3"));
  const completed = await completeFollowUpDiscontinue(workspace, generated, {
    completeStatusRequests: async ids => { for (const row of requests) if (ids.includes(row.id)) row.supplyHubStatus = "처리완료"; return ids.length; },
    listStatusRequests: async () => structuredClone(requests),
  }, now);
  assert.deepEqual(completed.discontinueSubmittedSkuIds, ["100", "200"], "only file proof SKUs complete");
  const later = collectFollowUpDiscontinue(workspace, source, now);
  assert.deepEqual(later.requestIds, ["status-3"], "later status request remains queued");
  const duplicate = emptyWeeklyWorkspace();
  duplicate.runs.push({ ...structuredClone(later.run), id: "OTHER", discontinueQueueRequestIds: { "300": ["status-3"] } });
  const shared = collectFollowUpDiscontinue(duplicate, source, now);
  assert.deepEqual(shared.requestIds, ["status-3"], "shared status ID appears once in the new proof");
  assert.equal(duplicate.runs.find(run => run.id === "OTHER")?.discontinueQueueRequestIds?.["300"]?.[0], "status-3", "existing run history is preserved");
  requests.push(request("status-4", "300", "PO-4"));
  const newest = collectFollowUpDiscontinue(workspace, source, now);
  assert.deepEqual(newest.requestIds, ["status-3", "status-4"], "only currently pending IDs form the next proof");
  console.log("PASS logistics discontinue adapter: preview-only, exact pending proofs, later queue, shared IDs, and preserved history (mocked status store)");
})().catch(error => { throw error; });
