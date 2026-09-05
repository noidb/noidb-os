import {createHash,randomInt} from 'node:crypto';
import {fetchSheetRows,fetchExistingSheetRows,getWmsSpreadsheetId} from './google-sheets';
import {getWmsGoogleAccessToken} from './google-service-account';
import {readPickingWaveStore} from './picking-wave/server-store';
import {createInboundTransactionStore} from './inbound-import-store';
import {InboundCommitUncertainError} from './inbound-import-transaction';
import {RECEIVING_COST_HEADERS,RECEIVING_COST_SHEET} from './vendor-order-actions';
import {simpleReceivingPlan} from './simple-vendor-receiving';
import type {VendorOrderDraftLine} from './vendor-order/types';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function buildReceivingCostPlan(line:VendorOrderDraftLine,products:string[][],history:string[][]){
 const input={quantity:line.receivedQuantity||0,unitPrice:line.receivedUnitPrice||0,usedImmediately:Boolean(line.receivedUsedImmediatelyAt)};
 const calculated=simpleReceivingPlan(line,input);if(input.quantity<=0||input.unitPrice<=0)throw new Error('받은 수량과 입고단가를 먼저 저장해 주세요.');
 const headers=(products[0]||[]).map(String);const skuColumn=headers.indexOf('SKU ID'),column=headers.indexOf('원가(부가세포함)');
 if(skuColumn<0||column<0||headers.lastIndexOf('SKU ID')!==skuColumn||headers.lastIndexOf('원가(부가세포함)')!==column)throw new Error('제품DB의 SKU와 원가 열을 확인해 주세요.');
 const matches=products.map((row,index)=>({row,index})).filter((v)=>v.index>0&&String(v.row[skuColumn]).trim()===line.skuId);
 if(matches.length!==1)throw new Error('원가를 반영할 제품DB의 한 행을 특정하지 못했습니다.');
 const before=String(matches[0].row[column]??'');if(before.startsWith('=')||(before!==''&&!/^\d+(?:\.\d+)?$/.test(before)))throw new Error('원가 셀의 수식 또는 값을 확인해 주세요.');
 const eventId=`cost:${line.draftId}:${line.id}:${input.quantity}:${input.unitPrice}`;
 return {line,products,history,eventId,token:hash([line,products,history]),skuId:line.skuId,row:matches[0].index+1,column:column+1,before,after:calculated.costVatIncluded,vat:calculated.vat,unitPrice:input.unitPrice,quantity:input.quantity,alreadyApplied:history.slice(1).some(r=>String(r[0])===eventId)};
}
export type ReceivingCostPlan=ReturnType<typeof buildReceivingCostPlan>;
export async function loadReceivingCostPlan(lineId:string){
 const [snapshot,products,history]=await Promise.all([readPickingWaveStore(),fetchSheetRows('제품DB',{valueRenderOption:'FORMULA'}),fetchExistingSheetRows(RECEIVING_COST_SHEET,{expectedHeaders:RECEIVING_COST_HEADERS})]);
 const matches=snapshot.vendorOrderLines.filter(l=>l.id===lineId);if(matches.length!==1||!snapshot.vendorOrderDrafts.some(d=>d.id===matches[0].draftId))throw new Error('입고할 발주 품목을 다시 선택해 주세요.');
 return buildReceivingCostPlan(matches[0],products,history);
}
async function request(path:string,body?:unknown){return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${getWmsSpreadsheetId()}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${await getWmsGoogleAccessToken()}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});}
export function buildReceivingCostRequests(p:ReceivingCostPlan,productId:number,historyId:number,historyExists:boolean,lockId:number,backupIds:number[],now:string){
 const requests:any[]=[{duplicateSheet:{sourceSheetId:productId,newSheetId:backupIds[0],newSheetName:`_원가백업_DB_${p.token}`}},{updateSheetProperties:{properties:{sheetId:backupIds[0],hidden:true},fields:'hidden'}}];
 if(historyExists)requests.push({duplicateSheet:{sourceSheetId:historyId,newSheetId:backupIds[1],newSheetName:`_원가백업_이력_${p.token}`}},{updateSheetProperties:{properties:{sheetId:backupIds[1],hidden:true},fields:'hidden'}});
 else requests.push({addSheet:{properties:{sheetId:historyId,title:RECEIVING_COST_SHEET,hidden:true,gridProperties:{rowCount:1000,columnCount:11}}}},{updateCells:{start:{sheetId:historyId,rowIndex:0,columnIndex:0},rows:[{values:RECEIVING_COST_HEADERS.map(stringValue=>({userEnteredValue:{stringValue}}))}],fields:'userEnteredValue'}});
 const values=[p.eventId,p.line.relatedPurchaseOrderNumbers.join(','),p.line.id,p.skuId,p.unitPrice,p.vat,p.after,p.quantity,now,'NOID-B 관리자',p.before];
 requests.push({appendCells:{sheetId:historyId,rows:[{values:values.map(v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:v}}))}],fields:'userEnteredValue'}},
 {updateCells:{range:{sheetId:productId,startRowIndex:p.row-1,endRowIndex:p.row,startColumnIndex:p.column-1,endColumnIndex:p.column},rows:[{values:[{userEnteredValue:{numberValue:p.after}}]}],fields:'userEnteredValue'}},
 {deleteSheet:{sheetId:lockId}});
 return requests;
}
export async function applyReceivingCostPlan(lineId:string,expectedToken:string,deps={load:loadReceivingCostPlan,request,lock:createInboundTransactionStore()}){
 if(!/^[a-f0-9]{64}$/.test(expectedToken))throw new Error('원가 변경 내용을 먼저 확인해 주세요.');
 const lockId=await deps.lock.acquire();let sent=false,needsRelease=true;
 try{
  const p=await deps.load(lineId);if(p.alreadyApplied){needsRelease=false;await deps.lock.release(lockId);return {applied:true,alreadyApplied:true};}
  if(p.token!==expectedToken)throw new Error('확인 후 입고기록 또는 제품DB가 변경되었습니다. 다시 확인해 주세요.');
  const meta=await deps.request('?fields=sheets.properties');if(!meta.ok)throw new Error('원가 저장소 연결을 확인해 주세요.');
  const tabs=(await meta.json()).sheets.map((s:any)=>s.properties),product=tabs.find((t:any)=>t.title==='제품DB'),history=tabs.find((t:any)=>t.title===RECEIVING_COST_SHEET);
  if(!product||!tabs.some((t:any)=>t.sheetId===lockId))throw new Error('원가 저장 대상이 변경되었습니다.');
  let col=p.column,letter='';while(col){letter=String.fromCharCode(65+(col-1)%26)+letter;col=Math.floor((col-1)/26);}
  const cells=await deps.request(`?ranges=${encodeURIComponent(`'제품DB'!${letter}${p.row}`)}&includeGridData=true&fields=sheets(data(rowData(values(dataValidation,userEnteredValue))))`);if(!cells.ok)throw new Error('원가 셀 형식을 확인하지 못했습니다.');
  const cell=(await cells.json()).sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0];if(cell?.dataValidation||cell?.userEnteredValue?.formulaValue)throw new Error('원가 셀에 수식 또는 입력 제한이 있습니다.');
  const latest=await deps.load(lineId);if(latest.token!==p.token)throw new Error('저장 직전 입고기록 또는 원가가 변경되었습니다.');
  const ids=new Set<number>(tabs.map((t:any)=>t.sheetId));const id=()=>{let n=randomInt(100_000_000,1_900_000_000);while(ids.has(n))n++;ids.add(n);return n;};
  const requests=buildReceivingCostRequests(p,product.sheetId,history?.sheetId??id(),Boolean(history),lockId,[id(),id()],new Date().toISOString());
  sent=true;const response=await deps.request(':batchUpdate',{requests});
  if(!response.ok){if(response.status>=400&&response.status<500&&response.status!==408)sent=false;throw new Error('원가 저장 요청이 완료되지 않았습니다.');}
  const verified=await deps.load(lineId);if(!verified.alreadyApplied||Number(verified.before)!==p.after)throw new Error('저장 후 원가 대조가 필요합니다.');
  return {applied:true,alreadyApplied:false,skuId:p.skuId,after:p.after};
 }catch(error){if(!sent&&needsRelease)await deps.lock.release(lockId);if(sent)throw new InboundCommitUncertainError('원가 저장 결과 확인이 필요합니다. 자동 재시도하지 않습니다.');throw error;}
}
