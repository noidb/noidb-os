const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {emptyPickingWaveStoreSnapshot}=require('../lib/wms/picking-wave/shared-store-types.ts');
const {consolidateVendorOrders}=require('../lib/wms/vendor-order/consolidate.ts');
const at='2026-09-20T00:00:00.000Z';
function source(id,po,qty){return {id,draftId:'inbound',waveId:'inbound',vendorName:'거래처',skuId:'100',modelName:'',category:'',optionLabel:'',productName:'상품',imageUrl:'',barcode:'',shortageQuantity:qty,actualShortageQuantity:qty,currentStock:'',relatedPurchaseOrderNumbers:[po],actualInboundDetails:[{purchaseOrderNumber:po,confirmedQuantity:qty,receivedQuantity:0,shortageQuantity:qty}],memo:'',isManuallyAdded:false,createdAt:at,updatedAt:at};}
const store=emptyPickingWaveStoreSnapshot();
consolidateVendorOrders(store,'actual-1',[source('a','PO1',2),source('b','PO2',3)],at);
let line=store.vendorOrderLines[0];
assert.equal(line.shortageQuantity,5);assert.equal(line.actualShortageQuantity,5);assert.deepEqual(line.actualInboundDetails.map(row=>row.purchaseOrderNumber),['PO1','PO2']);
consolidateVendorOrders(store,'actual-2',[source('again','PO1',2)],'2026-09-20T01:00:00.000Z');
line=store.vendorOrderLines[0];assert.equal(line.actualShortageQuantity,5,'same PO/SKU evidence does not add twice');
line.shortageQuantity=9;line.updatedAt='2026-09-20T02:00:00.000Z';
consolidateVendorOrders(store,'actual-3',[source('c','PO3',4)],'2026-09-20T03:00:00.000Z');
line=store.vendorOrderLines[0];assert.equal(line.shortageQuantity,9,'manual displayed quantity is preserved');assert.equal(line.actualShortageQuantity,9);assert.equal(line.actualInboundDetails.length,3);
console.log('PASS actual inbound consolidation: different PO totals, same PO dedupe, manual quantity preservation');
