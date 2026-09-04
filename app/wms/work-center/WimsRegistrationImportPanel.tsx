"use client";

import { useEffect, useMemo, useState } from "react";
import { parseWimsClipboard, type WimsRegistrationSnapshot } from "@/lib/wms/wims-registration";
import type { WimsRegistrationAudit } from "@/lib/wms/wims-registration-audit";
import { wmsColors, wmsGhostButton } from "@/lib/wms/ui-tokens";

const statusText = { reviewing: "검수중", approved: "검수완료", rejected: "반려", unknown: "확인 필요" } as const;
const STORAGE_KEY = "noidb_wims_registration_snapshot_v1";
const EXTENSION_EVENT_TYPE = "NOIDB_WIMS_EXTENSION_TRANSFER";
const EXTENSION_ACK_TYPE = "NOIDB_WIMS_EXTENSION_ACK";

interface SavedSnapshot {
  capturedAt: string;
  snapshot: WimsRegistrationSnapshot;
}

export default function WimsRegistrationImportPanel() {
  const [text, setText] = useState("");
  const [snapshot, setSnapshot] = useState<WimsRegistrationSnapshot | null>(null);
  const [capturedAt, setCapturedAt] = useState("");
  const [error, setError] = useState("");
  const [audit, setAudit] = useState<WimsRegistrationAudit | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as SavedSnapshot;
      if (!saved?.capturedAt || !Array.isArray(saved.snapshot?.rows)) return;
      setSnapshot(saved.snapshot);
      setCapturedAt(saved.capturedAt);
      void auditRows(saved.snapshot.rows);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    function receiveExtensionTransfer(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== EXTENSION_EVENT_TYPE) return;
      const incomingText = event.data?.payload?.text;
      if (typeof incomingText !== "string" || !incomingText.trim()) return;
      window.postMessage({ type: EXTENSION_ACK_TYPE }, window.location.origin);
      try {
        const nextSnapshot = parseWimsClipboard(incomingText);
        const nextCapturedAt = typeof event.data.payload.capturedAt === "string" ? event.data.payload.capturedAt : new Date().toISOString();
        setText(incomingText);
        setSnapshot(nextSnapshot);
        setCapturedAt(nextCapturedAt);
        setAudit(null);
        setError("");
        setMessage(`확장 기능에서 ${nextSnapshot.rows.length}건을 받았습니다. 제품DB와 자동 대조합니다.`);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ capturedAt: nextCapturedAt, snapshot: nextSnapshot } satisfies SavedSnapshot));
        void auditRows(nextSnapshot.rows);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "확장 기능에서 받은 WIMS 표를 읽지 못했습니다.");
      }
    }
    window.addEventListener("message", receiveExtensionTransfer);
    return () => window.removeEventListener("message", receiveExtensionTransfer);
  }, []);

  function inspect() {
    try {
      const nextSnapshot = parseWimsClipboard(text);
      const nextCapturedAt = new Date().toISOString();
      setSnapshot(nextSnapshot);
      setCapturedAt(nextCapturedAt);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ capturedAt: nextCapturedAt, snapshot: nextSnapshot } satisfies SavedSnapshot));
      setError("");
    } catch (caught) {
      setSnapshot(null);
      setError(caught instanceof Error ? caught.message : "WIMS 표를 읽지 못했습니다.");
    }
  }

  function clearSnapshot() {
    setText("");
    setSnapshot(null);
    setCapturedAt("");
    setError("");
      setAudit(null);
      setMessage("");
    localStorage.removeItem(STORAGE_KEY);
  }

  async function applyApprovedCandidates() {
    if (!snapshot || !audit || applying || audit.approvedCandidateCount === 0) return;
    if (!window.confirm(`검수완료·정확일치 ${audit.approvedCandidateCount}건을 기존 제품DB 행에 연결합니다.\n\n전체 시트를 먼저 백업하고 상품명·SKU ID·R바코드·현재상태만 반영합니다. 신규행은 만들지 않습니다.`)) return;
    setApplying(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/wms/wims-registration/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: snapshot.rows, dryRunToken: audit.dryRunToken, confirmation: "WIMS 검수완료 상품 연결" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "검수완료 상품 연결에 실패했습니다.");
      setMessage(data.applied ? `${data.writtenRowCount}건 연결 완료 · 백업 ${data.backupSheetName}` : "연결할 상품이 없습니다.");
      await compareProductDb();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "검수완료 상품 연결에 실패했습니다.");
    } finally {
      setApplying(false);
    }
  }

  async function auditRows(rows: WimsRegistrationSnapshot["rows"]) {
    setAuditing(true);
    setError("");
    try {
      const response = await fetch("/api/wms/wims-registration/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "제품DB 대조에 실패했습니다.");
      setAudit(data as WimsRegistrationAudit);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "제품DB 대조에 실패했습니다.");
    } finally {
      setAuditing(false);
    }
  }

  async function compareProductDb() {
    if (!snapshot || auditing) return;
    await auditRows(snapshot.rows);
  }

  const actionRows = useMemo(() => audit?.rows.filter(row =>
    row.wims.status === "rejected" || row.type === "conflict" || row.type === "unmatched" || row.type === "approved_candidate"
  ) || [], [audit]);

  function actionLabel(row: WimsRegistrationAudit["rows"][number]) {
    if (row.wims.status === "rejected") return { title: "반려 · 재등록 판단", color: "#c0392b", guide: "Supplier Hub에서 반려사유를 확인한 뒤 수정 재등록 또는 종료를 선택하세요." };
    if (row.type === "conflict") return { title: "충돌 · 자동반영 금지", color: "#c0392b", guide: "SKU 또는 불변 바코드가 다릅니다. 기존 제품DB 행을 직접 확인하세요." };
    if (row.type === "unmatched") return { title: "미연결 · 모델SKU 확인", color: "#a06118", guide: "상품명 끝의 모델SKU와 제품DB 모델SKU가 같은지 확인하세요." };
    return { title: "승인 · 안전 연결 가능", color: wmsColors.greenDark, guide: "위의 안전 연결 버튼으로 SKU와 바코드를 기존 행에 채울 수 있습니다." };
  }

  return (
    <section id="wims-registration" className="wms-automation-card" style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "14px", padding: "14px", background: "#fff" }}>
      <strong style={{ display: "block", fontSize: "14px" }}>상품 등록 상태 확인 · WIMS</strong>
      <p style={{ color: wmsColors.muted, fontSize: "11px", margin: "4px 0 10px" }}>
        브라우저 확장 기능의 `NOID-B로 WIMS 전송` 버튼을 누르면 자동으로 들어옵니다. 직접 붙여넣기는 비상용이며, 읽기 전용 대조만 자동 실행됩니다.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "7px", marginBottom: "10px" }}>
        <a href="/downloads/noidb-supplier-sync.zip" download style={{ ...wmsGhostButton, minHeight: "34px", padding: "0 11px", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
          최초 1회 확장 기능 받기
        </a>
        <span style={{ color: wmsColors.muted, fontSize: "10px" }}>압축 해제 → Chrome 확장 프로그램 → 개발자 모드 → 압축해제된 확장 프로그램 로드</span>
      </div>
      <textarea
        value={text}
        onChange={event => setText(event.target.value)}
        placeholder="상품명부터 상태·SKU ID가 포함된 WIMS 표를 여기에 붙여넣기"
        rows={4}
        style={{ width: "100%", resize: "vertical", border: `1px solid ${wmsColors.border}`, borderRadius: "9px", padding: "9px", fontSize: "12px", boxSizing: "border-box" }}
      />
      <button type="button" onClick={inspect} disabled={!text.trim()} style={{ ...wmsGhostButton, minHeight: "36px", marginTop: "8px", padding: "0 14px", opacity: text.trim() ? 1 : 0.55 }}>
        등록상태 분류
      </button>
      {error && <p style={{ color: "#c0392b", fontSize: "12px", margin: "8px 0 0" }}>{error}</p>}
      {message && <p style={{ color: wmsColors.greenDark, fontSize: "12px", margin: "8px 0 0", fontWeight: 700 }}>{message}</p>}
      {snapshot && (
        <div style={{ marginTop: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "8px" }}>
            <span style={{ color: wmsColors.muted, fontSize: "10px" }}>{capturedAt ? `마지막 확인 ${new Date(capturedAt).toLocaleString("ko-KR")}` : "현재 붙여넣은 결과"}</span>
            <button type="button" onClick={clearSnapshot} style={{ ...wmsGhostButton, minHeight: "30px", padding: "0 9px", fontSize: "10px" }}>저장 결과 지우기</button>
          </div>
          <div className="wms-supply-audit-grid">
            <Summary label="WIMS 확인 행" value={snapshot.rows.length} />
            <Summary label="검수중" value={snapshot.reviewingCount} />
            <Summary label="검수완료" value={snapshot.approvedCount} good />
            <Summary label="반려" value={snapshot.rejectedCount} warning />
            <Summary label="상태 확인 필요" value={snapshot.unknownCount} warning />
          </div>
          <button type="button" onClick={compareProductDb} disabled={auditing} style={{ ...wmsGhostButton, minHeight: "34px", marginTop: "9px", padding: "0 11px" }}>{auditing ? "제품DB 대조 중..." : "제품DB와 읽기 전용 대조"}</button>
          {audit && <p style={{ fontSize: "11px", margin: "8px 0 0", color: wmsColors.ink }}>연결 가능 {audit.approvedCandidateCount}건 · 검수중 {audit.reviewingCount}건 · 반려 {audit.rejectedCount}건 · 이미 연결 {audit.alreadyLinkedCount}건 · 충돌 {audit.conflictCount}건 · 미연결 {audit.unmatchedCount}건 · 붙여넣은 범위에서 확인 안 된 승인대기 {audit.pendingNotInWimsCount}건</p>}
          {audit && audit.approvedCandidateCount > 0 && <button type="button" onClick={applyApprovedCandidates} disabled={applying} style={{ ...wmsGhostButton, minHeight: "34px", marginTop: "8px", padding: "0 11px", color: wmsColors.greenDark }}>{applying ? "백업 후 연결 중..." : `검수완료 ${audit.approvedCandidateCount}건 안전 연결`}</button>}
          {audit && (
            <div style={{ marginTop: "13px" }}>
              <strong style={{ display: "block", fontSize: "13px" }}>지금 조치할 상품 {actionRows.length + audit.pendingNotInWimsCount}건</strong>
              {actionRows.length === 0 && audit.pendingNotInWimsCount === 0 ? (
                <p style={{ margin: "7px 0 0", padding: "10px", borderRadius: "9px", background: wmsColors.greenSoft, color: wmsColors.greenDark, fontSize: "11px", fontWeight: 700 }}>현재 WIMS에서 조치할 상품이 없습니다.</p>
              ) : (
                <div style={{ display: "grid", gap: "7px", marginTop: "8px", maxHeight: "320px", overflowY: "auto" }}>
                  {actionRows.map((row, index) => {
                    const action = actionLabel(row);
                    return (
                      <div key={`${row.wims.estimateId}-${row.wims.modelSku}-${index}`} style={{ border: `1px solid ${action.color}55`, borderLeft: `4px solid ${action.color}`, borderRadius: "9px", padding: "9px 10px", fontSize: "11px" }}>
                        <strong style={{ color: action.color }}>{row.wims.modelSku || "모델SKU 확인 필요"} · {action.title}</strong>
                        <div style={{ marginTop: "2px" }}>{row.wims.productName}</div>
                        <div style={{ color: wmsColors.muted, marginTop: "2px" }}>{action.guide}</div>
                        <div style={{ color: wmsColors.muted }}>{[row.wims.skuId && `SKU ${row.wims.skuId}`, row.wims.barcode, row.wims.estimateId && `견적서 ${row.wims.estimateId}`].filter(Boolean).join(" · ") || "SKU·바코드 없음"}</div>
                      </div>
                    );
                  })}
                  {audit.pendingNotInWims.map(item => (
                    <div key={`pending-${item.sheetRowNumber}`} style={{ border: "1px solid #a0611855", borderLeft: "4px solid #a06118", borderRadius: "9px", padding: "9px 10px", fontSize: "11px" }}>
                      <strong style={{ color: "#a06118" }}>{item.modelSku || "모델SKU 확인 필요"} · WIMS 범위에서 미확인</strong>
                      <div style={{ marginTop: "2px" }}>{item.productName}</div>
                      <div style={{ color: wmsColors.muted }}>다른 등록일 또는 다음 WIMS 페이지에 있는지 확인하세요. 제품DB {item.sheetRowNumber}행</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <details style={{ marginTop: "10px" }}>
            <summary style={{ cursor: "pointer", color: wmsColors.muted, fontSize: "11px", fontWeight: 700 }}>정상 상품을 포함한 WIMS 전체 {snapshot.rows.length}건 보기</summary>
            <div style={{ display: "grid", gap: "6px", marginTop: "9px", maxHeight: "260px", overflowY: "auto" }}>
              {snapshot.rows.map((row, index) => (
                <div key={`${row.estimateId}-${row.modelSku}-${index}`} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "8px", padding: "8px 10px", fontSize: "11px" }}>
                  <strong style={{ color: row.status === "rejected" ? "#c0392b" : row.status === "approved" ? wmsColors.greenDark : wmsColors.ink }}>{row.modelSku || "모델SKU 확인 필요"} · {statusText[row.status]}</strong>
                  <div>{row.productName}</div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

function Summary({ label, value, good = false, warning = false }: { label: string; value: number; good?: boolean; warning?: boolean }) {
  const color = warning && value > 0 ? "#c0392b" : good ? wmsColors.greenDark : wmsColors.ink;
  return <div style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "9px 10px" }}><span style={{ display: "block", color: wmsColors.muted, fontSize: "10px" }}>{label}</span><strong style={{ color, fontSize: "17px" }}>{value.toLocaleString()}건</strong></div>;
}
