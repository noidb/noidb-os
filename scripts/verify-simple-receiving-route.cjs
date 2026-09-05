const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
async function test({action='save',authenticated=true,origin=true,confirmed=true,token='token'}={}){
 const calls=[];const line={id:'L',draftId:'D'};
 const dependencies={
  'next/server':{NextResponse:{json:(body,init={})=>({body,status:init.status||200})}},
  '@/lib/wms/picking-wave/server-store':{readPickingWaveStore:async()=>{calls.push('read');return {vendorOrderLines:[line],vendorOrderDrafts:[{id:'D'}]};},mutatePickingWaveStore:async mutation=>{calls.push('save');assert.equal(mutation.action,'saveSimpleReceiving');return {vendorOrderLines:[line]};}},
  '@/lib/wms/simple-vendor-receiving':{simpleReceivingPlan:()=>({token:'token'})},
  '@/lib/wms/simple-receiving-cost':{loadReceivingCostPlan:async()=>{calls.push('cost-preview');return {token:'token',products:[['PRIVATE']],history:[['PRIVATE']]};},applyReceivingCostPlan:async()=>{calls.push('cost-apply');return {applied:true};}},
  '@/lib/wms/noidb-action-auth':{hasNoidbActionSession:()=>authenticated,isSameOriginActionRequest:()=>origin},
  '@/lib/wms/inbound-import-store':{createInboundTransactionStore:()=>({acquire:async()=>{calls.push('acquire');return 1;},release:async()=>calls.push('release')})}
 };
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/wms/simple-receiving/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>{assert(Object.hasOwn(dependencies,name),name);return dependencies[name];}});
 const result=await module.exports.POST({json:async()=>({action,lineId:'L',confirmed,token,quantity:2,unitPrice:100,usedImmediately:false})});
 if(!origin){assert.equal(result.status,403);assert.deepEqual(calls,[]);}
 else if(['save','cost-apply'].includes(action)&&(!authenticated||!confirmed)){assert.equal(result.status,401);assert.deepEqual(calls,[]);}
 else if(action==='save'&&token!=='token'){assert.equal(result.status,409);assert.deepEqual(calls,['read']);}
 else{assert.equal(result.status,200);assert(!JSON.stringify(result.body).includes('PRIVATE'));if(action==='save')assert.deepEqual(calls,['read','acquire','save','release']);if(action==='preview')assert.deepEqual(calls,['read']);}
}
(async()=>{for(const action of ['save','cost-apply','preview','cost-preview']){await test({action});await test({action,origin:false});}for(const action of ['save','cost-apply']){await test({action,authenticated:false});await test({action,confirmed:false});}await test({token:'stale'});console.log('Simple receiving route PASS: origin/session/confirmation/stale gates before writes, preview privacy, lock release');})().catch(e=>{console.error(e);process.exitCode=1;});
