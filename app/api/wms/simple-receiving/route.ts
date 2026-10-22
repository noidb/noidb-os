import {NextRequest,NextResponse} from 'next/server';
import {readPickingWaveStore,mutatePickingWaveStore} from '@/lib/wms/picking-wave/server-store';
import {simpleReceivingPlan,completeReceivingPlan} from '@/lib/wms/simple-vendor-receiving';
import {loadReceivingCostPlan,applyReceivingCostPlan} from '@/lib/wms/simple-receiving-cost';
import {updateCostForSameModel} from '@/lib/wms/product-catalog-write';
import {hasNoidbActionSession,isSameOriginActionRequest} from '@/lib/wms/noidb-action-auth';
import {createInboundTransactionStore} from '@/lib/wms/inbound-import-store';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=180;
async function lineFor(id:string){const s=await readPickingWaveStore();const lines=s.vendorOrderLines.filter(l=>l.id===id);if(lines.length!==1||!s.vendorOrderDrafts.some(d=>d.id===lines[0].draftId))throw new Error('입고할 발주 품목을 다시 선택해 주세요.');return lines[0];}
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:NextRequest){try{return json({success:true,line:await lineFor(request.nextUrl.searchParams.get('lineId')||'')});}catch{return json({success:false,error:'입고할 발주 품목을 불러오지 못했습니다.'},400);}}
export async function POST(request:NextRequest){
 const body=await request.json().catch(()=>null);
 if(!body||!['preview','save','cost-preview','cost-apply','complete-preview','complete'].includes(body.action)||typeof body.lineId!=='string')return json({success:false,error:'입고 내용을 다시 확인해 주세요.'},400);
 if(!isSameOriginActionRequest(request))return json({success:false,error:'거래처 발주서에서 다시 시도해 주세요.'},403);
 if(['save','cost-apply'].includes(body.action)&&(!hasNoidbActionSession(request)||body.confirmed!==true))return json({success:false,error:'변경 내용을 확인하고 관리자 잠금을 해제해 주세요.'},401);
 // Completion only records this order's receipt; it never writes to the product DB.
 if(body.action==='complete'&&body.confirmed!==true)return json({success:false,error:'입고완료 내용을 확인해 주세요.'},400);
 try{
  // Fastest path (2026-10-21): the dialog sends the updatedAt/quantity it showed, so the store is read
  // only once (inside the save) instead of a separate read before it.
  if(body.action==='complete'&&typeof body.expectedUpdatedAt==='string'&&Number.isSafeInteger(body.expectedQuantity)&&typeof body.isStockReplenishment==='boolean'){
   const snapshot=await mutatePickingWaveStore({action:'completeVendorReceivingById',lineId:body.lineId,expectedUpdatedAt:body.expectedUpdatedAt,expectedQuantity:body.expectedQuantity,isStockReplenishment:body.isStockReplenishment,now:new Date().toISOString()});
   const line=snapshot.vendorOrderLines.find(item=>item.id===body.lineId);if(!line)throw new Error('입고할 발주 품목을 다시 선택해 주세요.');
   return json({success:true,line});
  }
  if(body.action==='complete-preview'||body.action==='complete'){
   const before=await lineFor(body.lineId),preview=completeReceivingPlan(before,body.isStockReplenishment);
   if(body.action==='complete-preview')return json({success:true,preview});
   // Fast path: the dialog already shows the line it was opened with, so it sends that line's
   // updatedAt/quantity instead of a separate preview round trip.
   const sameAsShown=typeof body.expectedUpdatedAt==='string'&&body.expectedUpdatedAt===before.updatedAt&&body.expectedQuantity===before.shortageQuantity;
   if(!preview.alreadyCompleted&&!sameAsShown&&body.token!==preview.token)throw new Error('확인 후 발주 품목이 변경되었습니다. 입고완료 내용을 다시 확인해 주세요.');
   // No Google Sheets lock here: completion never touches the product DB, and the blob store write
   // is already guarded by its ETag retry plus completeReceivingLine's change check.
   const snapshot=await mutatePickingWaveStore({action:'completeVendorReceiving',before,isStockReplenishment:body.isStockReplenishment,now:new Date().toISOString()});
   return json({success:true,line:snapshot.vendorOrderLines.find(line=>line.id===before.id)});
  }
  if(body.action==='cost-preview'){const p=await loadReceivingCostPlan(body.lineId);return json({success:true,preview:{token:p.token,skuId:p.skuId,before:p.before,after:p.after,vat:p.vat,quantity:p.quantity,unitPrice:p.unitPrice,alreadyApplied:p.alreadyApplied}});}
  if(body.action==='cost-apply'){const applied=await applyReceivingCostPlan(body.lineId,String(body.token||''));
  // 2026-10-23: 같은 모델(전 탭) 원가도 같은 값으로 맞춘다. 실패해도 이 SKU 원가 저장은 끝난 것이라 안내만.
  const sameModel=applied.skuId&&applied.after?await updateCostForSameModel(String(applied.skuId),String(applied.after)).catch(error=>({success:false,error:String(error)})):null;
  return json({success:true,...applied,sameModel});}
  const input={quantity:body.quantity,unitPrice:body.unitPrice,usedImmediately:body.usedImmediately};const before=await lineFor(body.lineId);const preview=simpleReceivingPlan(before,input);
  if(body.action==='preview')return json({success:true,preview});
  if(body.token!==preview.token)throw new Error('확인 후 발주 품목이 변경되었습니다. 다시 확인해 주세요.');
  const lock=createInboundTransactionStore(),lockId=await lock.acquire();
  try{const snapshot=await mutatePickingWaveStore({action:'saveSimpleReceiving',before,input,now:new Date().toISOString()});return json({success:true,line:snapshot.vendorOrderLines.find(l=>l.id===before.id)});}finally{await lock.release(lockId);}
 }catch(error){const message=error instanceof Error?error.message:'입고 처리 결과를 확인해 주세요.';return json({success:false,error:/GOOGLE_|BLOB_|https?:\/\/|HTTP [45]\d\d/i.test(message)?'입고 저장소의 연결을 확인해 주세요.':message},409);}
}
