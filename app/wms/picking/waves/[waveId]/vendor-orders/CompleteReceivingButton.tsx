"use client";
import { useState } from "react";
import type { VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import { wmsColors, wmsGhostButton, wmsPrimaryButton } from "@/lib/wms/ui-tokens";
type Preview = { token: string; beforeQuantity: number; quantity: number; isStockReplenishment: boolean };
export default function CompleteReceivingButton({ line, onSaved, stockOnly=false }: { line: VendorOrderDraftLine; onSaved: (line: VendorOrderDraftLine) => void; stockOnly?:boolean }) {
  const [open, setOpen] = useState(false), [stock, setStock] = useState(Boolean(line.isStockReplenishment)), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  async function prepare(value: boolean) {
    setBusy(true); setError(""); setPreview(null);
    try { const r=await fetch('/api/wms/simple-receiving',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'complete-preview',lineId:line.id,isStockReplenishment:value})});const d=await r.json();if(!r.ok||!d.success)throw Error(d.error||'입고완료 내용을 확인하지 못했습니다.');setPreview(d.preview); }
    catch(e){setError(e instanceof Error?e.message:'입고완료 확인 실패');}finally{setBusy(false);}
  }
  async function complete(){
    if(!preview||busy)return;setBusy(true);setError('');
    try{const r=await fetch('/api/wms/simple-receiving',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'complete',lineId:line.id,isStockReplenishment:preview.isStockReplenishment,token:preview.token,confirmed:true})});const d=await r.json();if(!r.ok||!d.success||!d.line)throw Error(d.error||'입고완료 저장 실패');setOpen(false);onSaved(d.line);}
    catch(e){setPreview(null);setError(e instanceof Error?e.message:'입고완료 저장 실패');}finally{setBusy(false);}
  }
  return <>
    <button type="button" disabled={busy} style={{...wmsPrimaryButton,minHeight:'44px',fontSize:'13px',width:'100%'}} onClick={()=>{setOpen(true);setStock(stockOnly||Boolean(line.isStockReplenishment));void prepare(stockOnly||Boolean(line.isStockReplenishment));}}>{stockOnly?'보충분 입고완료':'입고완료'}</button>
    {open&&<div style={{position:'fixed',inset:0,zIndex:85,background:'rgba(37,37,37,.6)',display:'flex',alignItems:'center',justifyContent:'center',padding:12}}><section role="dialog" aria-modal="true" aria-label="입고완료 확인" style={{width:'100%',maxWidth:420,maxHeight:'85dvh',overflowY:'auto',boxSizing:'border-box',background:'white',borderRadius:14,padding:18}}>
      <h3>입고완료</h3><strong>SKU {line.skuId} · {line.productName}</strong>
      {preview&&<p>누적 받은 수량 {preview.beforeQuantity} → {preview.quantity}개</p>}
      {stockOnly?<p>이 상품은 보충분으로 입고완료 처리합니다.</p>:<label style={{display:'flex',alignItems:'center',gap:8,minHeight:44,fontSize:14}}><input type="checkbox" checked={stock} disabled={busy} onChange={e=>{setStock(e.target.checked);void prepare(e.target.checked);}} style={{width:22,height:22}}/>재고보충 주문 (재발주요청 제외)</label>}
      <p style={{fontSize:13,lineHeight:1.6}}>{stock?'입고완료 후 진행 발주 목록에서 빠지고 입고이력에 남습니다.':'입고기록을 저장합니다. 미입고분에서 온 상품은 재발주요청으로 이동해 취합하세요.'}</p>
      <p style={{fontSize:12,color:wmsColors.muted}}>제품DB 현재고와 원가는 변경하지 않습니다.</p>
      {error&&<p role="alert" style={{color:wmsColors.warn}}>{error}</p>}{busy&&<p role="status">확인 중…</p>}
      <div style={{display:'flex',gap:8}}><button type="button" disabled={busy} onClick={()=>setOpen(false)} style={{...wmsGhostButton,flex:1}}>취소</button><button type="button" disabled={busy||!preview} onClick={()=>void complete()} style={{...wmsPrimaryButton,flex:1}}>확인 · 입고완료</button></div>
    </section></div>}
  </>;
}
