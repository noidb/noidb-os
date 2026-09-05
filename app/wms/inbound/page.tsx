"use client";

import { useEffect, useMemo, useState } from "react";
import { downloadBlobPreservingPage } from "@/lib/wms/download-client";
import type { InboundDateResult } from "@/lib/wms/inbound-results";
import type { InboundCellPreview } from "@/lib/wms/inbound-cell-preview";
import { WMS_MOBILE_WIDTH, wmsColors, wmsGhostButton, wmsPrimaryButton } from "@/lib/wms/ui-tokens";

interface DriveSyncPreview {
  canApply: boolean;
  applied?: boolean;
  newFiles: Array<{ id: string; name: string; modifiedTime: string; size: string }>;
  modifiedFiles: Array<{ id: string; name: string; modifiedTime: string; size: string }>;
  message?: string;
  result?: {
    parsed?: number;
    totalInbound?: number;
    files?: number;
    skipped?: boolean;
    previewToken?: string;
    candidateEvents?: number;
    duplicateEvents?: number;
    overlapDuplicateEvents?: number;
    cellPreview?: InboundCellPreview;
  };
}

interface ApiFailure {
  success?: false;
  code?: string;
  error?: string;
}

export default function WmsInboundPage() {
  const [results, setResults] = useState<InboundDateResult[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [discountRate, setDiscountRate] = useState("30");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [syncPreview, setSyncPreview] = useState<DriveSyncPreview | null>(null);
  const [driveReconnectRequired, setDriveReconnectRequired] = useState(false);

  async function reload() {
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/wms/inbound-results", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "입고결과를 불러오지 못했습니다.");
      const next = (data.results || []) as InboundDateResult[];
      setResults(next);
      setSelectedDate(previous => previous && next.some(item => item.actualDate === previous) ? previous : (next[0]?.actualDate || ""));
    } catch (error) { setMessage(error instanceof Error ? error.message : "입고결과를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void reload(); }, []);
  const selected = useMemo(() => results.find(item => item.actualDate === selectedDate), [results, selectedDate]);
  const missingProductLinkCount = selected?.missingItems.filter(item => !item.productLink.trim()).length || 0;

  async function syncDrive() {
    setBusy(true); setMessage(""); setSyncPreview(null);
    try {
      const response = await fetch("/api/wms/inbound-drive-sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview" }),
      });
      const data = await response.json() as DriveSyncPreview & ApiFailure;
      if (!response.ok || !data.success) {
        if (data.code === "DRIVE_RECONNECT_REQUIRED") {
          setDriveReconnectRequired(true);
          setSyncPreview(null);
        }
        throw new Error(data.error || "입고파일 자동 확인에 실패했습니다.");
      }
      setDriveReconnectRequired(false);
      setSyncPreview(data);
      if (data.message) setMessage(data.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : "입고파일 자동 확인에 실패했습니다."); }
    finally { setBusy(false); }
  }

  async function generate() {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/wms/inbound-results", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualDate: selected.actualDate, discountRate: Number(discountRate) }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "파일을 만들지 못했습니다.");
      }
      const decodeHeader = (name: string, fallback = "") => {
        const value = response.headers.get(name) || fallback;
        try { return decodeURIComponent(value); } catch { return value; }
      };
      const fileName = decodeHeader("X-NOIDB-File-Name", `입고결과_${selected.actualDate}.zip`);
      const couponCount = Number(response.headers.get("X-NOIDB-Coupon-Count") || 0);
      const missingCount = Number(response.headers.get("X-NOIDB-Missing-Count") || 0);
      const driveSaved = response.headers.get("X-NOIDB-Drive-Saved") === "true";
      const driveWarning = decodeHeader("X-NOIDB-Drive-Save-Warning");
      const couponFileName = decodeHeader("X-NOIDB-Coupon-File-Name");
      const missingFileName = decodeHeader("X-NOIDB-Missing-File-Name");
      downloadBlobPreservingPage(await response.blob(), fileName);
      const generatedFiles = [couponFileName, missingFileName].filter(Boolean).join(" / ");
      const driveResult = driveSaved
        ? " · Drive 저장 완료"
        : ` · ${driveWarning || "Drive 자동저장에 실패했지만 내려받은 ZIP은 사용할 수 있습니다."}`;
      setMessage(`생성완료 · 실제 입고일 ${selected.actualDate} · 쿠폰 ${couponCount.toLocaleString()}개 · 미입고 ${missingCount.toLocaleString()}개 · 정률 ${discountRate}%${generatedFiles ? ` · 파일 ${generatedFiles}` : ""}${driveResult}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "파일을 만들지 못했습니다."); }
    finally { setBusy(false); }
  }

  return (
    <main style={{ maxWidth: WMS_MOBILE_WIDTH, minHeight: "100vh", margin: "0 auto", padding: "12px 12px calc(24px + env(safe-area-inset-bottom))", background: wmsColors.background, color: wmsColors.ink, fontFamily: "sans-serif", boxSizing: "border-box" }}>
      <a href="/wms/work-center" style={{ color: wmsColors.slateDark, fontSize: "13px" }}>← 작업센터</a>
      <h1 style={{ margin: "12px 0 4px", fontSize: "22px" }}>입고결과·쿠폰</h1>
      <p style={{ margin: "0 0 12px", fontSize: "12px", color: wmsColors.muted }}>실제 입고일과 발주번호+SKU 누적입고를 기준으로 자동 계산합니다.</p>
      <section style={{ padding: "12px", marginBottom: "12px", border: `1px solid ${wmsColors.border}`, borderRadius: "12px", background: wmsColors.surfaceBeige }}>
        <strong style={{ display: "block", fontSize: "14px" }}>입고파일 자동 확인</strong>
        <p style={{ margin: "4px 0 9px", fontSize: "11px", color: wmsColors.muted }}>Google Drive의 입고상세내역 다운로드 폴더에서 새 XLSX만 찾습니다.</p>
        <button type="button" onClick={syncDrive} disabled={busy} style={{ ...wmsGhostButton, width: "100%", minHeight: "42px", opacity: busy ? .5 : 1 }}>{busy ? "확인 중..." : "새 입고파일 확인"}</button>
        {driveReconnectRequired ? <div style={{ marginTop: "8px", padding: "10px", border: `1px solid ${wmsColors.warn}`, borderRadius: "10px", background: wmsColors.warnSoft }}>
          <strong style={{ display: "block", marginBottom: "6px", fontSize: "12px", color: wmsColors.warnText }}>Google Drive 연결이 만료되었습니다.</strong>
          <a href="/api/auth/google-drive/start" target="_blank" rel="noopener noreferrer" style={{ ...wmsPrimaryButton, display: "flex", alignItems: "center", justifyContent: "center", width: "100%", minHeight: "44px", boxSizing: "border-box", textDecoration: "none" }}>Google Drive 다시 연결</a>
          <p style={{ margin: "6px 0 0", fontSize: "10px", color: wmsColors.muted }}>연결을 마치고 이 화면으로 돌아와 새 입고파일 확인을 다시 누르세요.</p>
        </div> : null}
        {syncPreview?.newFiles.length ? <div style={{ marginTop: "8px", fontSize: "11px", lineHeight: 1.5 }}>
          <strong>새 파일 {syncPreview.newFiles.length}개</strong>
          {syncPreview.newFiles.map(file => <div key={file.id}>{file.name}</div>)}
          {syncPreview.result ? <div style={{ marginTop: "4px", color: wmsColors.greenDark }}>
            새 입고이벤트 {Number(syncPreview.result.candidateEvents || 0).toLocaleString()}건 · 예상 실제입고 {Number(syncPreview.result.totalInbound || 0).toLocaleString()}개 · SKU {Number(syncPreview.result.parsed || 0).toLocaleString()}개
            {Number(syncPreview.result.duplicateEvents || 0) + Number(syncPreview.result.overlapDuplicateEvents || 0) > 0
              ? ` · 겹침 ${Number(syncPreview.result.duplicateEvents || 0) + Number(syncPreview.result.overlapDuplicateEvents || 0)}건 제외`
              : ""}
          </div> : null}
        </div> : null}
        {syncPreview?.modifiedFiles.length ? <div style={{ marginTop: "8px", fontSize: "11px", color: wmsColors.warn }}>수정 파일 {syncPreview.modifiedFiles.length}개는 중복 합산 방지를 위해 자동 반영하지 않습니다.</div> : null}
        {syncPreview?.result?.cellPreview ? <details style={{ marginTop: "12px", fontSize: "12px", overflowWrap: "anywhere" }}>
          <summary style={{ cursor: "pointer", minHeight: "36px" }}>제품DB 변경 미리보기 · {syncPreview.result.cellPreview.changes.length}셀</summary>
          <p>아직 저장되지 않았습니다. 현재고·원가·이미지는 변경 대상에 포함되지 않습니다.</p>
          {syncPreview.result.cellPreview.blockers.map(reason => <p key={reason} role="alert" style={{ color: wmsColors.warnText }}>{reason}</p>)}
          {!syncPreview.result.cellPreview.blockers.length && !syncPreview.result.cellPreview.changes.length ? <p>변경할 셀이 없습니다.</p> : null}
          {syncPreview.result.cellPreview.changes.map(change => <div key={`${change.row}-${change.column}`} style={{ padding: "8px 0", borderBottom: `1px solid ${wmsColors.border}` }}>
            <strong>SKU {change.sku} · {change.field}</strong>
            <div>제품DB {change.row}행 · {change.before === "" ? "빈칸" : change.before} → {change.after.toLocaleString()}</div>
          </div>)}
        </details> : null}
      </section>
      {loading ? <p>입고결과 계산 중...</p> : results.length === 0 ? (
        <section style={{ padding: "14px", border: `1px solid ${wmsColors.border}`, borderRadius: "14px", background: "#fff" }}>
          <strong style={{ fontSize: "14px" }}>아직 반영된 입고상세내역이 없습니다.</strong>
          <p style={{ margin: "6px 0 0", fontSize: "12px", color: wmsColors.muted }}>입고상세내역을 한 번 반영하면 이후 실제 입고일별 결과가 여기에 자동 정리됩니다.</p>
        </section>
      ) : (
        <>
          <label style={{ display: "block", marginBottom: "8px" }}>
            <span style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 800, color: wmsColors.muted }}>전체 실제 입고일 {results.length}개</span>
            <select value={selectedDate} onChange={event => setSelectedDate(event.target.value)} style={{ width: "100%", minHeight: "42px", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "9px", background: "#fff", padding: "7px 10px", fontSize: "14px", fontWeight: 800 }}>
              {results.map(result => <option key={result.actualDate} value={result.actualDate}>{result.actualDate}</option>)}
            </select>
          </label>
          <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "6px", marginBottom: "8px" }}>
            {results.slice(0, 5).map(result => <button key={result.actualDate} type="button" onClick={() => setSelectedDate(result.actualDate)} style={{ ...wmsGhostButton, whiteSpace: "nowrap", minHeight: "38px", background: selectedDate === result.actualDate ? wmsColors.greenSoft : "#fff", color: selectedDate === result.actualDate ? wmsColors.greenDark : wmsColors.ink }}>{result.actualDate}</button>)}
          </div>
          {selected ? <section style={{ padding: "14px", border: `1px solid ${wmsColors.border}`, borderRadius: "14px", background: "#fff" }}>
            <h2 style={{ margin: "0 0 10px", fontSize: "17px" }}>{selected.actualDate} 실제 입고결과</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "7px", marginBottom: "12px" }}>
              {[["발주", selected.purchaseOrderCount], ["입고 SKU", selected.receivedSkuCount], ["부분입고 SKU", selected.partialSkuCount], ["미입고 SKU", selected.missingSkuCount]].map(([label, value]) => <div key={String(label)} style={{ padding: "10px", border: `1px solid ${wmsColors.border}`, borderRadius: "10px", background: wmsColors.surfaceBeige }}><div style={{ fontSize: "10px", color: wmsColors.muted }}>{label}</div><strong style={{ fontSize: "20px" }}>{value}개</strong></div>)}
            </div>
            {selected.nameConflicts.length ? <p style={{ padding: "9px", borderRadius: "9px", background: wmsColors.warnSoft, color: wmsColors.warn, fontSize: "12px" }}>상품명 확인 필요 {selected.nameConflicts.length}개 · 충돌을 해결하기 전에는 파일을 만들지 않습니다.</p> : null}
            {missingProductLinkCount ? <p style={{ padding: "9px", borderRadius: "9px", background: wmsColors.warnSoft, color: wmsColors.warn, fontSize: "12px" }}>미입고 상품의 제품링크가 없는 SKU {missingProductLinkCount}개 · SKU는 빼지 않고 미입고 파일 C열을 빈칸으로 만듭니다.</p> : null}
            <label style={{ display: "block", marginBottom: "10px" }}>
              <span style={{ display: "block", marginBottom: "4px", fontSize: "12px", fontWeight: 800 }}>할인방식 정률 · 할인율</span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><input type="number" min={1} max={100} step={1} value={discountRate} onChange={event => setDiscountRate(event.target.value)} inputMode="numeric" style={{ width: "100%", minHeight: "44px", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "9px", padding: "8px 10px", fontSize: "16px", fontWeight: 800, textAlign: "right" }} /><strong>%</strong></span>
            </label>
            <button type="button" onClick={generate} disabled={busy || !discountRate || selected.nameConflicts.length > 0} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "48px", opacity: busy || !discountRate || selected.nameConflicts.length ? .45 : 1 }}>{busy ? "생성 중..." : "쿠폰·미입고 파일 생성"}</button>
            <details style={{ marginTop: "12px" }}><summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 800 }}>입고 SKU 목록 ({selected.couponItems.length})</summary><div style={{ marginTop: "6px", fontSize: "11px", lineHeight: 1.6 }}>{selected.couponItems.map(item => <div key={item.skuId}>{item.skuId} · {item.productName || "상품명 확인 필요"}</div>)}</div></details>
            <details style={{ marginTop: "8px" }}><summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 800 }}>미입고 SKU 목록 ({selected.missingItems.length})</summary><div style={{ marginTop: "6px", fontSize: "11px", lineHeight: 1.6 }}>{selected.missingItems.map(item => <div key={item.skuId}>{item.skuId} · {item.productName || "상품명 확인 필요"}</div>)}</div></details>
          </section> : null}
        </>
      )}
      {message ? <p style={{ marginTop: "10px", fontSize: "12px", color: message.includes("생성완료") ? wmsColors.greenDark : "#a33b2e" }}>{message}</p> : null}
    </main>
  );
}
