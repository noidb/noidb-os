"use client";

import { useState } from "react";
import type { SupplyStatusAudit, SupplyStatusAuditIssue } from "@/lib/wms/supply-status-update";
import { wmsColors, wmsGhostButton } from "@/lib/wms/ui-tokens";

const issueLabel: Record<SupplyStatusAuditIssue["type"], string> = {
  duplicate: "중복 후보",
  barcode_conflict: "바코드 충돌",
  unmatched: "미매칭",
};

export default function SupplyStatusAuditPanel() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [audit, setAudit] = useState<SupplyStatusAudit | null>(null);
  const [showIssues, setShowIssues] = useState(false);

  async function runAudit(preserveMessage = false) {
    if (loading) return;
    setLoading(true);
    setError("");
    if (!preserveMessage) setMessage("");
    try {
      const response = await fetch(`/api/wms/supply-status/audit?t=${Date.now()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "안전 진단에 실패했습니다.");
      setAudit(data as SupplyStatusAudit);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "안전 진단에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function applySafeUpdates() {
    if (!audit || applying || audit.safeUpdateCount === 0) return;
    const confirmed = window.confirm(
      `안전한 변경 ${audit.safeUpdateCount.toLocaleString()}건을 제품DB에 반영합니다.\n\n` +
      `기존 SKU는 상품명·발주가능상태만 갱신하고 SKU ID·바코드는 수정하지 않습니다.\n` +
      `바코드 충돌 ${audit.barcodeConflictCount}건과 중복 ${audit.duplicateCount}건은 건드리지 않습니다.\n` +
      `제품DB 신규행은 만들지 않습니다.`
    );
    if (!confirmed) return;
    setApplying(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/wms/supply-status/audit/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "안전한 상품공급상태 변경 반영", dryRunToken: audit.dryRunToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "안전 항목 반영에 실패했습니다.");
      setMessage(
        data.applied
          ? `반영 완료 · 신규 승인 ${Number(data.newApprovalCount || 0).toLocaleString()}건 · 기존 SKU ${Number(data.existingSkuUpdateCount || 0).toLocaleString()}건 · 백업 ${data.backupSheetName || "완료"}`
          : "반영할 안전 항목이 없습니다."
      );
      await runAudit(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "안전 항목 반영에 실패했습니다.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <section id="supply-status-audit" style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "14px", padding: "14px", marginBottom: "18px", background: wmsColors.surfaceBeige }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <strong style={{ display: "block", fontSize: "14px" }}>상품공급상태 안전 진단</strong>
          <span style={{ color: wmsColors.muted, fontSize: "11px" }}>진단은 읽기 전용 · 반영은 최종 확인 후 실행 · 제품DB 신규행 0건</span>
        </div>
        <button type="button" onClick={() => void runAudit()} disabled={loading} style={{ ...wmsGhostButton, minHeight: "36px", padding: "0 14px" }}>
          {loading ? "진단 중..." : "최신 파일 진단"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b", fontSize: "12px", margin: "10px 0 0" }}>{error}</p>}
      {message && <p style={{ color: wmsColors.greenDark, fontSize: "12px", margin: "10px 0 0", fontWeight: 700 }}>{message}</p>}

      {audit && (
        <div style={{ marginTop: "12px" }}>
          <p style={{ color: wmsColors.muted, fontSize: "11px", margin: "0 0 10px", wordBreak: "break-all" }}>
            {audit.fileName} · {new Date(audit.fileMtime).toLocaleString("ko-KR")}
          </p>
          <div className="wms-supply-audit-grid">
            <AuditValue label="다운로드 전체" value={audit.downloadedCount} />
            <AuditValue label="R바코드 관리대상" value={audit.rocketBarcodeCount} />
            <AuditValue label="S바코드 제외" value={audit.excludedSBarcodeCount} />
            <AuditValue label="신규 승인 후보" value={audit.newApprovalCandidateCount} good />
            <AuditValue label="등록상태 확인 필요" value={audit.registrationStatusCheckRequiredCount ?? audit.awaitingApprovalCount} warning />
            <AuditValue label="기존 SKU 연결" value={audit.existingSkuMatchedCount} />
            <AuditValue label="상품명 변경" value={audit.existingNameChangeCount} />
            <AuditValue label="발주상태 변경" value={audit.existingAvailabilityChangeCount} />
            <AuditValue label="안전 갱신 대상" value={audit.safeUpdateCount} good />
            <AuditValue label="중복 후보" value={audit.duplicateCount} warning />
            <AuditValue label="바코드 충돌" value={audit.barcodeConflictCount} warning />
            <AuditValue label="미매칭" value={audit.unmatchedCount} warning />
            <AuditValue label="신규행 생성 예정" value={audit.proposedNewRowCount} good />
          </div>

          <button
            type="button"
            onClick={applySafeUpdates}
            disabled={applying || audit.safeUpdateCount === 0}
            style={{ ...wmsGhostButton, minHeight: "36px", marginTop: "10px", padding: "0 12px", opacity: applying || audit.safeUpdateCount === 0 ? 0.55 : 1 }}
          >
            {applying ? "안전 항목 반영 중..." : `안전 항목 ${audit.safeUpdateCount.toLocaleString()}건 반영`}
          </button>

          {audit.issues.length > 0 && (
            <>
              <button type="button" onClick={() => setShowIssues(value => !value)} style={{ ...wmsGhostButton, minHeight: "32px", marginTop: "10px", padding: "0 10px", fontSize: "11px" }}>
                {showIssues ? "확인 필요 숨기기" : `확인 필요 ${audit.issues.length}건 보기`}
              </button>
              {showIssues && (
                <div style={{ display: "grid", gap: "6px", marginTop: "8px", maxHeight: "280px", overflowY: "auto" }}>
                  {audit.issues.map((issue, index) => (
                    <div key={`${issue.type}-${issue.sheetRowNumber || issue.skuId || index}-${index}`} style={{ background: "#fff", borderRadius: "8px", padding: "8px 10px", fontSize: "11px" }}>
                      <strong style={{ color: issue.type === "unmatched" ? wmsColors.muted : wmsColors.warn }}>{issueLabel[issue.type]}</strong>
                      <div>{issue.modelSku || issue.skuId || `제품DB ${issue.sheetRowNumber || "-"}행`} · {issue.message}</div>
                      {(issue.productName || issue.optionName) && <div style={{ color: wmsColors.muted }}>{[issue.productName, issue.optionName].filter(Boolean).join(" · ")}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function AuditValue({ label, value, good = false, warning = false }: { label: string; value: number; good?: boolean; warning?: boolean }) {
  const color = warning && value > 0 ? wmsColors.warn : good ? wmsColors.greenDark : wmsColors.ink;
  return (
    <div style={{ background: "#fff", border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "9px 10px" }}>
      <span style={{ display: "block", color: wmsColors.muted, fontSize: "10px" }}>{label}</span>
      <strong style={{ display: "block", color, fontSize: "17px", marginTop: "2px" }}>{value.toLocaleString()}건</strong>
    </div>
  );
}
