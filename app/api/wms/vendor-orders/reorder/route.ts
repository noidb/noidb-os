import { NextRequest, NextResponse } from "next/server";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { vendorReorderMaterial } from "@/lib/wms/vendor-order/reorder-material";
import { isVendorLineResolved } from "@/lib/wms/vendor-order/receiving-state";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { moveWorkListItem } from "@/lib/wms/work-list-routing";
export const runtime="nodejs",dynamic="force-dynamic",maxDuration=300;
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
async function prepare(lineId:string) {
  const [store,workspace]=await Promise.all([readPickingWaveStore(),readWeeklyWorkspace()]);
  const line=store.vendorOrderLines.find(l=>l.id===lineId);
  if(!line||isVendorLineResolved(line)||store.deletedVendorLineIds[line.id]||store.deletedVendorDraftIds[line.draftId]||!store.vendorOrderDrafts.some(d=>d.id===line.draftId&&d.status==="sent"))throw new Error("현재 처리할 전송완료 상품을 다시 확인해 주세요.");
  const plan=vendorReorderMaterial(workspace,line);
  return {line,preview:{token:plan.token,skuId:line.skuId,productName:line.productName,linkedFromSku:plan.linkedFromSku,purchaseOrderNumbers:plan.purchaseOrderNumbers,quantity:plan.item.shortageQuantity,rows:plan.item.shortageDetails,sourceDate:plan.snapshot.createdAt}};
}
export async function GET(request:NextRequest){try{return json({success:true,...await prepare(request.nextUrl.searchParams.get("lineId")||"")});}catch(e){return json({success:false,error:e instanceof Error?e.message:"미입고 자료를 확인하지 못했습니다."},409);}}
export async function POST(request:NextRequest){
  if(!isSameOriginActionRequest(request))return json({success:false,error:"거래처 발주 화면에서 진행해 주세요."},403);
  try{const body=await request.json();if(body.confirmed!==true||typeof body.lineId!=="string"||typeof body.expectedUpdatedAt!=="string"||typeof body.token!=="string"||!Array.isArray(body.purchaseOrderNumbers)||body.purchaseOrderNumbers.some((po:unknown)=>typeof po!=="string"))throw new Error("입고된 상품과 재발주요청 수량을 확인해 주세요.");
    const result=await moveWorkListItem("vendor",body.lineId,"reorder",body.expectedUpdatedAt,undefined,true,{token:body.token,purchaseOrderNumbers:body.purchaseOrderNumbers});
    const saved=await readPickingWaveStore();return json({success:true,...result,line:saved.vendorOrderLines.find(l=>l.id===body.lineId)});
  }catch(e){const message=e instanceof Error?e.message:"재발주요청으로 이동하지 못했습니다.";console.error("[vendor-reorder]",message);return json({success:false,error:message},409);}
}
