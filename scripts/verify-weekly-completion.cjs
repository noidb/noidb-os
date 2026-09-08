const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const JSZip = require("jszip");
const { createHarness, state, progress, snapshot, loadModule } = require("./verify-weekly-work-route.cjs");

(async () => {
  const source = snapshot();
  source.couponItems = [];
  source.vendorItems.push({ ...source.vendorItems[0], skuId: "2002", productName: "신규 단종" });
  const workspace = state.emptyWeeklyWorkspace();
  const run = state.addWeeklyRun(workspace, source);
  run.reviews["2001"].decision = "discontinue";
  run.reviews["2002"].decision = "discontinue";
  const generatedOnly = { ...run, generated: { at: "downloaded", reviewToken: state.weeklyReviewToken(run), couponCount: 0, vendors: [], discontinueCount: 2 } };
  assert(progress.weeklyReviewIsActive(generatedOnly, generatedOnly.reviews["2001"]), "Generating files never completes a row");
  const captured = [];
  const output = loadModule("lib/wms/weekly-work-output.ts", {
    "node:crypto": crypto, exceljs: {}, jszip: JSZip, "./weekly-work-state": state, "./weekly-work-progress": progress,
    "./inbound-output-files": {}, "./weekly-reorder-files": {}, "./weekly-advertising-files": {}, "./weekly-advertising": {},
    "./discontinue-files": {
      koreaDateParts: () => ({ iso: "2026-09-08", compact: "20260908" }),
      loadDiscontinueTemplate: async () => Buffer.from("fixture template"), loadDiscontinueLetterTemplate: async () => Buffer.from("fixture letter"),
      buildDiscontinueWorkbook: async (_, items) => { captured.push(items.map(item => item.skuId)); return { buffer: Buffer.from("fixture xlsx") }; },
    },
    "./discontinue-letter": { buildDiscontinueLetterFromTemplate: async (_, items) => { captured.push(items.map(item => item.skuId)); return Buffer.from("fixture pdf"); } },
  });
  const beforeKey = output.weeklyOutputKey(run, "discontinue");
  run.discontinueSubmittedSkuIds = ["2001"];
  assert(!progress.weeklyReviewIsActive(run, run.reviews["2001"]));
  assert(progress.weeklyReviewIsActive(run, run.reviews["2002"]));
  assert.notEqual(output.weeklyOutputKey(run, "discontinue"), beforeKey, "Completion invalidates ZIP cache containing old rows");
  const built = await output.buildWeeklyOutput(run, "discontinue");
  assert.deepEqual(captured.map(row => Array.from(row)), [["2002"], ["2002"]], "Both XLSX and PDF contain only pending discontinuation");
  assert.deepEqual(Array.from(built.generated.discontinueSkuIds), ["2002"]);
  assert.equal(built.generated.discontinueCount, 1);
  const zip = await JSZip.loadAsync(built.base64, { base64: true });
  assert.equal(Object.values(zip.files).filter(file => !file.dir).length, 2);
  assert.throws(() => state.updateWeeklyReviews(workspace, run, [{ ...run.reviews["2001"], decision: "hold" }], "later"), /처리 완료/);
  run.vendorQueueTransfers = [{ id: "T", at: "moved", lines: [{ skuId: "2002" }] }];
  assert(progress.weeklyReviewIsActive(run, run.reviews["2002"]), "Later supplier discontinuation remains visible after prior vendor transfer");
  run.reviews["2002"].decision = "order";
  assert(!progress.weeklyReviewIsActive(run, run.reviews["2002"]), "Transferred orders live in main queue");
  delete run.vendorQueueTransfers;
  run.sentVendors[run.reviews["2002"].vendorName] = "sent";
  assert.equal(state.weeklySelectedOrders(run).length, 0, "Already sent vendors are excluded from repeat vendor files");
  const reloaded = JSON.parse(JSON.stringify(run));
  assert(!progress.weeklyReviewIsActive(reloaded, reloaded.reviews["2001"]));
  assert(!progress.weeklyReviewIsActive(reloaded, reloaded.reviews["2002"]));
  const h=createHarness();
  delete run.generated;
  run.sentVendors={};
  run.reviews["2002"].quantity=0;
  run.vendorQueueTransfers=[{id:"transfer",at:"moved",completed:true,lines:[{id:"original-source",skuId:"2002"}]}];
  h.installRun(run);
  const picking={vendorQueueConsumedLineIds:{"original-source":"VENDOR-QUEUE-Q"},vendorOrderLines:[{id:"VENDOR-QUEUE-Q::2002",skuId:"2002",draftId:"Q::A"}],vendorOrderDrafts:[{id:"Q::A",status:"draft"}]};
  h.setPickingSnapshot(picking);
  assert.equal((await h.post({action:"status",kind:"complete",runId:run.id,expectedRevision:run.revision})).status,409,"Pending queue must prevent weekly completion");
  picking.vendorOrderDrafts[0].status="sent";h.setPickingSnapshot(picking);
  assert.equal((await h.post({action:"status",kind:"complete",runId:run.id,expectedRevision:run.revision})).status,200,"Transferred zero legacy quantity is completed through actual queue sent state");
  assert(h.current().completedAt);
  console.log("PASS weekly completion: explicit completion, persisted scope, cache invalidation, pending-only PDF/XLSX, completed review lock, transferred discontinuation, sent vendor exclusion. Fixtures only.");
})().catch(error => { console.error(error); process.exitCode = 1; });
