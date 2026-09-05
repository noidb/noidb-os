"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import type { StatusFileGenerationRecord, StatusRequestRecord } from "@/lib/wms/vendor-order-actions";
import { downloadBlobPreservingPage } from "@/lib/wms/download-client";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";
import { WMS_MOBILE_WIDTH, wmsColors, wmsGhostButton, wmsPrimaryButton } from "@/lib/wms/ui-tokens";

type Filter = "전체" | "처리대기" | "단종" | "단종해제" | "외부 처리완료";
const FILTERS: Filter[] = ["전체", "처리대기", "단종", "단종해제", "외부 처리완료"];
const actionButtonSize = { minHeight: "48px", minWidth: 0, fontSize: "13px", lineHeight: 1.3, padding: "8px 6px" };

export default function StatusRequestsPage() {
  const [requests, setRequests] = useState<StatusRequestRecord[]>([]);
  const [generations, setGenerations] = useState<StatusFileGenerationRecord[]>([]);
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
      setGenerations((history.statusFileGenerations || []).reverse());
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
    if (filter === "외부 처리완료") return request.supplyHubStatus === "처리완료";
    return request.requestType === filter;
  }), [filter, requests]);

  async function post(body: Record<string, unknown>, operatorRequired = true) {
    if (operatorRequired && !operator.trim()) throw new Error("처리자 이름을 먼저 입력해주세요.");
    const response = await fetch("/api/wms/vendor-order-actions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, operator: operator.trim() || "자동" }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "처리에 실패했습니다.");
    return data;
  }

  const selectedPending = useMemo(() => requests.filter(request => selected.has(request.id) && request.supplyHubStatus === "처리대기"), [requests, selected]);
  const selectedDiscontinue = useMemo(() => requests.filter(request => selected.has(request.id) && request.requestType === "단종"), [requests, selected]);
  const selectedRelease = useMemo(() => requests.filter(request => selected.has(request.id) && request.requestType === "단종해제"), [requests, selected]);
  const pendingDiscontinue = selectedPending.filter(request => request.requestType === "단종");
  const pendingRelease = selectedPending.filter(request => request.requestType === "단종해제");

  async function requestWorkbook(kind: "discontinue" | "release", targets: StatusRequestRecord[]) {
    const unique = Array.from(new Map(targets.map(request => [normalizeSkuId(request.skuId), request])).values()).filter(request => request.skuId);
    if (!unique.length) throw new Error(kind === "discontinue" ? "선택한 단종 SKU가 없습니다." : "선택한 단종해제 SKU가 없습니다.");
    const response = await fetch("/api/wms/discontinue-files", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, format: kind === "discontinue" ? "bundle" : "xlsx", items: unique.map(request => ({
        skuId: normalizeSkuId(request.skuId),
        productName: request.productName.includes(",") || !request.optionLabel ? request.productName : `${request.productName}, ${request.optionLabel}`,
      })) }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "파일을 만들지 못했습니다.");
    }
    if (response.headers.get("X-NOIDB-Preserved-Template") !== "true") throw new Error("원본 양식 보존 검증에 실패했습니다.");
    if (Number(response.headers.get("X-NOIDB-Item-Count")) !== unique.length) throw new Error("선택 SKU와 생성 파일의 개수가 달라 다운로드를 중단했습니다.");
    const pdfFileName = decodeURIComponent(response.headers.get("X-NOIDB-PDF-File-Name") || "");
    if (kind === "discontinue" && !pdfFileName) throw new Error("단종 XLSX와 공문 PDF를 모두 만들지 못했습니다. 다시 시도해 주세요.");
    const fallback = kind === "discontinue" ? "단종신청_엑셀_공문.zip" : "단종해제.xlsx";
    return {
      blob: await response.blob(),
      fileName: decodeURIComponent(response.headers.get("X-NOIDB-File-Name") || fallback),
      xlsxFileName: decodeURIComponent(response.headers.get("X-NOIDB-XLSX-File-Name") || response.headers.get("X-NOIDB-File-Name") || fallback),
      pdfFileName,
      driveSaved: response.headers.get("X-NOIDB-Drive-Saved") === "true",
      driveWarning: decodeURIComponent(response.headers.get("X-NOIDB-Drive-Save-Warning") || ""),
      date: response.headers.get("X-NOIDB-Document-Date") || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
      unique,
    };
  }

  async function generateDiscontinueFiles() {
    setSaving(true); setMessage("");
    try {
      const workbook = await requestWorkbook("discontinue", selectedDiscontinue);
      await post({
        action: "record-status-files", kind: "단종", skuIds: workbook.unique.map(item => item.skuId),
        requestIds: workbook.unique.map(item => item.id), xlsxFileName: workbook.xlsxFileName, pdfFileName: workbook.pdfFileName,
      }, false);
      downloadBlobPreservingPage(workbook.blob, workbook.fileName);
      setMessage(`생성완료 · 단종 SKU ${workbook.unique.length}개 · XLSX와 PDF의 SKU가 동일합니다.${workbook.driveSaved ? " XLSX·PDF Drive 자동저장 완료." : workbook.driveWarning ? ` ${workbook.driveWarning}` : ""} 기존 처리상태와 제품DB는 변경하지 않았습니다.`);
      await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "단종 파일을 만들지 못했습니다."); }
    finally { setSaving(false); }
  }

  async function generateReleaseFile() {
    setSaving(true); setMessage("");
    try {
      const workbook = await requestWorkbook("release", selectedRelease);
      await post({
        action: "record-status-files", kind: "단종해제", skuIds: workbook.unique.map(item => item.skuId),
        requestIds: workbook.unique.map(item => item.id), xlsxFileName: workbook.fileName,
      }, false);
      downloadBlobPreservingPage(workbook.blob, workbook.fileName);
      setMessage(`생성완료 · 단종해제 SKU ${workbook.unique.length}개 · 원본의 기존 데이터행은 제거했습니다.${workbook.driveSaved ? " Drive 자동저장 완료." : workbook.driveWarning ? ` ${workbook.driveWarning}` : ""} 기존 처리상태와 제품DB는 변경하지 않았습니다. 이메일 발송 후 아래 완료 버튼을 눌러 주세요.`);
      await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "단종해제 파일을 만들지 못했습니다."); }
    finally { setSaving(false); }
  }

  async function completeSelected(kind: "단종" | "단종해제") {
    const ids = (kind === "단종" ? pendingDiscontinue : pendingRelease).map(request => request.id);
    const label = kind === "단종" ? "서플라이허브 업로드 완료" : "이메일 발송 완료";
    if (!ids.length || !window.confirm(`${ids.length}개 ${kind} 요청을 ${label}로 표시할까요?\n실제 외부 처리를 마친 경우에만 확인해 주세요. 제품DB 현재상태는 바뀌지 않습니다.`)) return;
    setSaving(true); setMessage("");
    try {
      const data = await post({ action: "complete-status", ids });
      setMessage(`${data.completedCount}개 ${kind} 요청을 ${label}로 표시했습니다. 제품DB는 변경하지 않았습니다.`);
      setSelected(new Set()); await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "처리완료 저장에 실패했습니다."); }
    finally { setSaving(false); }
  }

  return (
    <main style={{ maxWidth: WMS_MOBILE_WIDTH, minHeight: "100vh", margin: "0 auto", padding: "12px 12px calc(20px + env(safe-area-inset-bottom))", background: wmsColors.background, color: wmsColors.ink, fontFamily: "sans-serif" }}>
      <a href="/wms/vendor-orders" style={{ color: wmsColors.slateDark, fontSize: "13px" }}>← 거래처 발주관리</a>
      <h1 style={{ margin: "12px 0 4px", fontSize: "20px" }}>단종·해제 관리</h1>
      <p style={{ margin: "0 0 10px", fontSize: "11px", color: wmsColors.muted }}>완료한 요청도 선택해서 파일을 다시 만들 수 있습니다. 재출력은 기존 처리상태나 제품DB를 바꾸지 않습니다.</p>
      <label style={{ display: "block", marginBottom: "10px" }}>
        <span style={{ display: "block", fontSize: "11px", color: wmsColors.muted, marginBottom: "3px" }}>처리자</span>
        <input value={operator} onChange={event => { setOperator(event.target.value); window.localStorage.setItem("noidb_wms_operator", event.target.value); }} placeholder="처리자 이름" style={{ width: "100%", minHeight: "40px", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "9px", padding: "8px 10px" }} />
      </label>
      <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "5px", marginBottom: "8px" }}>
        {FILTERS.map(value => <button key={value} type="button" onClick={() => setFilter(value)} style={{ ...wmsGhostButton, whiteSpace: "nowrap", minHeight: "36px", background: filter === value ? wmsColors.greenSoft : "#fff", color: filter === value ? wmsColors.greenDark : wmsColors.ink, fontSize: "11px" }}>{value}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
        <button type="button" onClick={() => setSelected(new Set(filtered.map(request => request.id)))} style={{ ...wmsGhostButton, ...actionButtonSize }}>전체선택</button>
        <button type="button" onClick={() => setSelected(new Set())} style={{ ...wmsGhostButton, ...actionButtonSize }}>선택해제</button>
        <button type="button" disabled={saving || !selectedDiscontinue.length} onClick={generateDiscontinueFiles} style={{ ...wmsGhostButton, ...actionButtonSize, color: "#934633", opacity: selectedDiscontinue.length ? 1 : .45 }}>선택 단종파일 생성</button>
        <button type="button" disabled={saving || !selectedRelease.length} onClick={generateReleaseFile} style={{ ...wmsGhostButton, ...actionButtonSize, color: wmsColors.greenDark, opacity: selectedRelease.length ? 1 : .45 }}>선택 단종해제 파일 생성</button>
        <button type="button" disabled={saving || !pendingDiscontinue.length} onClick={() => completeSelected("단종")} style={{ ...wmsPrimaryButton, ...actionButtonSize, opacity: pendingDiscontinue.length ? 1 : .45 }}>단종 업로드 완료</button>
        <button type="button" disabled={saving || !pendingRelease.length} onClick={() => completeSelected("단종해제")} style={{ ...wmsPrimaryButton, ...actionButtonSize, opacity: pendingRelease.length ? 1 : .45 }}>해제 이메일 발송 완료</button>
      </div>
      {message && <p style={{ fontSize: "12px", overflowWrap: "anywhere", color: message.includes("생성완료") || message.includes("표시했습니다") ? wmsColors.greenDark : "#a33b2e" }}>{message}</p>}
      {generations.length > 0 ? (
        <details style={{ margin: "8px 0 12px", border: `1px solid ${wmsColors.border}`, borderRadius: "10px", background: "#fff", padding: "9px 10px" }}>
          <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 800 }}>최근 생성 이력 ({generations.length}건)</summary>
          <div style={{ display: "grid", gap: "6px", marginTop: "8px" }}>
            {generations.slice(0, 5).map(generation => (
              <div key={generation.id} style={{ fontSize: "11px", color: wmsColors.muted, overflowWrap: "anywhere" }}>
                <strong style={{ color: wmsColors.ink }}>{generation.kind} {generation.skuIds.length}개</strong> · {new Date(generation.generatedAt).toLocaleString("ko-KR")}<br />
                {generation.xlsxFileName}{generation.pdfFileName ? ` · ${generation.pdfFileName}` : ""}
              </div>
            ))}
          </div>
        </details>
      ) : null}
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
                <div style={{ fontSize: "11px", color: request.supplyHubStatus === "처리대기" ? "#934633" : wmsColors.greenDark }}>{request.supplyHubStatus === "처리완료" ? request.requestType === "단종해제" ? "이메일 발송 완료" : "서플라이허브 업로드 완료" : `${request.requestType} 대기`} · {new Date(request.requestedAt).toLocaleString("ko-KR")}</div>
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
