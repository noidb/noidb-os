"use client";
import { useEffect, useState } from "react";
import type { PickingWaveStoreSnapshot } from "@/lib/wms/picking-wave/shared-store-types";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import { loadShipmentPrintGroups, createShipmentPrintLoadCache } from "@/lib/wms/load-shipment-print-groups";
import { buildBarTenderWorkbook, type ShipmentPrintGroup } from "@/lib/wms/shipment-print-client";
import { packingGenerationKey, packingManifestKey, type PackingProgress, type PackingRow } from "@/lib/wms/packing-progress";
import { closeReservedDownloadTarget, downloadBlobPreservingPage, reserveDownloadTarget } from "@/lib/wms/download-client";
import { wmsColors, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";

export default function PackingPage({ params }: { params: { waveId: string } }) {
  const [snapshot,setSnapshot] = useState<PickingWaveStoreSnapshot>();
  const [groups,setGroups] = useState<ShipmentPrintGroup[]>([]);
  const [catalog,setCatalog] = useState<ProductCatalogItem[]>([]);
  const [progress,setProgress] = useState<PackingProgress>();
  const [busy,setBusy] = useState(false); const [loading,setLoading] = useState(true);
  const [error,setError] = useState(""); const [message,setMessage] = useState("");
  const [selected,setSelected] = useState(""); const [search,setSearch] = useState("");
  const [reprintQty,setReprintQty] = useState<Record<string,string>>({});
  const wave = snapshot?.waves.find(w => w.id === params.waveId);
  const base = `/wms/picking/waves/${encodeURIComponent(params.waveId)}`;
  const rows: PackingRow[] = groups.flatMap(g => g.barcodeRows.map((row,index) => ({key:JSON.stringify([g.shipmentNumber,index,row.skuId,row.barcode,row.quantity]),shipmentNumber:g.shipmentNumber,purchaseOrderNumber:row.purchaseOrderNumber,skuId:row.skuId,barcode:row.barcode,quantity:row.quantity})));
  const currentKey = wave ? packingGenerationKey(wave) : "";
  const stale = Boolean(progress && (progress.generationKey !== currentKey || progress.manifestKey !== packingManifestKey(rows)));
  const checked = new Set(stale ? [] : progress?.checkedKeys || []);
  const dispatched = Boolean(progress?.dispatchedAt);

  async function load() {
    setLoading(true);setError("");setGroups([]);
    try {
      const response = await fetch("/api/wms/picking-waves",{cache:"no-store"}); const data = await response.json();
      if (!response.ok || !data.snapshot) throw new Error(data.error || "출고작업을 불러오지 못했습니다.");
      const saved: PickingWaveStoreSnapshot = data.snapshot; const target = saved.waves.find(w => w.id === params.waveId);
      if (!target) throw new Error("출고작업을 찾을 수 없습니다.");
      setSnapshot(saved);setProgress(saved.packingProgress?.[params.waveId]);
      const generations = (target.outputGenerations || []).filter(g => !g.supersededByGenerationId && g.status === "shipment_generated" && g.shipmentFileName);
      if (!generations.length) throw new Error("Shipment 파일을 생성한 뒤 동봉내역서를 불러올 수 있습니다. 서류 화면에서 먼저 완료해 주세요.");
      const targetItems = saved.items.filter(i => i.waveId === params.waveId);
      const loaded: ShipmentPrintGroup[] = []; const products = new Map<string,ProductCatalogItem>();
      const seenPos = new Set<string>(); const seenShipments = new Set<string>();
      const printCache = createShipmentPrintLoadCache();
      for (const generation of generations) {
        const source = await loadShipmentPrintGroups(params.waveId,targetItems,generation,{forPacking:true,cache:printCache});
        for (const group of source.groups) {
          if (seenShipments.has(group.shipmentNumber) || group.purchaseOrderNumbers.some(po => seenPos.has(po))) throw new Error("중복 Shipment 또는 발주서가 있습니다. 서류 화면의 출력 대상을 확인해 주세요.");
          seenShipments.add(group.shipmentNumber);group.purchaseOrderNumbers.forEach(po=>seenPos.add(po));loaded.push(group);
        }
        source.catalog.forEach(item=>products.set(item.skuId,item));
      }
      if (target.sourcePurchaseOrderNumbers.some(po=>!seenPos.has(po))) throw new Error("아직 Shipment가 생성되지 않은 발주서가 있습니다. 모든 발주의 Shipment 파일을 먼저 생성해 주세요.");
      setGroups(loaded);setCatalog([...products.values()]);
      const lastShipment = sessionStorage.getItem(`noidb:packing-shipment:${params.waveId}`);
      setSelected(loaded.find(g => g.shipmentNumber === lastShipment)?.shipmentNumber || loaded[0]?.shipmentNumber || "");
    } catch(e) {setError(e instanceof Error ? e.message : "동봉내역서를 불러오지 못했습니다.");}
    finally {setLoading(false);}
  }
  useEffect(()=>{void load();},[params.waveId]); // Explicit reload retrieves current files and shared checks.

  async function save(keys: string[], dispatch = false) {
    if (!wave || busy) return;
    if (dispatch && !window.confirm("모든 상품의 바코드 부착·포장을 확인했고, 실제로 택배사에 인계했습니까? 확인하면 출고완료로 마무리합니다.")) return;
    setBusy(true);setError("");setMessage("");
    try {
      const response = await fetch("/api/wms/packing-progress",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({waveId:wave.id,generationKey:currentKey,rows,checkedKeys:keys,expectedUpdatedAt:progress?.updatedAt || null,dispatched:dispatch,confirmed:dispatch})});
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "검수 기록 저장 실패");
      setProgress(data.progress);setMessage(dispatch ? "택배 출고완료로 저장했습니다." : "검수 기록 저장 완료");
    } catch(e) {setError(e instanceof Error ? e.message : "저장 실패");} finally {setBusy(false);}
  }
  async function reprint(group: ShipmentPrintGroup,index: number) {
    const row = group.barcodeRows[index];const key = `${group.shipmentNumber}:${index}`;
    const quantity = Number(reprintQty[key] || "1");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > row.quantity) {setError(`재발행은 1~${row.quantity}장 사이 정수로 입력해 주세요.`);return;}
    const target = reserveDownloadTarget();setBusy(true);setError("");
    try {
      const freshResponse = await fetch("/api/wms/picking-waves", { cache: "no-store" });
      const fresh = await freshResponse.json();
      const latest = fresh.snapshot?.waves.find((w: { id: string }) => w.id === params.waveId);
      if (!freshResponse.ok || !latest || packingGenerationKey(latest) !== currentKey) throw new Error("출력 대상이 변경되었거나 확인할 수 없습니다. 동봉내역서를 새로고침해 주세요.");
      const bytes = await buildBarTenderWorkbook([{...group,barcodeRows:[{...row,quantity}]}]);
      downloadBlobPreservingPage(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),`바코드_재발행_${group.shipmentNumber}_${row.skuId}_${quantity}장.xlsx`,target);
      setMessage(`${row.skuId} 바코드 ${quantity}장 재발행 파일을 만들었습니다. BarTender에서 출력해 주세요.`);
    } catch(e) {closeReservedDownloadTarget(target);setError(e instanceof Error ? e.message : "바코드 재발행 실패");} finally {setBusy(false);}
  }
  return <main style={{maxWidth:900,margin:"0 auto",padding:"16px",color:wmsColors.ink}}>
    <nav style={{display:"flex",gap:18,flexWrap:"wrap"}}><a href={base}>← 상품 찾기·센터 분배</a><a href={`${base}/complete`}>서류·출력세트</a><a href="/wms/work-center">작업센터</a></nav>
    <h1 style={{fontSize:22}}>Shipment별 검수·포장</h1><p>{wave?.displayName || params.waveId}</p>
    <p style={{fontSize:13,lineHeight:1.7}}>① 상품 찾기·센터 분배 → ② 동봉내역서 순서대로 상품·수량 확인 → ③ 바코드 부착·박스 포장 체크 → ④ 실제 택배 인계 후 출고완료</p>
    <p style={{fontSize:12}}>체크는 기존 피킹 수량과 별도로 저장됩니다. 바코드 재발행은 해당 상품의 필요한 장수만 XLSX로 생성합니다.</p>
    {loading && <p role="status">출력에 사용한 동봉내역서·최종 수량을 확인하고 있습니다…</p>}
    {error && <p role="alert" style={{color:wmsColors.warn,whiteSpace:"pre-wrap"}}>{error}</p>}
    {busy && <p role="status">저장·파일 생성 중입니다…</p>}
    {message && <p role="status">{message}</p>}
    <button type="button" disabled={loading || busy} onClick={()=>void load()} style={wmsSecondaryButton}>동봉내역서·저장 기록 새로고침</button>
    {stale && !loading && <p role="alert">출력 내용이 바뀌어 이전 체크를 적용하지 않았습니다. <button disabled={busy || dispatched} onClick={()=>void save([])}>변경된 목록으로 검수 시작</button></p>}
    {groups.length > 0 && <>
      <p><strong>전체 포장 확인 {checked.size}/{rows.length}행 · Shipment {groups.length}개</strong></p>
      <label>포장할 Shipment <select aria-label="포장할 Shipment" value={selected} onChange={e=>{setSelected(e.target.value);sessionStorage.setItem(`noidb:packing-shipment:${params.waveId}`,e.target.value);setSearch("");}} style={{width:"100%",minHeight:48,margin:"8px 0",fontSize:15}}>{groups.map(g=><option key={g.shipmentNumber} value={g.shipmentNumber}>{g.fulfillmentCenter} · {g.shipmentNumber} · {g.barcodeRows.reduce((n,r)=>n+r.quantity,0)}개</option>)}</select></label>
      <input aria-label="상품 검색" placeholder="상품명·SKU·바코드 검색 (내역서 순서 유지)" value={search} onChange={e=>setSearch(e.target.value)} style={{boxSizing:"border-box",width:"100%",minHeight:44,marginBottom:12}} />
      {groups.filter(g=>g.shipmentNumber===selected).map(group=><section key={group.shipmentNumber}>
        <h2 style={{fontSize:18}}>{group.fulfillmentCenter} · Shipment {group.shipmentNumber}</h2><p style={{fontSize:12}}>입고예정일 {group.expectedDate} · 발주 {group.purchaseOrderNumbers.join(", ")}</p>
        <p style={{fontSize:12}}>아래 번호는 이 Shipment 동봉내역서의 상품 순서입니다.</p>
        {group.barcodeRows.map((row,index)=>{
          if (search && !`${row.productName} ${row.optionLabel} ${row.skuId} ${row.barcode}`.toLowerCase().includes(search.toLowerCase())) return null;
          const product = catalog.find(p=>p.skuId===row.skuId);const item = snapshot?.items.find(i=>i.waveId===params.waveId && i.productCode===row.skuId);
          const key = rows.find(r=>r.shipmentNumber===group.shipmentNumber && r.key===JSON.stringify([group.shipmentNumber,index,row.skuId,row.barcode,row.quantity]))!.key;
          const quantityKey=`${group.shipmentNumber}:${index}`;const image = product?.imageUrl || item?.imageUrl;
          const link = product?.productLink && /^https?:\/\//i.test(product.productLink) ? product.productLink : "";
          return <article key={key} data-packing-sku={row.skuId} style={{border:`1px solid ${wmsColors.border}`,borderRadius:12,padding:12,marginBottom:10,background:checked.has(key)?wmsColors.greenSoft:"#fff"}}>
            <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
              {image && <a href={image} target="_blank" rel="noopener noreferrer"><img src={image} alt={row.productName} width={64} height={64} style={{objectFit:"contain",borderRadius:8}} /></a>}
              <div style={{minWidth:0,flex:1,overflowWrap:"anywhere"}}><strong>{index+1}. {row.productName}</strong><div>{row.optionLabel}</div><div style={{fontSize:12}}>SKU {row.skuId} · {row.barcode}</div><strong style={{fontSize:18}}>이 Shipment에 {row.quantity}개</strong><div>{link ? <a href={link} target="_blank" rel="noopener noreferrer">상품 링크 열기 ↗</a> : <span style={{fontSize:12}}>상품 링크 미등록</span>} · <a target="_blank" rel="noopener noreferrer" href={`/wms/products/${encodeURIComponent(row.skuId)}?fromWave=${encodeURIComponent(params.waveId)}`}>상품정보 보기</a></div></div>
            </div>
            <label style={{display:"flex",gap:8,alignItems:"center",minHeight:48,fontWeight:700}}><input aria-label={`${row.skuId} 포장 확인`} type="checkbox" checked={checked.has(key)} disabled={busy || stale || dispatched} onChange={()=>void save(checked.has(key)?[...checked].filter(k=>k!==key):[...checked,key])} style={{width:24,height:24}} />{row.quantity}개 확인 · 바코드 부착 · 박스 포장</label>
            <details><summary>바코드 분실·손상 → 재발행</summary>{(!row.modelName || !row.countryOfOrigin) && <p style={{color:wmsColors.warn,fontSize:12}}>재발행에 필요한 제조국·영문 모델 정보가 없습니다. 상품정보를 확인한 뒤 목록을 새로고침해 주세요.</p>}<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginTop:8}}><label>장수 <input aria-label={`${row.skuId} 재발행 장수`} type="number" min={1} max={row.quantity} value={reprintQty[quantityKey] || "1"} onChange={e=>setReprintQty({...reprintQty,[quantityKey]:e.target.value})} style={{width:65,minHeight:40}} /></label><button disabled={busy || stale || !row.modelName || !row.countryOfOrigin} style={wmsSecondaryButton} onClick={()=>void reprint(group,index)}>이 상품 바코드 재발행</button></div></details>
          </article>;
        })}
      </section>)}
      <div style={{position:"sticky",bottom:0,padding:"12px 0",background:"#fff",borderTop:`1px solid ${wmsColors.border}`}}><button style={{...wmsPrimaryButton,width:"100%",opacity:(!rows.length || checked.size!==rows.length || busy || stale || dispatched)?0.5:1}} disabled={!rows.length || checked.size!==rows.length || busy || stale || dispatched} onClick={()=>void save([...checked],true)}>{dispatched ? "택배 출고완료" : "택배 인계 후 · 출고완료"}</button><p style={{fontSize:12,margin:"6px 0"}}>{dispatched ? `완료 시각: ${new Date(progress!.dispatchedAt!).toLocaleString("ko-KR")}` : `남은 검수 ${rows.length-checked.size}행 · 실제 택배 인계 후 눌러 주세요.`}</p></div>
    </>}
  </main>;
}
