import assert from 'node:assert/strict';
import {simpleReceivingPlan,saveSimpleReceivingLine} from '../lib/wms/simple-vendor-receiving';
import {buildReceivingCostPlan,buildReceivingCostRequests,applyReceivingCostPlan} from '../lib/wms/simple-receiving-cost';
import {applyPickingWaveStoreMutation} from '../lib/wms/picking-wave/server-store';
import {emptyPickingWaveStoreSnapshot,isPickingWaveStoreMutation} from '../lib/wms/picking-wave/shared-store-types';
import {RECEIVING_COST_HEADERS,RECEIVING_COST_SHEET} from '../lib/wms/vendor-order-actions';
import type {VendorOrderDraftLine} from '../lib/wms/vendor-order/types';
const now='2026-09-06T00:00:00Z';
const line:VendorOrderDraftLine={id:'W::V::SKU1',draftId:'W::V',waveId:'W',vendorName:'V',skuId:'80000001',modelName:'MODEL1',category:'반지',optionLabel:'실버',productName:'검증반지',imageUrl:'',barcode:'R100001',actualShortageQuantity:3,shortageQuantity:17,currentStock:'9',relatedPurchaseOrderNumbers:['140000001'],memo:'보존',isManuallyAdded:true,receivedQuantity:1,createdAt:now,updatedAt:now};
const input={quantity:4,unitPrice:105,usedImmediately:true};
const p=simpleReceivingPlan(line,input);assert.equal(p.vat,11);assert.equal(p.costVatIncluded,116);
for(const bad of [{...input,quantity:18},{...input,quantity:-1},{...input,quantity:1.5},{...input,unitPrice:NaN},{...input,unitPrice:-1}])assert.throws(()=>simpleReceivingPlan(line,bad));
const snapshot=emptyPickingWaveStoreSnapshot();snapshot.vendorOrderLines=[line,{...line,id:'OTHER'}];snapshot.vendorOrderDrafts=[{id:line.draftId,waveId:'W',vendorName:'V',status:'sent',createdAt:now,updatedAt:now}];
const mutation={action:'saveSimpleReceiving' as const,before:line,input,now:'2026-09-06T01:00:00Z'};
assert.equal(isPickingWaveStoreMutation(mutation),false,'Public generic mutation cannot bypass authenticated route');
const before=JSON.stringify(snapshot),updated=applyPickingWaveStoreMutation(snapshot,mutation),saved=updated.vendorOrderLines[0];
assert.equal(JSON.stringify(snapshot),before);assert.equal(saved.receivedQuantity,4);assert.equal(saved.currentStock,'9');assert.equal(saved.shortageQuantity,17);assert.equal(saved.memo,'보존');assert.deepEqual(saved.receivingHistory?.[0].record,line);
for(const key of ['waves','items','baskets','shipments','poConfirmationRecords','vendorOrderDrafts'] as const)assert.deepEqual(updated[key],snapshot[key]);
assert.deepEqual(updated.vendorOrderLines[1],snapshot.vendorOrderLines[1]);
assert.throws(()=>applyPickingWaveStoreMutation(updated,mutation),/다른 기기/);
assert.throws(()=>applyPickingWaveStoreMutation(updated,{action:'saveVendorLine',line:{...line,memo:'old screen'}}),/간단 입고기록/);
assert.equal(applyPickingWaveStoreMutation(updated,{action:'saveVendorLine',line:{...saved,memo:'new memo',updatedAt:'2026-09-06T02:00:00Z'}}).vendorOrderLines.find(l=>l.id===saved.id)?.memo,'new memo');
assert.throws(()=>saveSimpleReceivingLine(saved,line,input,now),/다른 기기/);
const products=[['SKU ID','원가(부가세포함)','현재고'],['80000001','100','9'],['80000002','300','8']];
const history:string[][]=[[...RECEIVING_COST_HEADERS]];const cost=buildReceivingCostPlan(saved,products,history);
assert.equal(cost.before,'100');assert.equal(cost.after,116);assert.equal(cost.alreadyApplied,false);
assert.throws(()=>buildReceivingCostPlan(saved,[products[0],products[1],products[1]],history),/한 행/);
assert.throws(()=>buildReceivingCostPlan(saved,[products[0],['80000001','=A2','9']],history),/수식/);
for(const exists of [true,false]){
 const requests=buildReceivingCostRequests(cost,1,2,exists,3,[4,5],now);
 const productWrites=requests.filter(r=>r.updateCells?.range?.sheetId===1);assert.equal(productWrites.length,1);
 assert.deepEqual(productWrites[0].updateCells.range,{sheetId:1,startRowIndex:1,endRowIndex:2,startColumnIndex:1,endColumnIndex:2});
 assert.equal(requests.filter(r=>r.appendCells).length,1);assert.equal(requests.filter(r=>r.duplicateSheet).length,exists?2:1);
 assert.deepEqual(requests.at(-1),{deleteSheet:{sheetId:3}});
}
async function scenario(mode:string){
 let productRows=structuredClone(products),historyRows=structuredClone(history),releases=0,batches=0,loads=0,held=false;
 const load=async()=>{loads++;const plan=buildReceivingCostPlan(saved,productRows,historyRows);return mode==='stale'&&loads===2?{...plan,token:'f'.repeat(64)}:plan;};
 const lock={acquire:async()=>{assert.equal(held,false);held=true;return 3;},release:async()=>{held=false;releases++;}};
 const request=async(path:string,body?:unknown)=>{
  if(path==='?fields=sheets.properties')return Response.json({sheets:[{properties:{sheetId:1,title:'제품DB'}},{properties:{sheetId:2,title:RECEIVING_COST_SHEET}},{properties:{sheetId:3,title:'_입고저장_진행중'}}]});
  if(path.startsWith('?ranges='))return Response.json({sheets:[{data:[{rowData:[{values:[mode==='validation'?{dataValidation:{strict:true}}:{}]}]}]}]});
  assert.equal(path,':batchUpdate');batches++;
  if(mode==='reject')return new Response('',{status:400});
  if(mode==='network')throw new Error('connection lost');
  const batch=(body as {requests:any[]}).requests;
  const append=batch.find(r=>r.appendCells).appendCells.rows[0].values.map((v:any)=>String(v.userEnteredValue.numberValue??v.userEnteredValue.stringValue));
  historyRows.push(append);productRows[1][1]='116';held=false;
  if(mode==='lost-response')throw new Error('response lost after atomic commit');
  return Response.json({replies:[]});
 };
 const deps={load,request,lock} as unknown as NonNullable<Parameters<typeof applyReceivingCostPlan>[2]>;
 if(mode==='ok'){
  assert.equal((await applyReceivingCostPlan(saved.id,cost.token,deps)).alreadyApplied,false);
  assert.equal((await applyReceivingCostPlan(saved.id,cost.token,deps)).alreadyApplied,true);
  assert.equal(batches,1);assert.equal(historyRows.length,2);assert.deepEqual(productRows,[products[0],['80000001','116','9'],products[2]]);
 }else{
  await assert.rejects(applyReceivingCostPlan(saved.id,cost.token,deps));
  if(['stale','validation','reject'].includes(mode)){assert.equal(releases,1);assert.equal(held,false);assert.deepEqual(productRows,products);assert.deepEqual(historyRows,history);}
  if(mode==='network'){assert.equal(held,true);assert.equal(releases,0);assert.deepEqual(productRows,products);}
  if(mode==='lost-response'){assert.equal(releases,0);assert.equal((await applyReceivingCostPlan(saved.id,cost.token,deps)).alreadyApplied,true);assert.equal(batches,1);assert.equal(historyRows.length,2);}
 }
}
async function main(){for(const mode of ['ok','stale','validation','reject','network','lost-response'])await scenario(mode);console.log('Simple receiving PASS: exact line, backups, stale guard, no stock/picking mutation, VAT single-cell atomic write, lock/error/replay cases');}
void main().catch(error=>{console.error(error);process.exitCode=1;});
