// 2026-10-21: 보충분 입고완료 빠른 저장(저장소 한 번 읽기) 검사.
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {emptyPickingWaveStoreSnapshot,isPickingWaveStoreMutation}=require('../lib/wms/picking-wave/shared-store-types.ts');
const {applyPickingWaveStoreMutation:apply}=require('../lib/wms/picking-wave/server-store.ts');
const at='2026-10-20T00:00:00.000Z',now='2026-10-21T02:00:00.000Z';
const s=emptyPickingWaveStoreSnapshot();
const d={id:'d1',waveId:'w',vendorName:'A',status:'sent',sentAt:at,createdAt:at,updatedAt:at};
const l={id:'l1',draftId:'d1',waveId:'w',vendorName:'A',skuId:'200',productName:'p',modelName:'M',category:'',optionLabel:'',imageUrl:'',barcode:'',currentStock:'0',shortageQuantity:5,relatedPurchaseOrderNumbers:[],memo:'',isManuallyAdded:false,isStockReplenishment:true,createdAt:at,updatedAt:at};
s.vendorOrderDrafts=[d];s.vendorOrderLines=[l];
const m={action:'completeVendorReceivingById',lineId:'l1',expectedUpdatedAt:at,expectedQuantity:5,isStockReplenishment:true,now};
assert.equal(isPickingWaveStoreMutation(m),true);
const n=apply(s,m),saved=n.vendorOrderLines[0];
assert.equal(saved.receivedQuantity,5);assert.equal(saved.receivingCompletedAt,now);assert.equal(saved.receivingHistory.length,1);
assert.equal(apply(n,m),n,'두 번 눌러도 그대로');
assert.throws(()=>apply(s,{...m,expectedUpdatedAt:'2026-01-01T00:00:00.000Z'}),/변경/);
assert.throws(()=>apply(s,{...m,expectedQuantity:4}),/변경/);
console.log('fast receiving complete: ok');
