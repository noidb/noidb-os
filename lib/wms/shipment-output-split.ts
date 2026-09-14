import type { PurchaseOrderSourceDocument } from "./purchase-order-source/types";
export const DEFAULT_MAX_INVOICE_QUANTITY = 250;
export interface ShipmentOutputDocumentBatch { documents: PurchaseOrderSourceDocument[]; totalQuantity: number; manualReviewRequired: boolean }
const quantity=(d:PurchaseOrderSourceDocument)=>d.records.reduce((s,r)=>s+(Number.isFinite(r.orderedQuantity)?r.orderedQuantity:0),0);
/** Balance whole POs within one verified destination. Oversized single POs remain blocked. */
export function splitShipmentOutputDocuments(source:readonly PurchaseOrderSourceDocument[],maxTotalQuantity=DEFAULT_MAX_INVOICE_QUANTITY):ShipmentOutputDocumentBatch[]{
 if(!Number.isInteger(maxTotalQuantity)||maxTotalQuantity<1)throw new Error('송장 최대수량은 1 이상의 정수여야 합니다.');
 const sorted=[...source].sort((a,b)=>quantity(b)-quantity(a)||a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber));
 const regular=sorted.filter(d=>quantity(d)<=maxTotalQuantity),oversized=sorted.filter(d=>quantity(d)>maxTotalQuantity);
 let result:ShipmentOutputDocumentBatch[]=[];
 for(let count=Math.max(1,Math.ceil(regular.reduce((s,d)=>s+quantity(d),0)/maxTotalQuantity));count<=Math.max(1,regular.length);count++){
  const bins:ShipmentOutputDocumentBatch[]=Array.from({length:count},()=>({documents:[],totalQuantity:0,manualReviewRequired:false}));let fits=true;
  for(const doc of regular){const bin=[...bins].sort((a,b)=>a.totalQuantity-b.totalQuantity).find(b=>b.totalQuantity+quantity(doc)<=maxTotalQuantity);if(!bin){fits=false;break;}bin.documents.push(doc);bin.totalQuantity+=quantity(doc);}
  if(fits){result=bins.filter(b=>b.documents.length);break;}
 }
 return [...result,...oversized.map(d=>({documents:[d],totalQuantity:quantity(d),manualReviewRequired:true}))];
}
export function validateInvoiceGroups(groups:unknown,documents:readonly PurchaseOrderSourceDocument[],destinationByPo:Map<string,string>):string[][]{
 if(!Array.isArray(groups)||!groups.length||groups.some(g=>!Array.isArray(g)||!g.length||g.some(po=>typeof po!=='string')))throw new Error('송장 묶음을 다시 확인해 주세요.');
 const plan=groups as string[][],flat=plan.flat(),docs=new Map(documents.map(d=>[d.purchaseOrderNumber,d]));
 if(new Set(flat).size!==flat.length||flat.length!==docs.size||flat.some(po=>!docs.has(po)))throw new Error('송장 묶음에 발주 누락·중복 또는 다른 발주가 있습니다.');
 for(const group of plan){if(new Set(group.map(po=>destinationByPo.get(po))).size!==1)throw new Error('센터·입고예정일·배송지가 다른 발주는 같은 송장으로 합칠 수 없습니다.');if(group.reduce((s,po)=>s+quantity(docs.get(po)!),0)>DEFAULT_MAX_INVOICE_QUANTITY)throw new Error('송장 묶음은 총수량 250개 이하로 조정해 주세요.');}
 return plan.map(g=>[...g]);
}
