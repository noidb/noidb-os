import {createHash} from 'node:crypto';
import {calculateReceivingCost} from './receiving-cost';
import type {VendorOrderDraftLine} from './vendor-order/types';
export interface SimpleReceivingInput {quantity:number;unitPrice:number;usedImmediately:boolean}
export function assertReceivingRecordPreserved(current:VendorOrderDraftLine|undefined,incoming:VendorOrderDraftLine){
 if(!current?.receivingHistory?.length)return;
 const fields=['receivedQuantity','receivedUnitPrice','receivedVat','receivedCostVatIncluded','receivedUsedImmediatelyAt','receivingHistory'] as const;
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
 return {...current,receivedQuantity:p.quantity,receivedUnitPrice:p.unitPrice,receivedVat:p.vat,receivedCostVatIncluded:p.costVatIncluded,receivedUsedImmediatelyAt:p.usedImmediately?now:undefined,receivedCostAppliedAt:undefined,updatedAt:now,receivingHistory:[...(receivingHistory||[]),{savedAt:now,record:backup}]};
}
