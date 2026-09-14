const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {selectLatestSupplierHubPurchaseOrderSnapshots,resolveSupplierHubSnapshotTime}=require('../lib/wms/supplier-hub-orders.ts');
const order=(po,file,capturedAt,quantity=1)=>({purchaseOrderNumber:po,orderType:'리오더',fulfillmentCenter:'센터',fulfillmentAddress:'주소',fulfillmentContactPhone:'전화',expectedDate:'2026-09-20',accountName:'노이드비',sourceFileName:file,capturedAt,items:[{lineNo:1,productCode:'100',productName:'상품',barcode:'R1',purchaseType:'직매입',taxType:'과세',orderedQuantity:quantity,vendorConfirmedQuantity:quantity,receivedQuantity:0}]});
const old='2026-09-10T01:00:00.000Z',latest='2026-09-11T01:00:00.000Z';
let result=selectLatestSupplierHubPurchaseOrderSnapshots([order('1','single.xlsx',old,1)]);
assert.equal(result.orders.length,1);assert.equal(result.orders[0].items[0].orderedQuantity,1);assert.equal(result.conflicts.length,0);
for(const candidates of [[order('2','old.xlsx',old,1),order('2','latest.xlsx',latest,2)],[order('2','latest.xlsx',latest,2),order('2','old.xlsx',old,1)]]){
  result=selectLatestSupplierHubPurchaseOrderSnapshots(candidates);assert.equal(result.orders[0].sourceFileName,'latest.xlsx');assert.equal(result.orders[0].items[0].orderedQuantity,2);
}
result=selectLatestSupplierHubPurchaseOrderSnapshots([order('3','snapshot.zip :: po_20260910090000.xlsx',old,1),order('3','po_20260911100000.xlsx',latest,4)]);
assert.equal(result.orders[0].items[0].orderedQuantity,4);
result=selectLatestSupplierHubPurchaseOrderSnapshots([order('4','a.xlsx',latest,1),order('4','b.xlsx',latest,2)]);
assert.equal(result.orders.length,0);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].sourceFileNames.join(','),'a.xlsx,b.xlsx');
assert.equal(resolveSupplierHubSnapshotTime('발주서리스트_20260911123456.xlsx','outer.zip','2026-01-01T00:00:00Z'),'2026-09-11T03:34:56.000Z');
assert.equal(resolveSupplierHubSnapshotTime('po.xlsx','발주서리스트_20260910101010.zip','2026-01-01T00:00:00Z'),'2026-09-10T01:10:10.000Z');
assert.equal(resolveSupplierHubSnapshotTime('po.xlsx','outer.zip','2026-09-09T03:00:00Z'),'2026-09-09T03:00:00.000Z');
console.log('PASS single snapshot, newest content, read-order independence, ZIP/XLSX comparison, equal-time conflict, filename timestamp priority, mtime fallback');
