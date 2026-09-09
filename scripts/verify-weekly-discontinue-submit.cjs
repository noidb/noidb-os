const assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (m,p) => m._compile(ts.transpileModule(fs.readFileSync(p,"utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,p);
const state = require("../lib/wms/weekly-work-state.ts");
const {recordWeeklyDiscontinueSubmitted: submit} = require("../lib/wms/weekly-discontinue-submit.ts");
const now = "2026-09-08T09:00:00.000Z";
function harness({queue=true,failAck=false,missing=false}={}) {
  const workspace=state.emptyWeeklyWorkspace();
  const run={id:"WEEKLY-submit",snapshot:{rulesVersion:4,sourceToken:"s",couponItems:[],vendorItems:[]},reviews:{"123":{skuId:"123",decision:"discontinue",quantity:0,quantityConfirmed:false,vendorName:"",imageUrl:""}},revision:0,updatedAt:now,sentVendors:{},discontinueQueueRequestIds:queue?{"123":["request-1"]}:{}};
  run.generated={at:now,reviewToken:state.weeklyReviewToken(run),couponCount:0,vendors:[],discontinueCount:1,discontinueSkuIds:["123"]};
  workspace.runs.push(run);
  const requests=missing?[]:[{id:"request-1",skuId:"123",supplyHubStatus:"처리대기"},{id:"later-request",skuId:"456",supplyHubStatus:"처리대기"}];
  let writes=0,mutations=0;
  const deps={
    mutateWeeklyWorkspace:async fn=>{mutations++; if(failAck && mutations===2)throw Error("lost local acknowledgement"); const value=fn(workspace);return structuredClone(value);},
    completeStatusRequests:async ids=>{let changed=0;for(const r of requests)if(ids.includes(r.id)&&r.supplyHubStatus!=="처리완료"){r.supplyHubStatus="처리완료";changed++;writes++;}return changed;},
    listStatusRequests:async()=>structuredClone(requests),
  };
  return {workspace,run,requests,deps,writes:()=>writes};
}
(async()=>{
  const h=harness({failAck:true});
  await assert.rejects(()=>submit(h.run.id,h.run.revision,h.deps,now),/lost local/);
  assert(h.run.pendingDiscontinueSubmission);assert.equal(h.run.discontinueSubmittedAt,undefined);
  assert.deepEqual(h.run.pendingDiscontinueSubmission.requestIds,["request-1"]);
  const reservationId=h.run.pendingDiscontinueSubmission.id;
  const result=await submit(h.run.id,h.run.revision,h.deps,now);
  assert.equal(result.pendingDiscontinueSubmission,undefined);assert.equal(result.discontinueSubmittedAt,now);
  assert.deepEqual(result.discontinueSubmittedSkuIds,["123"]);assert.equal(h.writes(),1);
  assert.equal(h.requests.find(r=>r.id==="later-request").supplyHubStatus,"처리대기");
  await submit(h.run.id,h.run.revision,h.deps,now);assert.equal(h.writes(),1);
  const plain=harness({queue:false});await submit(plain.run.id,plain.run.revision,plain.deps,now);assert.equal(plain.writes(),0);assert.equal(plain.run.discontinueSubmittedAt,now);
  const vanished=harness({missing:true});await assert.rejects(()=>submit(vanished.run.id,vanished.run.revision,vanished.deps,now),/확인하지 못했습니다/);assert(vanished.run.pendingDiscontinueSubmission);assert.equal(vanished.run.discontinueSubmittedAt,undefined);
  const stale=harness();stale.run.generated.reviewToken="stale";await assert.rejects(()=>submit(stale.run.id,stale.run.revision,stale.deps,now),/먼저 생성/);assert.equal(stale.writes(),0);assert.equal(stale.run.pendingDiscontinueSubmission,undefined);
  const wrong=harness();wrong.run.generated.discontinueSkuIds=["999"];await assert.rejects(()=>submit(wrong.run.id,wrong.run.revision,wrong.deps,now),/상품 목록/);assert.equal(wrong.writes(),0);
  console.log("PASS: exact generated SKU/request reservation, lost acknowledgement retry, once-only queue write, later arrivals untouched, missing acknowledgement remains pending, stale file rejected, non-queue submission completes.");
})().catch(error=>{console.error(error);process.exitCode=1;});
