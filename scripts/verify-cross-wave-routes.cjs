const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const routes=[
 ['app/api/wms/po-confirm/generate/route.ts',{poNumber:'141427163'}],
 ['app/api/wms/po-confirm/generate-selected/route.ts',{selectedPoNumbers:['141427163']}],
 ['app/api/wms/hanjin-upload/generate/route.ts',{purchaseOrderNumbers:['141427163']}],
 ['app/api/wms/hanjin-upload/build-shipment-auto/route.ts',{purchaseOrderNumbers:['141427163'],generationId:'G'}],
];
(async()=>{for(const [file,body] of routes){
 let checked=0;const module={exports:{}};
 const req=name=>{
  if(name==='next/server')return {NextResponse:{json:(data,options)=>({status:options.status,data})}};
  if(name==='@/lib/wms/active-purchase-order-selection')return {verifyActivePurchaseOrderSelection:async(waveId,numbers)=>{checked++;assert.equal(waveId,'TARGET');assert.deepEqual([...numbers],['141427163']);throw Error('다른 작업에서 출고완료한 발주서');}};
  if(name.startsWith('node:')||name==='path')return require(name);
  return new Proxy({},{get:(_,key)=>key==='__esModule'?true:class UnusedDependency{}});
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module,exports:module.exports,require:req,process,Buffer,console});
 const result=await module.exports.POST({json:async()=>({...body,waveId:'TARGET'})});assert.equal(result.status,409,file);assert.match(result.data.error,/출고완료/);assert.equal(checked,1,file);
}
console.log('PASS: all four operational generation routes recheck wave scope and reject newly dispatched POs before generating or saving files.');})().catch(e=>{console.error(e);process.exitCode=1});
