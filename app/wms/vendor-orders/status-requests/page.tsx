"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import type { StatusRequestRecord } from "@/lib/wms/vendor-order-actions";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";
import { WMS_MOBILE_WIDTH, wmsColors, wmsGhostButton, wmsPrimaryButton } from "@/lib/wms/ui-tokens";

type Filter = "전체" | "처리대기" | "단종" | "단종해제" | "Supply Hub 처리완료";
const FILTERS: Filter[] = ["전체", "처리대기", "단종", "단종해제", "Supply Hub 처리완료"];

export default function StatusRequestsPage() {
  const [requests, setRequests] = useState<StatusRequestRecord[]>([]);
  const [catalog, setCatalog] = useState<Map<string, ProductCatalogItem>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("전체");
  const [operator, setOperator] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function reload() {
    setLoading(true);
    try {
      const [historyResponse, catalogResponse] = await Promise.all([
        fetch("/api/wms/vendor-order-actions", { cache: "no-store" }),
        fetch("/api/wms/product-catalog", { cache: "no-store" }),
      ]);
      const history = await historyResponse.json();
      const products = await catalogResponse.json();
      if (!historyResponse.ok || !history.success) throw new Error(history.error || "단종/해제 이력 조회에 실패했습니다.");
      setRequests((history.statusRequests || []).reverse());
      setCatalog(new Map(((products.items || []) as ProductCatalogItem[]).map(item => [normalizeSkuId(item.skuId), item])));
    } catch (error) { setMessage(error instanceof Error ? error.message : "목록을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    setOperator(window.localStorage.getItem("noidb_wms_operator") || "");
    reload();
  }, []);

  const filtered = useMemo(() => requests.filter(request => {
    if (filter === "전체") return true;
    if (filter === "처리대기") return request.supplyHubStatus === "처리대기";
    if (filter === "Supply Hub 처리완료") return request.supplyHubStatus === "처리완료";
    return request.requestType === filter;
  }), [filter, requests]);

  async function post(body: Record<string, unknown>) {
    if (!operator.trim()) throw new Error("처리자 이름을 먼저 입력해주세요.");
    const response = await fetch("/api/wms/vendor-order-actions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, operator: operator.trim() }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "처리에 실패했습니다.");
    return data;
  }

  async function requestSelected(requestType: "단종" | "단종해제") {
    const targetSkus = Array.from(new Set(requests.filter(request => selected.has(request.id)).map(request => request.skuId)));
    if (!targetSkus.length || !window.confirm(`${targetSkus.length}개 SKU를 ${requestType} 처리할까요?`)) return;
    setSaving(true); setMessage("");
    try {
      for (const skuId of targetSkus) await post({ action: "status", skuId, requestType });
      setMessage(`${targetSkus.length}개 SKU의 ${requestType} 요청을 저장했습니다.`);
      setSelected(new Set()); await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : `${requestType} 처리에 실패했습니다.`); }
    finally { setSaving(false); }
  }

  async function completeSelected() {
    const ids = requests.filter(request => selected.has(request.id) && request.supplyHubStatus === "처리대기").map(request => request.id);
    if (!ids.length || !window.confirm(`${ids.length}개 요청을 Supply Hub 처리완료로 표시할까요?\n제품DB 현재상태는 바뀌지 않습니다.`)) return;
    setSaving(true); setMessage("");
    try {
      const data = await post({ action: "complete-status", ids });
      setMessage(`${data.completedCount}개 요청의 Supply Hub 상태만 처리완료로 변경했습니다.`);
      setSelected(new Set()); await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "처리완료 저장에 실패했습니다."); }
    finally { setSaving(false); }
  }

  return (
    <main style={{ maxWidth: WMS_MOBILE_WIDTH, minHeight: "100vh", margin: "0 auto", padding: "12px 12px calc(20px + env(safe-area-inset-bottom))", background: wmsColors.background, color: wmsColors.ink, fontFamily: "sans-serif" }}>
      <a href="/wms/vendor-orders" style={{ color: wmsColors.slateDark, fontSize: "13px" }}>← 거래처 발주관리</a>
      <h1 style={{ margin: "12px 0 4px", fontSize: "20px" }}>단종/해제 SKU</h1>
      <p style={{ margin: "0 0 10px", fontSize: "11px", color: wmsColors.muted }}>제품DB 현재상태와 Supply Hub 수동 처리대기 이력을 분리해 관리합니다.</p>
      <label style={{ display: "block", marginBottom: "10px" }}>
        <span style={{ display: "block", fontSize: "11px", color: wmsColors.muted, marginBottom: "3px" }}>처리자</span>
        <input value={operator} onChange={event => { setOperator(event.target.value); window.localStorage.setItem("noidb_wms_operator", event.target.value); }} placeholder="처리자 이름" style={{ width: "100%", minHeight: "40px", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "9px", padding: "8px 10px" }} />
      </label>
      <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "5px", marginBottom: "8px" }}>
        {FILTERS.map(value => <button key={value} type="button" onClick={() => setFilter(value)} style={{ ...wmsGhostButton, whiteSpace: "nowrap", minHeight: "36px", background: filter === value ? wmsColors.greenSoft : "#fff", color: filter === value ? wmsColors.greenDark : wmsColors.ink, fontSize: "11px" }}>{value}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
        <button type="button" onClick={() => setSelected(new Set(filtered.map(request => request.id)))} style={wmsGhostButton}>전체선택</button>
        <button type="button" onClick={() => setSelected(new Set())} style={wmsGhostButton}>선택해제</button>
        <button type="button" disabled={saving || !selected.size} onClick={() => requestSelected("단종")} style={{ ...wmsGhostButton, color: "#934633", opacity: selected.size ? 1 : .45 }}>선택 SKU 단종처리</button>
        <button type="button" disabled={saving || !selected.size} onClick={() => requestSelected("단종해제")} style={{ ...wmsGhostButton, color: wmsColors.greenDark, opacity: selected.size ? 1 : .45 }}>선택 SKU 단종해제</button>
        <button type="button" disabled={saving || !selected.size} onClick={completeSelected} style={{ ...wmsPrimaryButton, gridColumn: "1 / -1", opacity: selected.size ? 1 : .45 }}>선택 처리완료</button>
      </div>
      {message && <p style={{ fontSize: "12px", color: message.includes("변경했습니다") || message.includes("저장했습니다") ? wmsColors.greenDark : "#a33b2e" }}>{message}</p>}
      {loading ? <p>불러오는 중...</p> : filtered.length === 0 ? <p style={{ fontSize: "12px", color: wmsColors.muted }}>조건에 맞는 요청이 없습니다.</p> : (
        <div style={{ display: "grid", gap: "8px" }}>
          {filtered.map(request => {
            const live = catalog.get(normalizeSkuId(request.skuId));
            const imageUrl = getWmsDisplayImageUrl(live?.imageUrl);
            return <div key={request.id} style={{ display: "grid", gridTemplateColumns: "24px 52px minmax(0,1fr)", gap: "9px", padding: "10px", border: `1px solid ${wmsColors.border}`, borderRadius: "11px", background: "#fff" }}>
              <input type="checkbox" aria-label={`${request.skuId} 요청 선택`} checked={selected.has(request.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(request.id); else next.delete(request.id); return next; })} style={{ width: "22px", height: "22px", alignSelf: "center" }} />
              {imageUrl ? <img src={imageUrl} alt="" width={52} height={52} style={{ width: "52px", height: "52px", borderRadius: "8px", objectFit: "cover" }} /> : <div style={{ width: "52px", height: "52px", display: "grid", placeItems: "center", borderRadius: "8px", background: wmsColors.surfaceBeige, fontSize: "9px", color: wmsColors.muted }}>이미지 없음</div>}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 800, lineHeight: 1.35 }}>{request.productName}</div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: wmsColors.muted }}>{request.optionLabel || "옵션 없음"}</div>
                <div style={{ marginTop: "3px", fontSize: "10px", color: wmsColors.muted }}>SKU {request.skuId} · 모델SKU {request.modelSku || "미등록"}</div>
                <div style={{ marginTop: "5px", fontSize: "11px" }}>현재상태 <strong>{live?.currentStatus || request.currentStatus || "빈값"}</strong> · 요청 <strong>{request.requestType}</strong></div>
                <div style={{ fontSize: "11px", color: request.supplyHubStatus === "처리대기" ? "#934633" : wmsColors.greenDark }}>Supply Hub {request.supplyHubStatus} · {new Date(request.requestedAt).toLocaleString("ko-KR")}</div>
                {request.completedAt ? <div style={{ fontSize: "10px", color: wmsColors.muted }}>완료 {new Date(request.completedAt).toLocaleString("ko-KR")} · {request.processor}</div> : null}
                {request.productLink ? <a href={request.productLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: "11px", color: wmsColors.slateDark }}>제품링크 ↗</a> : <span style={{ fontSize: "10px", color: wmsColors.muted }}>제품링크 없음</span>}
              </div>
            </div>;
          })}
        </div>
      )}
    </main>
  );
}
