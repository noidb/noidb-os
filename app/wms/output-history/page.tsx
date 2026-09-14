"use client";
import {useEffect,useState} from 'react';
import type {SavedOutputFile} from '@/lib/wms/output-file-history';
import {wmsColors,wmsGhostButton} from '@/lib/wms/ui-tokens';
const categories=[['all','전체'],['po','발주확정'],['invoice','한진 송장'],['shipment','Shipment 업로드'],['output','Shipment 출력세트'],['discontinue','단종·해제'],['coupon','쿠폰·미입고']];
export default function OutputHistoryPage(){
 const [category,setCategory]=useState(''),[query,setQuery]=useState(''),[items,setItems]=useState<SavedOutputFile[]>([]),[warnings,setWarnings]=useState<string[]>([]),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0),[limit,setLimit]=useState(50);
 useEffect(()=>{if(!category){const initial=new URLSearchParams(window.location.search).get('category');setCategory(categories.some(([key])=>key===initial)?initial!:'all');return;}let active=true;setLoading(true);setItems([]);setWarnings([]);setLimit(50);
  void fetch('/api/wms/output-history?category='+encodeURIComponent(category),{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok||!d.success)throw new Error();if(active){setItems(d.items||[]);setWarnings(d.warnings||[]);}}).catch(()=>{if(active)setWarnings(['파일 이력을 불러오지 못했습니다. 다시 확인해 주세요.']);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[category,revision]);
 const filtered=items.filter(f=>f.name.toLowerCase().includes(query.trim().toLowerCase()));
 return <main style={{maxWidth:1000,margin:'0 auto',padding:'16px',boxSizing:'border-box',color:wmsColors.ink,overflowWrap:'anywhere'}}>
  <a href='/wms/work-center' style={{color:wmsColors.slateDark}}>← 작업센터</a><h1>생성파일 이력</h1>
  <p>Drive에 보관된 파일을 PC와 모바일에서 함께 확인합니다. 표시 날짜는 파일 수정일이며, 실제 외부 업로드 완료를 뜻하지 않습니다.</p>
  <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}><label>파일 종류 <select aria-label='파일 종류' value={category} onChange={e=>setCategory(e.target.value)} style={{minHeight:44,maxWidth:'100%'}}>{categories.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><button style={wmsGhostButton} onClick={()=>setRevision(v=>v+1)} disabled={loading}>새로 확인</button></div>
  <input aria-label='파일명 검색' placeholder='파일명·발주번호·날짜 검색' value={query} onChange={e=>{setQuery(e.target.value);setLimit(50);}} style={{boxSizing:'border-box',width:'100%',padding:12,marginBottom:12}}/>
  {warnings.map(w=><p role='alert' key={w}>{w} <a href='/wms/settings/folder-connections'>연결 확인</a></p>)}
  {loading?<p role='status'>보관된 파일을 확인하고 있습니다.</p>:<><p>{filtered.length}개 파일</p>{!filtered.length&&<p>조회된 파일이 없습니다.</p>}<div style={{display:'grid',gap:10}}>{filtered.slice(0,limit).map(file=><article key={file.category+file.id} style={{border:`1px solid ${wmsColors.border}`,borderRadius:12,padding:12,background:'#fff'}}><small>{file.categoryLabel} · {file.modifiedAt?new Date(file.modifiedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'날짜 확인 필요'}</small><p style={{margin:'8px 0'}}>{file.name}</p><a href={file.url} target='_blank' rel='noreferrer' style={{...wmsGhostButton,display:'inline-block',textDecoration:'none',minHeight:44,boxSizing:'border-box'}}>파일 열기·다운로드</a></article>)}</div>{filtered.length>limit&&<button onClick={()=>setLimit(v=>v+50)} style={{...wmsGhostButton,marginTop:12}}>50개 더 보기</button>}</>}
 </main>;
}
