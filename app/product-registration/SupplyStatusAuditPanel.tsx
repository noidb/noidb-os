"use client";

import { useState } from "react";
import type { SupplyStatusAudit } from "@/lib/wms/supply-status-update";
import { ensureNoidbActionSession } from "@/lib/wms/noidb-action-session-client";
import { wmsColors } from "@/lib/wms/ui-tokens";

/**
 * 상품공급상태 (2026-10-07 간소화)
 * SKU ID 기준으로 제품DB의 상품명·발주가능상태·바코드만 쿠팡 최신값으로 맞춘다.
 * 신규 승인 연결은 WIMS 등록상태 화면이 맡고, 제품DB 행은 추가하지 않는다.
 * 화면을 열 때 자동으로 조회하지 않는다 — 버튼을 누를 때만 G드라이브 최신 엑셀로 확인한다.
 * (2026-10-08 확장 화면 수집은 Supplier Hub가 중간에 비워져 삭제 — 엑셀 다운로드만 쓴다.)
 */
export default function SupplyStatusAuditPanel() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [audit, setAudit] = useState<SupplyStatusAudit | null>(null);
  // 바뀔 항목 목록을 종류(상품명·발주가능상태·바코드)별로 골라 본다. ""는 전체.
  const [filter, setFilter] = useState("");

  async function runAudit(preserveMessage = false): Promise<boolean> {
    if (loading) return false;
    setLoading(true);
    setError("");
    if (!preserveMessage) setMessage("");
    try {
      const response = await fetch(`/api/wms/supply-status/audit?t=${Date.now()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "상품공급상태 확인에 실패했습니다.");
      if (data.fileFound === false) throw new Error("G드라이브에서 상품공급상태 파일을 찾지 못했습니다.");
      setAudit(data as SupplyStatusAudit);
      setFilter("");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "상품공급상태 확인에 실패했습니다.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function applyChanges() {
    if (!audit || applying || audit.changeCount === 0) return;
    const confirmed = window.confirm(
      `제품DB ${audit.changeCount.toLocaleString()}건을 쿠팡 최신값으로 바꿉니다.\n\n` +
      `SKU ID가 같은 행의 상품명·발주가능상태·바코드만 바뀝니다.\n` +
      `반영 전에 제품DB 전체를 백업하며, 새 행은 만들지 않습니다.`
    );
    if (!confirmed) return;
    setApplying(true);
    setError("");
    setMessage("");
    try {
      if (!await ensureNoidbActionSession()) return;
      const response = await fetch("/api/wms/supply-status/audit/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "안전한 상품공급상태 변경 반영", dryRunToken: audit.dryRunToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "반영에 실패했습니다.");
      setMessage(data.applied ? `${Number(data.writtenRowCount || 0).toLocaleString()}건 반영 완료 · 백업 ${data.backupSheetName || "완료"}` : "바꿀 항목이 없습니다.");
      await runAudit(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "반영에 실패했습니다.");
    } finally {
      setApplying(false);
    }
  }

  const filters = [
    { key: "", label: "전체", count: audit?.changeCount ?? 0 },
    { key: "상품명", label: "상품명", count: audit?.nameChangeCount ?? 0 },
    { key: "발주가능상태", label: "발주상태", count: audit?.availabilityChangeCount ?? 0 },
    { key: "바코드", label: "바코드", count: audit?.barcodeChangeCount ?? 0 },
  ];
  const shownChanges = audit ? audit.changes.filter(change => !filter || change.fields.some(field => field.startsWith(filter))) : [];

  return (
    <section id="supply-status-audit" className="wms-automation-card" style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "14px", padding: "14px", background: wmsColors.surfaceBeige }}>
      <strong style={{ display: "block", fontSize: "14px" }}>상품공급상태</strong>
      <button type="button" className="softBeigeButton" onClick={() => void runAudit()} disabled={loading} style={{ width: "100%", marginTop: "10px", fontSize: "15px" }}>
        {loading ? "비교 중..." : "G드라이브 최신 파일로 비교"}
      </button>
      {error && <p style={{ color: "#c0392b", fontSize: "12px", margin: "10px 0 0" }}>{error}</p>}
      {message && <p style={{ color: wmsColors.greenDark, fontSize: "12px", margin: "10px 0 0", fontWeight: 700 }}>{message}</p>}
      {audit && (
        <div style={{ marginTop: "10px" }}>
          <p style={{ color: wmsColors.muted, fontSize: "11px", margin: "0 0 8px", wordBreak: "break-all" }}>
            {audit.fileName} · {new Date(audit.fileMtime).toLocaleString("ko-KR")}
          </p>
          {audit.changeCount === 0 ? (
            <p style={{ margin: 0, padding: "10px", borderRadius: "9px", background: wmsColors.greenSoft, color: wmsColors.greenDark, fontSize: "12px", fontWeight: 700 }}>
              제품DB가 쿠팡 최신 상태와 같습니다.
            </p>
          ) : (
            <>
              <button type="button" className="softBeigeButton" onClick={applyChanges} disabled={applying} style={{ width: "100%", fontSize: "15px", opacity: applying ? 0.55 : 1 }}>
                {applying ? "백업 후 반영 중..." : `바뀔 항목 ${audit.changeCount.toLocaleString()}건 반영`}
              </button>
              <div role="group" aria-label="바뀔 항목 골라 보기" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", marginTop: "8px" }}>
                {filters.map(item => (
                  <button
                    key={item.label}
                    type="button"
                    aria-pressed={filter === item.key}
                    disabled={item.key !== "" && item.count === 0}
                    className={filter === item.key ? "softSageButton" : "softApricotButton"}
                    onClick={() => setFilter(item.key)}
                    style={{ minHeight: "38px", padding: "6px 4px", fontSize: "12px", opacity: item.key !== "" && item.count === 0 ? 0.45 : 1 }}
                  >
                    {item.label} {item.count.toLocaleString()}
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gap: "6px", marginTop: "8px", maxHeight: "280px", overflowY: "auto" }}>
                {shownChanges.map(change => (
                  <div key={change.skuId} style={{ background: "#fff", borderRadius: "8px", padding: "8px 10px", fontSize: "12px" }}>
                    <strong>SKU {change.skuId}</strong> · {change.fields.join(" · ")}
                    <div style={{ color: wmsColors.muted }}>{change.productName}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {audit.duplicateCount > 0 && (
            <p style={{ color: wmsColors.muted, fontSize: "11px", margin: "8px 0 0" }}>
              {`같은 SKU ID가 여러 번 있어 건너뜀 ${audit.duplicateCount.toLocaleString()}건: ${audit.issues.map(issue => issue.skuId).filter(Boolean).slice(0, 10).join(", ")}`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
