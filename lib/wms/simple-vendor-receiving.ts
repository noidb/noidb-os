import {createHash} from 'node:crypto';
import {calculateReceivingCost} from './receiving-cost';
import type {VendorOrderDraftLine} from './vendor-order/types';
export interface SimpleReceivingInput {quantity:number;unitPrice:number;usedImmediately:boolean}
export function assertReceivingRecordPreserved(current:VendorOrderDraftLine|undefined,incoming:VendorOrderDraftLine){
 if(!current?.receivingHistory?.length)return;
 const fields=['receivedQuantity','receivedUnitPrice','receivedVat','receivedCostVatIncluded','receivedUsedImmediatelyAt','receivingHistory','receivingCompletedAt','receivingCompletionToken','isStockReplenishment'] as const;
 if(fields.some(key=>JSON.stringify(current[key])!==JSON.stringify(incoming[key])))throw new Error('간단 입고기록이 변경되었습니다. 발주서를 새로 열어 주세요.');
}
export function simpleReceivingPlan(line:VendorOrderDraftLine,input:SimpleReceivingInput){
 if(!Number.isSafeInteger(input.quantity)||input.quantity<0||input.quantity>line.shortageQuantity||!Number.isSafeInteger(input.unitPrice)||input.unitPrice<0||input.unitPrice>1_000_000_000||typeof input.usedImmediately!=='boolean')throw new Error('받은 수량과 입고단가를 확인해 주세요.');
 const cost=calculateReceivingCost(input.unitPrice);
 const token=createHash('sha256').update(JSON.stringify([line,input])).digest('hex');
 return {token,skuId:line.skuId,beforeQuantity:line.receivedQuantity||0,quantity:input.quantity,beforeUnitPrice:line.receivedUnitPrice||0,unitPrice:input.unitPrice,usedImmediately:input.usedImmediately,...cost};
}
export function saveSimpleReceivingLine(current:VendorOrderDraftLine,before:VendorOrderDraftLine,input:SimpleReceivingInput,now:string):VendorOrderDraftLine{
 if(JSON.stringify(current)!==JSON.stringify(before))throw new Error('다른 기기에서 발주서가 변경되었습니다. 다시 확인해 주세요.');
 const p=simpleReceivingPlan(current,input);const {receivingHistory,...backup}=current;
 return {...current,receivedQuantity:p.quantity,receivedUnitPrice:p.unitPrice,receivedVat:p.vat,receivedCostVatIncluded:p.costVatIncluded,receivedUsedImmediatelyAt:p.usedImmediately?now:undefined,receivedCostAppliedAt:undefined,receivingCompletedAt:p.quantity>=current.shortageQuantity?current.receivingCompletedAt:undefined,receivingCompletionToken:p.quantity>=current.shortageQuantity?current.receivingCompletionToken:undefined,updatedAt:now,receivingHistory:[...(receivingHistory||[]),{savedAt:now,record:backup}]};
}

export function completeReceivingPlan(line:VendorOrderDraftLine,isStockReplenishment:boolean){
 if(typeof isStockReplenishment!=='boolean'||!Number.isSafeInteger(line.shortageQuantity)||line.shortageQuantity<=0)throw new Error('입고완료할 주문수량과 재고보충 여부를 확인해 주세요.');
 const alreadyCompleted=Boolean(line.receivingCompletedAt&&line.receivingCompletionToken&&line.receivedQuantity===line.shortageQuantity&&Boolean(line.isStockReplenishment)===isStockReplenishment);
 return {token:alreadyCompleted?line.receivingCompletionToken!:createHash('sha256').update(JSON.stringify(['complete-receiving',line,isStockReplenishment])).digest('hex'),skuId:line.skuId,beforeQuantity:line.receivedQuantity||0,quantity:line.shortageQuantity,isStockReplenishment,alreadyCompleted};
}
export function completeReceivingLine(current:VendorOrderDraftLine,before:VendorOrderDraftLine,isStockReplenishment:boolean,now:string):VendorOrderDraftLine{
 const requested=completeReceivingPlan(before,isStockReplenishment);
 if(current.receivingCompletionToken===requested.token&&current.receivedQuantity===current.shortageQuantity&&Boolean(current.isStockReplenishment)===isStockReplenishment)return current;
 if(JSON.stringify(current)!==JSON.stringify(before))throw new Error('다른 기기에서 발주 품목이 변경되었습니다. 입고완료 내용을 다시 확인해 주세요.');
 const {receivingHistory,...backup}=current;
 return {...current,isStockReplenishment,receivedQuantity:current.shortageQuantity,receivingCompletedAt:now,receivingCompletionToken:requested.token,reorderPendingQuantity:0,reorderRequestedAt:undefined,updatedAt:now,receivingHistory:[...(receivingHistory||[]),{savedAt:now,record:backup}]};
}
