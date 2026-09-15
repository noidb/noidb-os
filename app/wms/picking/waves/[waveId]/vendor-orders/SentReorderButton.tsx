"use client";
import { useState } from "react";
import type { VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import { wmsSageButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
type Preview={token:string;skuId:string;quantity:number;linkedFromSku:boolean;purchaseOrderNumbers:string[];rows:Array<{purchaseOrderNumber:string;shortageQuantity:number}>};
export default function SentReorderButton({line,onSaved}:{line:VendorOrderDraftLine;onSaved:(line:VendorOrderDraftLine)=>void}){
 const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[preview,setPreview]=useState<Preview|null>(null);
 async function load(){setBusy(true);setError("");setPreview(null);try{const r=await fetch('/api/wms/vendor-orders/reorder?lineId='+encodeURIComponent(line.id),{cache:'no-store'}),d=await r.json();if(!r.ok||!d.success)throw Error(d.error||'확인 실패');setPreview(d.preview);}catch(e){setError(e instanceof Error?e.message:'확인 실패');}finally{setBusy(false);}}
 async function save(){if(!preview||busy)return;setBusy(true);setError("");try{const r=await fetch('/api/wms/vendor-orders/reorder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lineId:line.id,expectedUpdatedAt:line.updatedAt,token:preview.token,purchaseOrderNumbers:preview.purchaseOrderNumbers,confirmed:true})}),d=await r.json();if(!r.ok||!d.success||!d.line)throw Error(d.error||'이동 결과를 확인하지 못했습니다.');onSaved(d.line);setOpen(false);}catch(e){setError(e instanceof Error?e.message:'이동 실패');}finally{setBusy(false);}}
 return <><button type="button" style={{...wmsSageButton,width:'100%',minHeight:44,marginBottom:8}} onClick={()=>{setOpen(true);void load();}}>재발주요청으로 이동</button>
 {open&&<div style={{position:'fixed',inset:0,zIndex:1200,background:'#0008',padding:12,display:'grid',placeItems:'center'}}><section role="dialog" aria-modal="true" aria-label="입고 후 재발주요청" style={{width:'100%',maxWidth:440,maxHeight:'85dvh',overflowY:'auto',boxSizing:'border-box',borderRadius:14,padding:18,background:'white'}}>
 <h3>입고 후 재발주요청</h3><p>{line.productName}<br/>SKU {line.skuId}</p>
 {preview&&<>{preview.linkedFromSku&&<p style={{color:'#934633'}}>직접 추가한 상품의 SKU로 저장된 미입고 자료를 찾았습니다. 아래 발주번호와 수량이 맞는지 확인해 주세요.</p>}<table style={{width:'100%',fontSize:14}}><thead><tr><th>쿠팡 발주번호</th><th>미입고 수량</th></tr></thead><tbody>{preview.rows.map(row=><tr key={row.purchaseOrderNumber}><td>{row.purchaseOrderNumber}</td><td style={{textAlign:'center'}}>{row.shortageQuantity}개</td></tr>)}</tbody></table><p><strong>재발주요청 {preview.quantity}개</strong> · 거래처 주문 {line.shortageQuantity}개</p><p>제품이 입고된 것을 확인하면 기존 재발주 대기에 취합하고 이 발주서 목록에서 제외합니다.</p></>}
 {error&&<p role="alert" style={{color:'#b42318'}}>{error}</p>}{busy&&<p role="status">처리 중…</p>}
 <button type="button" style={{...wmsSageButton,width:'100%',minHeight:46}} disabled={busy||!preview} onClick={()=>void save()}>입고 확인 · 재발주요청으로 이동</button>
 {error&&<button type="button" style={wmsGhostButton} disabled={busy} onClick={()=>void load()}>자료 다시 확인</button>}<button type="button" style={{...wmsGhostButton,width:'100%',minHeight:44}} disabled={busy} onClick={()=>setOpen(false)}>취소</button>
 </section></div>}</>;
}
