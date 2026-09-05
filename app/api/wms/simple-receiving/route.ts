import {NextRequest,NextResponse} from 'next/server';
import {readPickingWaveStore,mutatePickingWaveStore} from '@/lib/wms/picking-wave/server-store';
import {simpleReceivingPlan} from '@/lib/wms/simple-vendor-receiving';
import {loadReceivingCostPlan,applyReceivingCostPlan} from '@/lib/wms/simple-receiving-cost';
import {hasNoidbActionSession,isSameOriginActionRequest} from '@/lib/wms/noidb-action-auth';
import {createInboundTransactionStore} from '@/lib/wms/inbound-import-store';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=180;
async function lineFor(id:string){const s=await readPickingWaveStore();const lines=s.vendorOrderLines.filter(l=>l.id===id);if(lines.length!==1||!s.vendorOrderDrafts.some(d=>d.id===lines[0].draftId))throw new Error('입고할 발주 품목을 다시 선택해 주세요.');return lines[0];}
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:NextRequest){try{return json({success:true,line:await lineFor(request.nextUrl.searchParams.get('lineId')||'')});}catch{return json({success:false,error:'입고할 발주 품목을 불러오지 못했습니다.'},400);}}
export async function POST(request:NextRequest){
 const body=await request.json().catch(()=>null);
 if(!body||!['preview','save','cost-preview','cost-apply'].includes(body.action)||typeof body.lineId!=='string')return json({success:false,error:'입고 내용을 다시 확인해 주세요.'},400);
 if(!isSameOriginActionRequest(request))return json({success:false,error:'거래처 발주서에서 다시 시도해 주세요.'},403);
 if(['save','cost-apply'].includes(body.action)&&(!hasNoidbActionSession(request)||body.confirmed!==true))return json({success:false,error:'변경 내용을 확인하고 관리자 잠금을 해제해 주세요.'},401);
 try{
  if(body.action==='cost-preview'){const p=await loadReceivingCostPlan(body.lineId);return json({success:true,preview:{token:p.token,skuId:p.skuId,before:p.before,after:p.after,vat:p.vat,quantity:p.quantity,unitPrice:p.unitPrice,alreadyApplied:p.alreadyApplied}});}
  if(body.action==='cost-apply')return json({success:true,...await applyReceivingCostPlan(body.lineId,String(body.token||''))});
  const input={quantity:body.quantity,unitPrice:body.unitPrice,usedImmediately:body.usedImmediately};const before=await lineFor(body.lineId);const preview=simpleReceivingPlan(before,input);
  if(body.action==='preview')return json({success:true,preview});
  if(body.token!==preview.token)throw new Error('확인 후 발주 품목이 변경되었습니다. 다시 확인해 주세요.');
  const lock=createInboundTransactionStore(),lockId=await lock.acquire();
  try{const snapshot=await mutatePickingWaveStore({action:'saveSimpleReceiving',before,input,now:new Date().toISOString()});return json({success:true,line:snapshot.vendorOrderLines.find(l=>l.id===before.id)});}finally{await lock.release(lockId);}
 }catch(error){const message=error instanceof Error?error.message:'입고 처리 결과를 확인해 주세요.';return json({success:false,error:/GOOGLE_|BLOB_|https?:\/\/|HTTP [45]\d\d/i.test(message)?'입고 저장소의 연결을 확인해 주세요.':message},409);}
}
