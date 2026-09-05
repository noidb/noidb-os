"use client";
import {useEffect,useState} from 'react';
import {ensureNoidbActionSession} from '@/lib/wms/noidb-action-session-client';
import type {VendorOrderDraftLine} from '@/lib/wms/vendor-order/types';
import {wmsGhostButton,wmsPrimaryButton,wmsColors} from '@/lib/wms/ui-tokens';
interface Preview {token:string;skuId:string;beforeQuantity?:number;quantity:number;beforeUnitPrice?:number;unitPrice:number;usedImmediately?:boolean;vat:number;costVatIncluded?:number;before?:string;after?:number;alreadyApplied?:boolean}
export default function SimpleReceiving({lineId,onSaved}:{lineId:string;onSaved:(line:VendorOrderDraftLine)=>void}){
 const [open,setOpen]=useState(false),[line,setLine]=useState<VendorOrderDraftLine|null>(null),[quantity,setQuantity]=useState(''),[price,setPrice]=useState(''),[immediate,setImmediate]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[mode,setMode]=useState<'receipt'|'cost'>('receipt');
 const fill=(value:VendorOrderDraftLine)=>{setLine(value);setQuantity(String(value.receivedQuantity||0));setPrice(String(value.receivedUnitPrice||0));setImmediate(Boolean(value.receivedUsedImmediatelyAt));};
 useEffect(()=>{if(!open)return;let active=true;setBusy(true);void fetch('/api/wms/simple-receiving?lineId='+encodeURIComponent(lineId),{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error);if(active)fill(d.line);}).catch(e=>{if(active)setMessage(e.message||'입고 정보를 확인해 주세요.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[open,lineId]);
 async function run(action:'preview'|'save'|'cost-preview'|'cost-apply'){
  if(busy)return;setBusy(true);setMessage('');
  try{
   if((action==='save'||action==='cost-apply')&&!await ensureNoidbActionSession())return;
   if((action==='preview'||action==='save')&&(!quantity.trim()||!price.trim()))throw new Error('받은 수량과 단가를 입력해 주세요.');
   const r=await fetch('/api/wms/simple-receiving',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,lineId,quantity:Number(quantity),unitPrice:Number(price),usedImmediately:immediate,token:preview?.token,confirmed:action==='save'||action==='cost-apply'})});
   const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'처리 결과를 확인하지 못했습니다.');
   if(d.preview){setMode(action==='cost-preview'?'cost':'receipt');setPreview(d.preview);}
   else{setPreview(null);if(d.line){fill(d.line);onSaved(d.line);}setMessage(action==='save'?'입고기록 저장완료 · 제품DB 원가는 아래에서 별도로 확인합니다.':d.alreadyApplied?'이미 반영된 입고원가입니다.':'백업 후 제품DB 원가 반영완료');}
  }catch(e){setPreview(null);setMessage(e instanceof Error?e.message:'처리 결과 확인이 필요합니다.');}finally{setBusy(false);}
 }
 const inputStyle={width:'100%',boxSizing:'border-box' as const,minHeight:42,border:`1px solid ${wmsColors.border}`,borderRadius:6,padding:8};
 const savedValues=line&&Number(quantity)===(line.receivedQuantity||0)&&Number(price)===(line.receivedUnitPrice||0);
 return <section style={{marginTop:12,fontSize:12,overflowWrap:'anywhere'}}><button type='button' style={wmsGhostButton} onClick={()=>setOpen(v=>!v)} disabled={busy}>{open?'간단 입고 접기':'간단 입고'}</button>{open&&<div style={{padding:12,border:`1px solid ${wmsColors.border}`,borderRadius:10,marginTop:8}}>
  {line&&<><strong>SKU {line.skuId} · 발주 {line.shortageQuantity}개</strong><p>받은 수량은 이번 발주서의 누적 수량입니다.</p><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}><label>누적 받은 수량<input aria-label='누적 받은 수량' type='number' min={0} max={line.shortageQuantity} value={quantity} onChange={e=>{setQuantity(e.target.value);setPreview(null);}} style={inputStyle}/></label><label>입고단가(부가세 별도)<input aria-label='입고단가 부가세 별도' type='number' min={0} value={price} onChange={e=>{setPrice(e.target.value);setPreview(null);}} style={inputStyle}/></label></div><label style={{display:'block',margin:'12px 0'}}><input type='checkbox' checked={immediate} onChange={e=>{setImmediate(e.target.checked);setPreview(null);}}/> 즉시투입 완료</label><p>수량을 기록해도 현재고·피킹수량은 자동 변경하지 않습니다.</p><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button disabled={busy} onClick={()=>void run('preview')} style={wmsGhostButton}>입고 변경 확인</button><button disabled={busy||!savedValues||Number(price)<=0||Number(quantity)<=0} onClick={()=>void run('cost-preview')} style={wmsGhostButton}>제품DB 원가 확인</button></div></>}
  {preview&&<div role='region' aria-label='입고 변경 미리보기' style={{marginTop:12,padding:12,background:wmsColors.surfaceBeige,borderRadius:8}}>{mode==='receipt'?<><p>받은 수량 {preview.beforeQuantity} → {preview.quantity}개</p><p>입고단가 {preview.beforeUnitPrice} → {preview.unitPrice}원</p><p>부가세 {preview.vat}원 · 부가세 포함 {preview.costVatIncluded}원</p><p>기존 입고기록을 백업하고 이 품목의 입고정보만 저장합니다.</p></>:<><p>SKU {preview.skuId} 원가 {preview.before||'빈칸'} → {preview.after}원</p><p>입고단가 {preview.unitPrice}원 + 부가세 {preview.vat}원</p><p>제품DB와 원가이력을 백업한 뒤 해당 원가 1셀과 이력만 저장합니다.</p></>}{preview.alreadyApplied?<p>이미 반영된 입고원가입니다.</p>:<button disabled={busy} onClick={()=>void run(mode==='receipt'?'save':'cost-apply')} style={wmsPrimaryButton}>{mode==='receipt'?'확인 · 입고기록 저장':'확인 · 백업 후 원가 반영'}</button>}<button disabled={busy} onClick={()=>setPreview(null)} style={{...wmsGhostButton,marginLeft:8}}>취소</button></div>}
  {busy&&<p role='status'>처리 중...</p>}{message&&<p role='status'>{message}</p>}
 </div>}</section>;
}
