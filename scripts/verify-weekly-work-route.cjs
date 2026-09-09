const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const crypto = require("node:crypto");

// Execute the actual route exports and state rules. All operating reads, stores,
// generated files, workbooks and vendor dispatches remain memory-only stubs.
function loadModule(relativePath, dependencies) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(javascript, { module, exports: module.exports, Buffer, console, Error, URL, Date, structuredClone, process:{cwd:()=>path.resolve(__dirname,"..")},
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name} in ${relativePath}`); return dependencies[name]; },
  }, { filename: relativePath });
  return module.exports;
}
const ruleTypes = loadModule("lib/wms/weekly-work-types.ts", {});
const progress = loadModule("lib/wms/weekly-work-progress.ts", {});
const state = loadModule("lib/wms/weekly-work-state.ts", { "node:crypto": crypto, "./weekly-work-types": ruleTypes, "./weekly-work-progress": progress });
const reorderRules = loadModule("lib/wms/weekly-reorder-files.ts", { "node:fs/promises": {}, "node:path": path, jszip: {} });
const advertisingRules=loadModule("lib/wms/weekly-advertising.ts",{"node:crypto":crypto,"./weekly-work-state":state});
const outputRules = loadModule("lib/wms/weekly-work-output.ts", {
  "node:crypto": crypto, exceljs: {}, jszip: {}, "./weekly-work-state": state, "./weekly-work-progress": progress,
  "./inbound-output-files": {}, "./discontinue-files": { koreaDateParts: now => ({iso:new Date(now.getTime()+9*60*60*1000).toISOString().slice(0,10)}) }, "./discontinue-letter": {}, "./weekly-reorder-files":reorderRules,
  "./weekly-advertising-files":{},"./weekly-advertising":advertisingRules,
});
const period = { startDate: "2026-09-01", endDate: "2026-09-07" };
function snapshot(selectedPeriod = period) {
  return { rulesVersion: ruleTypes.WEEKLY_RULES_VERSION, id: `weekly-${selectedPeriod.startDate}-${selectedPeriod.endDate}`, sourceToken: "source-fixture-v1", operationalToken: "operations-v1", createdAt: "2026-09-07T09:00:00.000Z", period: { ...selectedPeriod },
    source: { files: ["fixture.xlsx"], latestActualDate: "2026-09-07", firstActualDate: "2026-09-01", eventCount: 1, duplicateCount: 0, selectedEventCount: 1, mode: "browser" },
    couponItems: [{ skuId: "1001", productName: "입고상품", productLink: "" }], couponReceiptKeys: { "1001": ["receipt-1001"] },
    vendorItems: [{ skuId: "2001", productName: "발주상품", productLink: "", vendorName: "거래처A", imageUrl: "https://example.test/product.jpg", optionLabel: "실버", modelName: "MODEL-1", barcode: "12345678", shortageQuantity: 2, openOrderQuantity: 0, suggestedQuantity: 2, relatedPurchaseOrderNumbers: ["PO-1"], issues: [], discontinued: false }],
    warnings: [], blockers: [],
  };
}
class TestResponse {
  constructor(body, options = {}) { this.body = body; this.status = options.status || 200; this.headers = options.headers || {}; }
  static json(body, options) { return new TestResponse(body, options); }
}
function createHarness() {
  let workspace = structuredClone(state.emptyWeeklyWorkspace());
  let sameOrigin = true;
  let operationalToken = "operations-v1";
  let pickingSnapshot = { vendorOrderLines: [], vendorOrderDrafts: [], vendorQueueConsumedLineIds: {} };
  let nextMutationHook;
  let nextBuildHook;
  let advertisingRows=[["SKU ID","옵션ID"],["1001","87000001001"]];
  const selectionFor=run=>advertisingRules.resolveWeeklyAdvertising(state.weeklySelectedCoupons(run).map(item=>item.skuId),advertisingRows);
  const files = new Map();
  const calls = { bodyReads: 0, workspaceReads: 0, mutationAttempts: 0, workspaceWrites: 0, snapshotReads: 0, operationalReads: 0, fileReads: 0, fileWrites: 0, workbookReads: 0, outputBuilds: 0, vendorDispatch: [] };
  const sources = [];
  const makeOutput = (run, kind, now=new Date()) => ({ fileName: `주간업무_${kind}.zip`, base64: Buffer.from(`fixture ZIP ${kind}`).toString("base64"), generated: {
    at: now.toISOString(), reviewToken: state.weeklyReviewToken(run),
    couponCount: ["all", "coupon","marketing"].includes(kind) ? state.weeklySelectedCoupons(run).length : 0,
    vendors: ["all", "vendors"].includes(kind) ? [...new Set(state.weeklySelectedOrders(run).map(item => item.vendorName))] : [],
    discontinueCount: ["all", "discontinue"].includes(kind) ? Object.values(run.reviews).filter(item => item.decision === "discontinue").length : 0,
    reorderCount:["all","reorder"].includes(kind)?state.weeklyReorderRows(run).length:0,
    reorderRequestDate:["all","reorder"].includes(kind)&&state.weeklyReorderRows(run).length?reorderRules.nextWeeklyReorderFriday(now):undefined,
    advertisingCount:["all","marketing"].includes(kind)?selectionFor(run).optionIds.length:0,
    advertisingFiles:["all","marketing"].includes(kind)&&selectionFor(run).optionIds.length?["3-1_광고등록.xlsx"]:[],
    advertisingToken:["all","marketing"].includes(kind)&&selectionFor(run).optionIds.length?selectionFor(run).token:undefined,
  } });
  const dependencies = {
    "@/lib/wms/weekly-discontinue-transfer": { transferWeeklyDiscontinue: async () => { throw new Error("Use the dedicated transfer fixture for queue writes"); } },
    "next/server": { NextResponse: TestResponse },
    "@/lib/wms/noidb-action-auth": { isSameOriginActionRequest: () => sameOrigin },
    "@/lib/wms/weekly-work-source": {
      loadWeeklySnapshot: async (selectedPeriod, options) => {
        calls.snapshotReads++; sources.push({ selectedPeriod, options });
        if (!selectedPeriod?.startDate || !selectedPeriod?.endDate) throw new Error("fixture source rejected invalid period");
        return structuredClone(snapshot(selectedPeriod));
      },
      readWeeklyOperationalToken: async () => { calls.operationalReads++; return operationalToken; },
    },
    "@/lib/wms/inbound-import-context": { readInboundWorkbook: async (buffer, name) => { calls.workbookReads++; return { sourceFile: name, fingerprint: "fixture-import", items: [], size: buffer.length }; } },
    "@/lib/wms/weekly-work-store": {
      readWeeklyWorkspace: async () => { calls.workspaceReads++; return structuredClone(workspace); },
      mutateWeeklyWorkspace: async change => {
        calls.mutationAttempts++;
        if(nextMutationHook){const hook=nextMutationHook;nextMutationHook=undefined;hook(workspace);}
        const draft = structuredClone(workspace);
        const result = change(draft); // Failed CAS/validation must never commit.
        draft.revision++; workspace = draft; calls.workspaceWrites++;
        return structuredClone(result);
      },
    },
    "@/lib/wms/weekly-work-state": state,
    "@/lib/wms/weekly-work-progress": progress,
    "@/lib/wms/picking-wave/server-store": { readPickingWaveStore: async()=>structuredClone(pickingSnapshot) },
    "@/lib/wms/weekly-discontinue-queue": { readWeeklyDiscontinueQueue: async()=>({requests:[],catalogItems:[]}), syncWeeklyDiscontinueQueue:()=>0 },
    "@/lib/wms/weekly-discontinue-submit": { recordWeeklyDiscontinueSubmitted:async (id,revision)=>{const run=state.requireWeeklyRun(workspace,id,revision); const now=new Date().toISOString();run.discontinueSubmittedAt=now;run.discontinueSubmittedSkuIds=[...new Set([...(run.discontinueSubmittedSkuIds||[]),...Object.values(run.reviews).filter(r=>r.decision==="discontinue").map(r=>r.skuId)])];run.revision++;return structuredClone(run);} },
    "@/lib/wms/weekly-reorder-files": reorderRules,
    "@/lib/wms/weekly-advertising":advertisingRules,
    "@/lib/wms/weekly-advertising-source":{loadWeeklyAdvertisingSelection:async run=>selectionFor(run)},
    "@/lib/wms/weekly-work-sending": { recordWeeklyVendorSent: async (runId, expectedRevision, vendorName) => {
      calls.vendorDispatch.push({ runId, expectedRevision, vendorName });
      const run = state.requireWeeklyRun(workspace, runId, expectedRevision);
      run.sentVendors[vendorName] = "2026-09-07T09:10:00.000Z"; run.revision++;
      return structuredClone(run);
    } },
    "@/lib/wms/weekly-work-files": {
      readWeeklyFile: async key => { calls.fileReads++; return files.get(key) || null; },
      saveWeeklyFile: async (key, bytes) => { calls.fileWrites++; files.set(key, Buffer.from(bytes)); },
    },
    "@/lib/wms/weekly-work-output": { weeklyOutputKey: outputRules.weeklyOutputKey, buildWeeklyOutput: async (run, kind,now) => {
      calls.outputBuilds++;const output=makeOutput(run,kind,now);
      if(nextBuildHook){const hook=nextBuildHook;nextBuildHook=undefined;hook(workspace);}
      return output;
    } },
  };
  const route = loadModule("app/api/wms/weekly-work/route.ts", dependencies);
  const outputRoute = loadModule("app/api/wms/weekly-work/output/route.ts", dependencies);
  const advertisingRoute=loadModule("app/api/wms/weekly-work/advertising/route.ts",dependencies);
  const jsonRequest = body => ({ headers: { get: () => "application/json" }, json: async () => { calls.bodyReads++; return body; } });
  const formRequest = (uploadedFiles, selectedPeriod = period) => ({ headers: { get: () => "multipart/form-data; boundary=fixture" }, formData: async () => {
    calls.bodyReads++;
    return { get: key => key === "action" ? "analyze" : JSON.stringify(selectedPeriod), getAll: () => uploadedFiles };
  } });
  return { route, outputRoute, advertisingRoute,calls, files, sources, makeOutput, jsonRequest, formRequest,selectionFor,
    outputKey:(run,kind,now=new Date())=>outputRules.weeklyOutputKey(run,kind,now,selectionFor(run).token),
    setAdvertisingRows:rows=>{advertisingRows=rows;},
    post: body => route.POST(jsonRequest(body)), output: body => outputRoute.POST(jsonRequest(body)),
    setOrigin: value => { sameOrigin = value; }, setOperationalToken: value => { operationalToken = value; },
    beforeNextMutation: hook => { nextMutationHook=hook; }, afterNextBuild: hook => { nextBuildHook=hook; },
    installRun:run=>{workspace.runs=[structuredClone(run)];},
    setPickingSnapshot:value=>{pickingSnapshot=structuredClone(value);},
    current: () => workspace.runs[0], workspace: () => structuredClone(workspace),
    analyze: async () => { const response = await route.POST(jsonRequest({ action: "analyze", period })); assert.equal(response.status, 200); return response.body.run; },
  };
}
function unchanged(harness, before, writesBefore, label) {
  assert.deepEqual(harness.workspace(), before, label);
  assert.equal(harness.calls.workspaceWrites, writesBefore, `${label}: committed writes`);
}

async function verifyOriginAndRead() {
  const h = createHarness(); h.setOrigin(false);
  assert.equal((await h.post({ action: "analyze", period })).status, 403);
  assert.equal((await h.output({ runId: "anything", kind: "all" })).status, 403);
  assert.equal(Object.entries(h.calls).filter(([name]) => name !== "vendorDispatch").every(([, count]) => count === 0), true, "Cross-origin POST must fail before body parsing, source/store reads or writes.");
  assert.equal(h.calls.vendorDispatch.length, 0);
  h.setOrigin(true);
  const result = await h.route.GET();
  assert.equal(result.status, 200); assert.equal(result.body.success, true);
  assert.equal(result.headers["Cache-Control"], "private, no-store");
  assert.equal(h.calls.workspaceReads, 1); assert.equal(h.calls.workspaceWrites, 0);
}

async function verifyAnalyzeAndReview() {
  const h = createHarness();
  const first = await h.analyze();
  const change = { ...first.reviews["2001"], quantity: 3 };
  assert.equal((await h.post({ action: "review", runId: first.id, expectedRevision: first.revision, reviews: [change] })).status, 200);
  const reviewedRevision = h.current().revision;
  const again = await h.analyze();
  assert.equal(h.workspace().runs.length, 1, "Same source/period analysis must reuse its run.");
  assert.equal(again.id, first.id); assert.equal(again.revision, reviewedRevision);
  assert.equal(again.reviews["2001"].quantity, 3, "Reanalysis must preserve the user's reviewed quantity.");
  let before = h.workspace(); let writes = h.calls.workspaceWrites;
  assert.equal((await h.post({ action: "review", runId: first.id, expectedRevision: 999, reviews: [change] })).status, 409);
  unchanged(h, before, writes, "Stale review revision must not mutate state");
  assert.equal((await h.post({ action: "review", runId: first.id, expectedRevision: reviewedRevision, reviews: [{ ...change, quantity: 4 }, { ...change, skuId: "unknown" }] })).status, 409);
  unchanged(h, before, writes, "A later invalid review row must not partially commit earlier rows");
  for (const invalid of [null, [{ ...change, imageUrl: "javascript:alert(1)" }], [{ ...change, quantity: -1 }], [change, change]]) {
    assert.equal((await h.post({ action: "review", runId: first.id, expectedRevision: reviewedRevision, reviews: invalid })).status, 409);
    unchanged(h, before, writes, "Invalid review input must not mutate state");
  }
  for (const kind of ["coupon", "discontinue", "vendor"]) {
    assert.equal((await h.post({ action: "status", runId: first.id, expectedRevision: reviewedRevision, kind, vendorName: "거래처A" })).status, 409);
    unchanged(h, before, writes, "Completion statuses require acknowledged generated files");
  }
  assert.equal(h.calls.vendorDispatch.length, 0);
}

async function verifyOutputsAndAcknowledgment() {
  const h = createHarness(); await h.analyze();
  const runId = h.current().id;
  const postOutput = kind => h.output({ runId, expectedRevision: h.current().revision, kind });
  const before = h.workspace(); const writes = h.calls.workspaceWrites;
  h.setOperationalToken("operations-changed");
  for (const kind of ["all", "vendors"]) {
    assert.equal((await postOutput(kind)).status, 409, "A new vendor output requires current operational data.");
    assert.equal(h.calls.outputBuilds, 0); assert.equal(h.calls.fileWrites, 0);
    unchanged(h, before, writes, "Stale snapshot output must not mark generation");
  }
  // A previously generated artifact is an immutable redownload; no current-data
  // access or new order generation is necessary to return it.
  const vendorKey = outputRules.weeklyOutputKey(h.current(), "vendors");
  const cached = h.makeOutput(h.current(), "vendors");
  h.files.set(`output-${vendorKey}.json`, Buffer.from(JSON.stringify(cached)));
  const reads = h.calls.operationalReads;
  const redownload = await postOutput("vendors");
  assert.equal(redownload.status, 200);
  assert.equal(redownload.body.toString(), Buffer.from(cached.base64, "base64").toString());
  assert.equal(h.calls.operationalReads, reads); assert.equal(h.calls.outputBuilds, 0);
  assert.equal(redownload.headers["X-NOIDB-Output-Key"], vendorKey);
  unchanged(h, before, writes, "Returning cached output alone must not mark generation");
  assert.equal(h.current().generated, undefined);
  assert.equal((await postOutput("coupon")).status, 200, "Coupon output remains available independently from vendor operational freshness.");
  assert.equal(h.calls.outputBuilds, 1); assert.equal(h.calls.fileWrites, 1);
  unchanged(h, before, writes, "Building output alone must not mark generation");

  const generated = outputKey => h.post({ action: "generated", runId, expectedRevision: h.current().revision, outputKey });
  const fileReads = h.calls.fileReads;
  assert.equal((await generated("unrelated-output")).status, 409);
  assert.equal(h.calls.fileReads, fileReads, "Unmatched output key must fail before reading an artifact.");
  unchanged(h, before, writes, "Wrong output key must not mark generation");
  const allKey = h.outputKey(h.current(), "all");
  assert.equal((await generated(allKey)).status, 409);
  unchanged(h, before, writes, "Missing artifact must not mark generation");
  const wrongReview = h.makeOutput(h.current(), "all"); wrongReview.generated.reviewToken = "a-prior-review";
  h.files.set(`output-${allKey}.json`, Buffer.from(JSON.stringify(wrongReview)));
  assert.equal((await generated(allKey)).status, 409);
  unchanged(h, before, writes, "An artifact with another review token must not mark generation");

  const couponKey = outputRules.weeklyOutputKey(h.current(), "coupon");
  assert.equal((await generated(couponKey)).status, 200);
  assert.equal(h.current().generated.couponCount, 1);
  assert.equal(h.current().generated.vendors.length, 0);
  assert.equal(h.current().generated.reviewToken, state.weeklyReviewToken(h.current()));
  assert.equal((await generated(vendorKey)).status, 200);
  assert.equal(h.current().generated.couponCount, 1, "Acknowledging vendor files must preserve acknowledged coupon counts.");
  assert.deepEqual(Array.from(h.current().generated.vendors), ["거래처A"]);
  const revision = h.current().revision;
  const vendorStatus = await h.post({ action: "status", runId, expectedRevision: revision, kind: "vendor", vendorName: "거래처A" });
  assert.equal(vendorStatus.status, 200);
  assert.deepEqual(h.calls.vendorDispatch, [{ runId, expectedRevision: revision, vendorName: "거래처A" }], "Vendor dispatch must use the dedicated transaction helper.");
  assert.equal((await h.post({ action: "status", runId, expectedRevision: h.current().revision, kind: "coupon", couponExpiresOn: "2099-12-31" })).status, 200);
  assert.ok(h.current().couponUploadedAt);
  assert.equal((await h.post({ action: "status", runId, expectedRevision: h.current().revision, kind: "discontinue" })).status, 409, "Coupon/vendor acknowledgments do not imply a discontinue file exists.");
  assert.equal(h.current().discontinueSubmittedAt, undefined);
}

async function verifyDiscontinueAndMalformedRequests() {
  const h = createHarness(); await h.analyze();
  const runId = h.current().id;
  assert.equal((await h.post({ action: "review", runId, expectedRevision: h.current().revision, reviews: [{ ...h.current().reviews["2001"], decision: "discontinue" }] })).status, 200);
  const output = await h.output({ runId, expectedRevision: h.current().revision, kind: "discontinue" });
  assert.equal(output.status, 200); assert.equal(h.current().generated, undefined);
  assert.equal((await h.post({ action: "status", runId, expectedRevision: h.current().revision, kind: "discontinue" })).status, 409);
  assert.equal((await h.post({ action: "generated", runId, expectedRevision: h.current().revision, outputKey: output.headers["X-NOIDB-Output-Key"] })).status, 200);
  assert.equal((await h.post({ action: "status", runId, expectedRevision: h.current().revision, kind: "discontinue" })).status, 200);
  assert.ok(h.current().discontinueSubmittedAt);
  assert.deepEqual(Array.from(h.current().discontinueSubmittedSkuIds), ["2001"]);

  const invalid = createHarness();
  for (const body of [null, {}, { action: "unknown" }, { action: "analyze", period: null }]) {
    assert.equal((await invalid.post(body)).status, 409);
    assert.equal(invalid.calls.workspaceWrites, 0);
  }
  assert.equal((await invalid.output({ kind: "invalid" })).status, 409);
  assert.equal(invalid.calls.workspaceReads, 0, "Invalid output kind fails before reading workspace.");
  const fakeFile = size => ({ name: "fixture.xlsx", size, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  const oversized = [[], Array.from({ length: 31 }, () => fakeFile(1)), [fakeFile(10_000_001)], Array.from({ length: 4 }, () => fakeFile(8_000_000))];
  for (const files of oversized) {
    assert.equal((await invalid.route.POST(invalid.formRequest(files))).status, 409);
    assert.equal(invalid.calls.workbookReads, 0, "Upload count/size limits must reject before reading a workbook.");
    assert.equal(invalid.calls.workspaceWrites, 0);
  }
  const allowed = await invalid.route.POST(invalid.formRequest([fakeFile(3)]));
  assert.equal(allowed.status, 200); assert.equal(invalid.calls.workbookReads, 1);
  assert.equal(invalid.sources.at(-1).options.uploadedDatasets.length, 1);
  const browser = { transferId: "fixture", coverageComplete: true, headers: [], rows: [], totalCount: 0, ...period, collectedAt: "2026-09-07T09:00:00Z" };
  assert.equal((await invalid.post({ action: "analyze", period, browserSource: browser })).status, 200);
  assert.equal(invalid.sources.at(-1).options.browserSource.transferId, "fixture", "The route must pass the browser source to the source validator without replacing it with Drive data.");
}

async function verifyOverlappingCouponRuns() {
  const h=createHarness();
  const first=await h.analyze();
  const all=await h.output({runId:first.id,expectedRevision:first.revision,kind:"all"});
  assert.equal(all.status,200);
  const marked=await h.post({action:"generated",runId:first.id,expectedRevision:first.revision,outputKey:all.headers["X-NOIDB-Output-Key"]});
  assert.equal(marked.status,200);
  const opened=marked.body.run;
  const otherPeriod={startDate:"2026-09-02",endDate:"2026-09-07"};
  const other=(await h.post({action:"analyze",period:otherPeriod})).body.run;
  const otherOutput=await h.output({runId:other.id,expectedRevision:other.revision,kind:"coupon"});
  const otherMarked=(await h.post({action:"generated",runId:other.id,expectedRevision:other.revision,outputKey:otherOutput.headers["X-NOIDB-Output-Key"]})).body.run;
  const uploaded=await h.post({action:"status",runId:other.id,expectedRevision:otherMarked.revision,kind:"coupon",couponExpiresOn:"2099-12-31"});
  assert.equal(uploaded.status,200);
  const before=h.workspace(),writes=h.calls.workspaceWrites,fileReads=h.calls.fileReads;
  for(const kind of ["all","coupon"]) {
    const stale=await h.output({runId:opened.id,expectedRevision:opened.revision,kind});
    assert.equal(stale.status,409);assert.match(stale.body.error,/기간 자료.*다시 준비/);
  }
  assert.equal(h.calls.fileReads,fileReads,"another run's coupon completion blocks stale cached all/coupon output before reading it");
  const staleStatus=await h.post({action:"status",runId:opened.id,expectedRevision:opened.revision,kind:"coupon"});
  assert.equal(staleStatus.status,409);assert.match(staleStatus.body.error,/기간 자료.*다시 준비/);
  const staleGenerated=await h.post({action:"generated",runId:opened.id,expectedRevision:opened.revision,outputKey:all.headers["X-NOIDB-Output-Key"]});
  assert.equal(staleGenerated.status,409);assert.match(staleGenerated.body.error,/기간 자료.*다시 준비/);
  unchanged(h,before,writes,"stale coupon output/status/acknowledgment does not mutate either run");
  assert.equal((await h.output({runId:opened.id,expectedRevision:opened.revision,kind:"vendors"})).status,200,"vendor-only work remains usable while coupon eligibility needs refresh");
  const refreshed=await h.analyze();
  assert.equal(refreshed.id,opened.id);assert.equal(refreshed.snapshot.couponItems.length,0);assert.equal(refreshed.revision,opened.revision+1);
  assert.equal(refreshed.generated.couponCount,0);assert.deepEqual(Array.from(refreshed.generated.vendors),["거래처A"]);assert.deepEqual(refreshed.reviews,opened.reviews);
  const freshOutput=await h.output({runId:refreshed.id,expectedRevision:refreshed.revision,kind:"all"});
  assert.equal(freshOutput.status,200);assert.notEqual(freshOutput.headers["X-NOIDB-Output-Key"],all.headers["X-NOIDB-Output-Key"]);
  assert.equal((await h.post({action:"generated",runId:refreshed.id,expectedRevision:refreshed.revision,outputKey:all.headers["X-NOIDB-Output-Key"]})).status,409,"old coupon cache cannot be acknowledged after refresh");
  const historical=await h.output({runId:other.id,expectedRevision:uploaded.body.run.revision,kind:"coupon"});
  assert.equal(historical.status,200,"already-uploaded run may redownload its historical coupon file");
}

async function verifyCouponSelectionAndStaleRules() {
  const h=createHarness();await h.analyze();
  const runId=h.current().id;
  const all=await h.output({runId,expectedRevision:h.current().revision,kind:"all"});
  assert.equal((await h.post({action:"generated",runId,expectedRevision:h.current().revision,outputKey:all.headers["X-NOIDB-Output-Key"]})).status,200);
  const select=excludedSkuIds=>h.post({action:"coupon-selection",runId,expectedRevision:h.current().revision,excludedSkuIds});
  const before=h.workspace(),writes=h.calls.workspaceWrites;
  for(const invalid of [null,["missing"],["1001","1001"],[1001]]) {
    assert.equal((await select(invalid)).status,409);unchanged(h,before,writes,"invalid coupon selection leaves saved review untouched");
  }
  assert.equal((await h.post({action:"coupon-selection",runId,expectedRevision:999,excludedSkuIds:[]})).status,409);
  unchanged(h,before,writes,"coupon selection uses revision concurrency checks");
  assert.equal((await h.post({action:"coupon-selection",runId,excludedSkuIds:[]})).status,409);
  assert.equal((await h.output({runId,kind:"coupon"})).status,409);
  unchanged(h,before,writes,"omitting revision cannot bypass selection or output concurrency checks");
  const excluded=await select(["1001"]);assert.equal(excluded.status,200);
  assert.deepEqual(Array.from(h.current().couponExcludedSkuIds),["1001"]);assert.equal(h.current().generated.couponCount,0);
  assert.deepEqual(Array.from(h.current().generated.vendors),["거래처A"]);assert.equal(h.current().generated.reviewToken,state.weeklyReviewToken(h.current()));
  const revision=h.current().revision;
  assert.equal((await select(["1001"])).status,200);assert.equal(h.current().revision,revision,"unchanged selection does not advance run revision");
  const reloaded=await h.route.GET();assert.deepEqual(Array.from(reloaded.body.runs[0].couponExcludedSkuIds),["1001"]);
  const empty=await h.output({runId,expectedRevision:h.current().revision,kind:"coupon"});
  assert.equal(empty.status,409);assert.match(empty.body.error,/쿠폰을 적용할 SKU/);
  assert.equal((await h.post({action:"status",runId,expectedRevision:h.current().revision,kind:"coupon"})).status,409,"old generated coupon cannot be marked uploaded after deselection");
  assert.equal((await h.post({action:"generated",runId,expectedRevision:h.current().revision,outputKey:all.headers["X-NOIDB-Output-Key"]})).status,409,"old all-file acknowledgement is invalid after coupon selection changes");
  assert.equal((await h.post({action:"status",runId,expectedRevision:h.current().revision,kind:"vendor",vendorName:"거래처A"})).status,200,"changing coupon selection preserves already-generated vendor workflow");
  assert.equal((await h.post({action:"status",runId,expectedRevision:h.current().revision,kind:"complete"})).status,200,"all-excluded coupons do not require uploaded completion");
  assert.equal((await select([])).status,200);assert.equal(h.current().completedAt,undefined,"restoring coupon selection reopens incomplete run");
  const restored=await h.output({runId,expectedRevision:h.current().revision,kind:"coupon"});
  assert.equal(restored.status,200);
  assert.equal((await h.post({action:"generated",runId,expectedRevision:h.current().revision,outputKey:restored.headers["X-NOIDB-Output-Key"]})).status,200);
  assert.equal((await h.post({action:"status",runId,expectedRevision:h.current().revision,kind:"coupon",couponExpiresOn:"2099-12-31"})).status,200);
  const registered=h.workspace(),registeredWrites=h.calls.workspaceWrites;
  const locked=await select(["1001"]);assert.equal(locked.status,409);assert.match(locked.body.error,/이미 쿠팡에 등록/);
  unchanged(h,registered,registeredWrites,"registered selection remains immutable");

  const noFiles=createHarness();await noFiles.analyze();
  const emptyRunId=noFiles.current().id;
  assert.equal((await noFiles.post({action:"review",runId:emptyRunId,expectedRevision:noFiles.current().revision,reviews:[{...noFiles.current().reviews["2001"],decision:"hold"}]})).status,200);
  assert.equal((await noFiles.post({action:"coupon-selection",runId:emptyRunId,expectedRevision:noFiles.current().revision,excludedSkuIds:["1001"]})).status,200);
  assert.equal((await noFiles.post({action:"status",runId:emptyRunId,expectedRevision:noFiles.current().revision,kind:"complete"})).status,200,"all coupons excluded and vendor rows held can complete without generating empty files");
  assert.equal(noFiles.current().generated,undefined);assert.equal(noFiles.current().couponUploadedAt,undefined);

  for (const legacyVersion of [undefined, 2]) {
  const old=createHarness();await old.analyze();old.current().snapshot.rulesVersion=legacyVersion;
  const legacy=old.current();
  const oldOutputKey=outputRules.weeklyOutputKey(legacy,"all");
  old.files.set(`output-${oldOutputKey}.json`,Buffer.from(JSON.stringify(old.makeOutput(legacy,"all"))));
  const oldBefore=old.workspace(),oldWrites=old.calls.workspaceWrites;
  assert.equal((await old.route.GET()).status,200,"historical runs remain readable");
  for(const body of [
    {action:"review",reviews:[]},{action:"coupon-selection",excludedSkuIds:[]},
    {action:"generated",outputKey:oldOutputKey},
    ...["coupon","vendor","discontinue","complete"].map(kind=>({action:"status",kind,vendorName:"거래처A"})),
  ]) {
    const result=await old.post({...body,runId:legacy.id,expectedRevision:legacy.revision});
    assert.equal(result.status,409);assert.match(result.body.error,/기간 자료를 다시 준비/);
    unchanged(old,oldBefore,oldWrites,"legacy rules cannot mutate operating review or completion");
  }
  const oldReads=old.calls.fileReads;
  for(const kind of ["all","coupon","vendors","discontinue","reorder","marketing"]) {
    const result=await old.output({runId:legacy.id,expectedRevision:legacy.revision,kind});
    assert.equal(result.status,409);assert.match(result.body.error,/기간 자료를 다시 준비/);
  }
  assert.equal(old.calls.fileReads,oldReads,"legacy output is rejected before even reading prior cached output");
  assert.equal(old.calls.outputBuilds,0);assert.equal(old.calls.vendorDispatch.length,0);
  }
}

async function verifyCouponRaceDuringAsyncWork() {
  const concurrentUpload=workspace=>{
    const other=state.addWeeklyRun(workspace,{...snapshot({startDate:"2026-09-02",endDate:"2026-09-07"}),id:"concurrently-uploaded"});
    other.couponUploadedAt="2026-09-07T10:00:00Z";
  };
  const generating=createHarness();
  const run=await generating.analyze();
  generating.afterNextBuild(concurrentUpload);
  const response=await generating.output({runId:run.id,expectedRevision:run.revision,kind:"coupon"});
  assert.equal(response.status,409);assert.match(response.body.error,/기간 자료.*다시 준비/);
  assert.equal(generating.calls.outputBuilds,1,"fixture simulates another run uploading while output bytes are being built");
  assert.equal(generating.workspace().runs.find(item=>item.id===run.id).generated,undefined);
  assert.equal(generating.calls.workspaceWrites,1,"rejected output performs no workspace commit");

  const status=createHarness();
  const first=await status.analyze();
  const output=await status.output({runId:first.id,expectedRevision:first.revision,kind:"coupon"});
  const marked=(await status.post({action:"generated",runId:first.id,expectedRevision:first.revision,outputKey:output.headers["X-NOIDB-Output-Key"]})).body.run;
  const writes=status.calls.workspaceWrites;
  status.beforeNextMutation(concurrentUpload);
  const rejected=await status.post({action:"status",runId:first.id,expectedRevision:marked.revision,kind:"coupon"});
  assert.equal(rejected.status,409);assert.match(rejected.body.error,/기간 자료.*다시 준비/);
  const unchangedRun=status.workspace().runs.find(item=>item.id===first.id);
  assert.equal(unchangedRun.couponUploadedAt,undefined);assert.equal(unchangedRun.revision,marked.revision);
  assert.equal(status.calls.workspaceWrites,writes,"coupon eligibility must be checked inside the committing mutation, not only the preflight read");

  const selecting=createHarness();const selected=await selecting.analyze();
  selecting.afterNextBuild(workspace=>state.updateWeeklyCouponSelection(workspace.runs[0],["1001"],"concurrent selection"));
  const changed=await selecting.output({runId:selected.id,expectedRevision:selected.revision,kind:"coupon"});
  assert.equal(changed.status,409);assert.match(changed.body.error,/변경/);
  assert.equal(selecting.current().generated,undefined,"selection change during file build must reject stale file response");
}

async function prepareReorder(h) {
  await h.analyze();
  const run=h.current(),item=run.snapshot.vendorItems[0];
  item.vendorName="";item.imageUrl="";item.issues=["사진 확인","거래처 확인"];
  item.relatedPurchaseOrderNumbers=["139000001"];
  item.shortageDetails=[{purchaseOrderNumber:"139000001",confirmedQuantity:12,receivedQuantity:10,shortageQuantity:2}];
  const response=await h.post({action:"review",runId:run.id,expectedRevision:run.revision,reviews:[{...run.reviews["2001"],vendorName:"",imageUrl:"",quantity:24,quantityConfirmed:false,decision:"reorder"}]});
  assert.equal(response.status,200);
  return h.current();
}
async function verifyReorderRoutes() {
  const h=createHarness();await prepareReorder(h);
  const request=kind=>h.output({runId:h.current().id,expectedRevision:h.current().revision,kind});
  const status=kind=>h.post({action:"status",runId:h.current().id,expectedRevision:h.current().revision,kind});
  const acknowledge=key=>h.post({action:"generated",runId:h.current().id,expectedRevision:h.current().revision,outputKey:key});
  assert.equal((await status("reorder")).status,409);
  const output=await request("reorder");assert.equal(output.status,200);assert.equal(h.current().reorderRequestedAt,undefined);
  assert.equal(h.current().generated,undefined,"download does not acknowledge or submit a reorder");
  const key=output.headers["X-NOIDB-Output-Key"],cached=JSON.parse(h.files.get(`output-${key}.json`).toString());
  h.setOperationalToken("changed");assert.equal((await request("reorder")).status,409,"cached reorder still requires current source quantities");h.setOperationalToken("operations-v1");
  const priorDay=new Date(Date.now()-86400000),oldKey=outputRules.weeklyOutputKey(h.current(),"reorder",priorDay);
  const beforeReads=h.calls.fileReads;assert.equal((await acknowledge(oldKey)).status,409);assert.equal(h.calls.fileReads,beforeReads,"prior-day output key cannot be acknowledged today");
  const incorrect={...cached,generated:{...cached.generated,reorderRequestDate:"2000-01-07"}};
  h.files.set(`output-${key}.json`,Buffer.from(JSON.stringify(incorrect)));assert.equal((await acknowledge(key)).status,409,"wrong requested Friday cannot be acknowledged");
  h.files.set(`output-${key}.json`,Buffer.from(JSON.stringify(cached)));assert.equal((await acknowledge(key)).status,200);
  assert.equal(h.current().generated.reorderCount,1);assert.equal(h.current().reorderRequestedAt,undefined);
  assert.equal((await h.post({action:"coupon-selection",runId:h.current().id,expectedRevision:h.current().revision,excludedSkuIds:["1001"]})).status,200);
  assert.equal((await status("complete")).status,409,"reorder completion requires actual request confirmation");
  assert.equal((await status("reorder")).status,200);assert.ok(h.current().reorderRequestedAt);
  assert.deepEqual(Array.from(h.current().reorderRequestedLines,line=>({...line})),[{purchaseOrderNumber:"139000001",skuId:"2001",shortageQuantity:2}]);
  assert.equal(h.calls.vendorDispatch.length,0,"Coupang reorder never creates a supplier order or writes receiving quantities");
  assert.equal((await status("complete")).status,200);
  const locked=await h.post({action:"review",runId:h.current().id,expectedRevision:h.current().revision,reviews:[{...h.current().reviews["2001"],decision:"hold"}]});
  assert.equal(locked.status,409);assert.match(locked.body.error,/이미 재발주 요청/);

  const concurrent=workspace=>{
    const original=workspace.runs[0];
    const other=state.addWeeklyRun(workspace,{...structuredClone(original.snapshot),id:"other-reorder-run"});
    other.reorderRequestedAt=new Date().toISOString();other.reorderRequestedLines=[{purchaseOrderNumber:"139000001",skuId:"2001",shortageQuantity:2}];
  };
  const race=createHarness(),raceRun=await prepareReorder(race);race.afterNextBuild(concurrent);
  const rejected=await race.output({runId:raceRun.id,expectedRevision:raceRun.revision,kind:"reorder"});assert.equal(rejected.status,409);assert.match(rejected.body.error,/이미 재발주 요청/);
  assert.equal(race.workspace().runs.find(run=>run.id===raceRun.id).reorderRequestedAt,undefined);
  const raceStatus=createHarness(),rs=await prepareReorder(raceStatus);
  const built=await raceStatus.output({runId:rs.id,expectedRevision:rs.revision,kind:"reorder"});
  const marked=await raceStatus.post({action:"generated",runId:rs.id,expectedRevision:rs.revision,outputKey:built.headers["X-NOIDB-Output-Key"]});assert.equal(marked.status,200);
  const writes=raceStatus.calls.workspaceWrites;raceStatus.beforeNextMutation(concurrent);
  const duplicate=await raceStatus.post({action:"status",runId:rs.id,expectedRevision:marked.body.run.revision,kind:"reorder"});assert.equal(duplicate.status,409);assert.match(duplicate.body.error,/이미 재발주 요청/);assert.equal(raceStatus.calls.workspaceWrites,writes);
  const changed=createHarness(),cr=await prepareReorder(changed);changed.afterNextBuild(workspace=>state.updateWeeklyReviews(workspace,workspace.runs[0],[{...workspace.runs[0].reviews["2001"],decision:"hold"}],"after build"));
  assert.equal((await changed.output({runId:cr.id,expectedRevision:cr.revision,kind:"reorder"})).status,409,"reorder output rechecks review revision after asynchronous build");
}

async function verifyIncompleteReorderSources() {
  const ids=new Map();
  for(const failedSource of ["drive","history","purchases","purchase-manifest","purchase-files","catalog","picking","none"]) {
    const sourceSnapshot=snapshot();sourceSnapshot.vendorItems[0].shortageDetails=[{purchaseOrderNumber:"139000001",confirmedQuantity:12,receivedQuantity:10,shortageQuantity:2}];
    const source=loadModule("lib/wms/weekly-work-source.ts",{
      "node:crypto":crypto,
      "./weekly-work-analysis":{buildWeeklySnapshot:()=>structuredClone(sourceSnapshot),validateWeeklyPeriod:()=>{},weeklyOperationalToken:()=>"operations-v1"},
      "./inbound-import-context":{readInboundWorkbook:async()=>({})},"./inbound-import-safety":{parseInboundSourceRows:()=>[]},
      "./google-drive-oauth-reader":{resolveDriveFolderPath:async()=>{if(failedSource==="drive")throw new Error("fixture unavailable");return "fixture";},listOAuthDriveFolderFiles:async()=>[]},
      "./google-sheets":{fetchSheetRows:async name=>{if((name==="_입고요약"&&failedSource==="history")||(name==="_발주이력"&&failedSource==="purchases"))throw new Error("fixture unavailable");return [];}},
      "./product-catalog":{fetchProductCatalog:async()=>{if(failedSource==="catalog")throw new Error("fixture unavailable");return {configured:true,items:[]};}},
      "./picking-wave/server-store":{readPickingWaveStore:async()=>{if(failedSource==="picking")throw new Error("fixture unavailable");return {};}},
      "./picking-wave/shared-store-types":{emptyPickingWaveStoreSnapshot:()=>({})},
      "./parsed-file-cache":{createParsedFileCache:()=>async()=>({})},
      "./weekly-work-store":{readWeeklyWorkspace:async()=>state.emptyWeeklyWorkspace()},
      "./weekly-purchase-source":{
        readWeeklyPurchaseManifest:async()=>{if(failedSource==="purchase-manifest")throw new Error("fixture unavailable");return {folderId:"fixture-po",files:[],token:"purchase-files-v1"};},
        readWeeklyPurchaseFiles:async()=>{if(failedSource==="purchase-files")throw new Error("fixture unreadable PO originals");return {resolvedRows:[],errors:[],sourceFiles:[]};},
        mergeWeeklyPurchaseRows:rows=>({rows,addedCount:0}),
        weeklyOperationsWithPurchaseFiles:(token,fileToken)=>`${token}|${fileToken}`,
      },
    });
    const loaded=await source.loadWeeklySnapshot(period,{uploadedDatasets:[{sourceFile:"fixture.xlsx",fingerprint:"fixture",items:[]}]});
    if(["drive","history","purchases","purchase-manifest","purchase-files"].includes(failedSource)) {
      assert.equal(loaded.vendorItems.length,0,"missing receipt or PO evidence never appears as confirmed shortage work");
      assert.equal(loaded.unresolvedItems.length,1,"uncertain source data is explained separately from shortage work");
      assert.equal(loaded.unresolvedItems[0].skuId,"2001");
      assert.ok(loaded.unresolvedItems[0].issues.length>0);
    } else {
      assert.equal(loaded.vendorItems.length,1,"unrelated review metadata does not remove a known receipt shortage");
      assert.equal(loaded.vendorItems[0].shortageDetails.length,1);
    }
    if(failedSource==="none")assert.equal(loaded.operationalToken,await source.readWeeklyOperationalToken(),"analysis and fresh source checks use the same wrapped file token");
    else assert.equal(loaded.operationalToken,undefined,"failed source channels cannot certify a current operational token");
    ids.set(failedSource,loaded.id);
  }
  for(const failed of ["drive","history","purchases","purchase-manifest","purchase-files","catalog","picking"]) assert.notEqual(ids.get(failed),ids.get("none"),"source recovery yields a new complete snapshot instead of reusing incomplete saved work");
}

async function verifyAdvertisingRoutes() {
  const h=createHarness();await h.analyze();
  const request=kind=>h.output({runId:h.current().id,expectedRevision:h.current().revision,kind});
  const acknowledge=key=>h.post({action:"generated",runId:h.current().id,expectedRevision:h.current().revision,outputKey:key});
  const preview=()=>h.advertisingRoute.GET({nextUrl:new URL(`https://example.test/api/wms/weekly-work/advertising?runId=${h.current().id}`)});
  const ready=await preview();assert.equal(ready.status,200);assert.deepEqual(Array.from(ready.body.resolved,item=>({...item})),[{skuId:"1001",optionId:"87000001001"}],"preview accepts omitted revision and maps current selection");
  h.setAdvertisingRows([["SKU ID","노출상품ID"],["1001","87000001001"]]);
  const missing=await preview();assert.equal(missing.status,200);assert.deepEqual(Array.from(missing.body.missingSkuIds),["1001"]);
  const writes=h.calls.workspaceWrites;
  assert.equal((await request("marketing")).status,409);assert.equal((await request("all")).status,409);assert.equal(h.calls.workspaceWrites,writes);
  assert.equal((await request("coupon")).status,200,"missing advertising mapping does not block coupon-only output");
  h.setAdvertisingRows([["SKU ID","옵션ID"],["1001","87000001001"]]);
  const marketing=await request("marketing");assert.equal(marketing.status,200);assert.equal(h.current().generated,undefined);
  const key=marketing.headers["X-NOIDB-Output-Key"];
  h.setAdvertisingRows([["SKU ID","옵션ID"],["1001","87000001002"]]);
  assert.equal((await acknowledge(key)).status,409,"old mapping output cannot be acknowledged after live option ID changes");
  assert.equal(h.current().generated,undefined);
  const regenerated=await request("marketing");assert.equal(regenerated.status,200);assert.notEqual(regenerated.headers["X-NOIDB-Output-Key"],key);
  assert.equal((await acknowledge(regenerated.headers["X-NOIDB-Output-Key"])).status,200);assert.equal(h.current().generated.advertisingCount,1);assert.deepEqual(Array.from(h.current().generated.advertisingFiles),["3-1_광고등록.xlsx"]);
  const advertisedToken=h.current().generated.advertisingToken;
  const coupon=await request("coupon");assert.equal((await acknowledge(coupon.headers["X-NOIDB-Output-Key"])).status,200);assert.equal(h.current().generated.advertisingToken,advertisedToken,"coupon-only acknowledgment preserves prior acknowledged advertising files for the same selected SKUs");
  assert.equal((await h.post({action:"coupon-selection",runId:h.current().id,expectedRevision:h.current().revision,excludedSkuIds:["1001"]})).status,200);
  assert.equal(h.current().generated.advertisingCount,0);assert.equal(h.current().generated.advertisingToken,undefined);assert.deepEqual(Array.from(h.current().generated.advertisingFiles),[]);
  assert.equal(h.calls.vendorDispatch.length,0,"advertising lookup/output never submits an ad or supplier order");

  const race=createHarness(),run=await race.analyze();
  race.afterNextBuild(()=>race.setAdvertisingRows([["SKU ID","옵션ID"],["1001","87000001002"]]));
  const changed=await race.output({runId:run.id,expectedRevision:run.revision,kind:"marketing"});assert.equal(changed.status,409);assert.match(changed.body.error,/광고 옵션 ID 연결이 변경/);assert.equal(race.current().generated,undefined);
  const selecting=createHarness(),sr=await selecting.analyze();
  selecting.afterNextBuild(workspace=>state.updateWeeklyCouponSelection(workspace.runs[0],["1001"],"during marketing build"));
  assert.equal((await selecting.output({runId:sr.id,expectedRevision:sr.revision,kind:"marketing"})).status,409,"marketing retains selection revision race protection");

  let reads=0;
  const source=loadModule("lib/wms/weekly-advertising-source.ts",{
    "node:fs/promises":{readFile:async()=>"[]"},"node:path":path,
    "./google-sheets":{fetchSheetRows:async(name,options)=>{reads++;assert.equal(name,"제품DB");assert.equal(options.valueRenderOption,"FORMULA");return [["SKU ID","옵션ID"],["1001","87000001001"]];}},
    "./weekly-advertising":advertisingRules,"./weekly-work-state":state,
  });
  const sourceHarness=createHarness();await sourceHarness.analyze();
  assert.equal((await source.loadWeeklyAdvertisingSelection(sourceHarness.current())).optionIds[0],"87000001001");
  await source.loadWeeklyAdvertisingSelection(sourceHarness.current());assert.equal(reads,2,"mapping source reads current raw Sheet FORMULA values without an application cache");
}

if (require.main === module) (async () => {
  await verifyOriginAndRead();
  await verifyAnalyzeAndReview();
  await verifyOutputsAndAcknowledgment();
  await verifyDiscontinueAndMalformedRequests();
  await verifyOverlappingCouponRuns();
  await verifyCouponSelectionAndStaleRules();
  await verifyCouponRaceDuringAsyncWork();
  await verifyReorderRoutes();
  await verifyIncompleteReorderSources();
  await verifyAdvertisingRoutes();
  console.log("weekly-work-route: origin rejection, revision/selection races, stale-rule guards, coupon selection/locking/completion, output freshness/cache, generated acknowledgment, status sequencing, vendor dispatch and upload limits passed; VM fixtures only, zero operating writes");
})().catch(error => { console.error(error); process.exitCode = 1; });

module.exports={createHarness,state,progress,snapshot,loadModule};
