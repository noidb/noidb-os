"use client";

import { useEffect, useMemo, useState } from "react";
import { parseWimsClipboard, type WimsRegistrationSnapshot } from "@/lib/wms/wims-registration";
import type { WimsRegistrationAudit } from "@/lib/wms/wims-registration-audit";
import { ensureNoidbActionSession } from "@/lib/wms/noidb-action-session-client";
import { wmsColors, wmsGhostButton } from "@/lib/wms/ui-tokens";

const statusText = { reviewing: "검수중", approved: "검수완료", rejected: "반려", unknown: "확인 필요" } as const;
const STORAGE_KEY = "noidb_wims_registration_snapshot_v1";
const EXTENSION_EVENT_TYPE = "NOIDB_WIMS_EXTENSION_TRANSFER";
const EXTENSION_ACK_TYPE = "NOIDB_WIMS_EXTENSION_ACK";
const MAX_WIMS_TRANSFER_ROWS = 1000;

interface SavedSnapshot {
  capturedAt: string;
  snapshot: WimsRegistrationSnapshot;
  capture: ExtensionCaptureSummary | null;
}

interface ExtensionCaptureSummary {
  mode: "all-pages";
  totalRowCount: number;
  pageCount: number;
  pageSize: number;
}

function readExtensionCaptureSummary(payload: Record<string, unknown>, parsedRowCount: number): ExtensionCaptureSummary | null {
  if (payload.captureMode !== "all-pages") return null;
  const totalRowCount = Number(payload.totalRowCount);
  const collectedRowCount = Number(payload.collectedRowCount);
  const pageCount = Number(payload.pageCount);
  const pageSize = Number(payload.pageSize);
  const complete = payload.coverageComplete === true;
  const validCounts = [totalRowCount, collectedRowCount, pageCount, pageSize].every(value => Number.isSafeInteger(value) && value > 0);
  if (totalRowCount > MAX_WIMS_TRANSFER_ROWS) {
    throw new Error(`WIMS 검색 결과가 ${MAX_WIMS_TRANSFER_ROWS}건을 넘습니다. 등록일 범위를 줄여 다시 수집해주세요.`);
  }
  if (!complete || !validCounts || totalRowCount !== collectedRowCount || collectedRowCount !== parsedRowCount) {
    throw new Error("WIMS 전체 수집 건수가 맞지 않아 전송을 중단했습니다. Supplier Hub에서 다시 수집해주세요.");
  }
  return { mode: "all-pages", totalRowCount, pageCount, pageSize };
}

export default function WimsRegistrationImportPanel() {
  const [text, setText] = useState("");
  const [snapshot, setSnapshot] = useState<WimsRegistrationSnapshot | null>(null);
  const [capturedAt, setCapturedAt] = useState("");
  const [capture, setCapture] = useState<ExtensionCaptureSummary | null>(null);
  const [error, setError] = useState("");
  const [audit, setAudit] = useState<WimsRegistrationAudit | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [decidingRow, setDecidingRow] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("source") === "wims-extension" && params.get("transferId")) {
        setMessage("Supplier Hub에서 WIMS 전체 결과를 수집하고 있습니다. 완료될 때까지 이 화면을 그대로 두세요.");
        return;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as SavedSnapshot;
      if (!saved?.capturedAt || !Array.isArray(saved.snapshot?.rows)) return;
      setSnapshot(saved.snapshot);
      setCapturedAt(saved.capturedAt);
      setCapture(saved.capture || null);
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
      try {
        const nextSnapshot = parseWimsClipboard(incomingText);
        const nextCapture = readExtensionCaptureSummary(event.data.payload as Record<string, unknown>, nextSnapshot.rows.length);
        const nextCapturedAt = typeof event.data.payload.capturedAt === "string" ? event.data.payload.capturedAt : new Date().toISOString();
        setText(incomingText);
        setSnapshot(nextSnapshot);
        setCapturedAt(nextCapturedAt);
        setCapture(nextCapture);
        setAudit(null);
        setError("");
        setMessage(nextCapture
          ? `WIMS 전체 ${nextCapture.totalRowCount}건 · ${nextCapture.pageCount}페이지를 빠짐없이 받았습니다. 제품DB와 자동 대조합니다.`
          : `확장 기능에서 현재 화면 ${nextSnapshot.rows.length}건을 받았습니다. 제품DB와 자동 대조합니다.`);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ capturedAt: nextCapturedAt, snapshot: nextSnapshot, capture: nextCapture } satisfies SavedSnapshot));
        const completedUrl = new URL(window.location.href);
        completedUrl.searchParams.delete("source");
        completedUrl.searchParams.delete("transferId");
        window.history.replaceState(window.history.state, "", `${completedUrl.pathname}${completedUrl.search}${completedUrl.hash}`);
        window.postMessage({ type: EXTENSION_ACK_TYPE, accepted: true }, window.location.origin);
        void auditRows(nextSnapshot.rows);
      } catch (caught) {
        setText(incomingText);
        setSnapshot(null);
        setCapturedAt("");
        setCapture(null);
        setAudit(null);
        setMessage("");
        localStorage.removeItem(STORAGE_KEY);
        setError(caught instanceof Error ? caught.message : "확장 기능에서 받은 WIMS 표를 읽지 못했습니다.");
        window.postMessage({ type: EXTENSION_ACK_TYPE, accepted: false }, window.location.origin);
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
      setCapture(null);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ capturedAt: nextCapturedAt, snapshot: nextSnapshot, capture: null } satisfies SavedSnapshot));
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
    setCapture(null);
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
      if (!await ensureNoidbActionSession()) return;
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

  async function setRejectionDecision(sheetRowNumber: number, decision: "등록불가" | "재등록시도") {
    if (!snapshot || !audit || decidingRow !== null) return;
    setDecidingRow(sheetRowNumber);
    setError("");
    setMessage("");
    try {
      if (!await ensureNoidbActionSession()) return;
      const response = await fetch("/api/wms/wims-registration/rejection-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: snapshot.rows, dryRunToken: audit.dryRunToken, sheetRowNumber, decision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "반려 상태 변경에 실패했습니다.");
      setMessage(`${decision} 처리 완료${data.backupSheetName ? ` · 백업 ${data.backupSheetName}` : ""}`);
      await auditRows(snapshot.rows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "반려 상태 변경에 실패했습니다.");
    } finally {
      setDecidingRow(null);
    }
  }

  const actionRows = useMemo(() => audit?.rows.filter(row =>
    (row.wims.status === "rejected" && !["등록불가", "재등록시도"].includes(row.productDbStatus || "")) || row.type === "conflict" || (row.type === "unmatched" && row.wims.status !== "rejected") || row.type === "approved_candidate"
  ) || [], [audit]);

  function actionLabel(row: WimsRegistrationAudit["rows"][number]) {
    if (row.wims.status === "rejected") return { title: "반려 · 자동 연결 제외", color: "#c0392b", guide: "반려된 등록 건이라 SKU·바코드를 제품DB에 자동 반영하지 않습니다." };
    if (row.type === "conflict") return { title: "충돌 · 자동반영 금지", color: "#c0392b", guide: "SKU 또는 불변 바코드가 다릅니다. 기존 제품DB 행을 직접 확인하세요." };
    if (row.type === "unmatched") return { title: "미연결 · 모델SKU 확인", color: "#a06118", guide: "상품명 끝의 모델SKU와 제품DB 모델SKU가 같은지 확인하세요." };
    return { title: "승인 · 안전 연결 가능", color: wmsColors.greenDark, guide: "위의 안전 연결 버튼으로 SKU와 바코드를 기존 행에 채울 수 있습니다." };
  }

  return (
    <section id="wims-registration" className="wms-automation-card" style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "14px", padding: "14px", background: "#fff" }}>
      <strong style={{ display: "block", fontSize: "14px" }}>상품 등록 상태 확인 · WIMS</strong>
      <p style={{ color: wmsColors.muted, fontSize: "11px", margin: "4px 0 10px" }}>
        브라우저 확장 기능의 `WIMS 전체를 NOID-B로 전송`을 한 번 누르면 검색 결과의 모든 페이지를 검증해 가져옵니다. 직접 붙여넣기는 비상용입니다.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "7px", marginBottom: "10px" }}>
        <a href="/downloads/noidb-supplier-sync.zip" download style={{ ...wmsGhostButton, minHeight: "34px", padding: "0 11px", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
          확장 기능 받기·업데이트
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
            <span style={{ color: capture ? wmsColors.greenDark : wmsColors.muted, fontSize: "10px", fontWeight: capture ? 800 : 400 }}>
              {capture
                ? `전체 ${capture.totalRowCount}건 · ${capture.pageCount}페이지 완전수집 · ${new Date(capturedAt).toLocaleString("ko-KR")}`
                : capturedAt ? `현재 페이지만 확인 · ${new Date(capturedAt).toLocaleString("ko-KR")}` : "현재 붙여넣은 결과"}
            </span>
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
                        {row.wims.status === "rejected" && row.sheetRowNumber && (
                          <div className="wimsRejectionDecisionButtons">
                            <button type="button" disabled={decidingRow !== null} onClick={() => void setRejectionDecision(row.sheetRowNumber!, "등록불가")}>등록불가</button>
                            <button type="button" disabled={decidingRow !== null} onClick={() => void setRejectionDecision(row.sheetRowNumber!, "재등록시도")}>재등록시도</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {audit.pendingNotInWims.map(item => (
                    <div key={`pending-${item.sheetRowNumber}`} style={{ border: "1px solid #a0611855", borderLeft: "4px solid #a06118", borderRadius: "9px", padding: "9px 10px", fontSize: "11px" }}>
                      <strong style={{ color: "#a06118" }}>{item.modelSku || "모델SKU 확인 필요"} · WIMS 범위에서 미확인</strong>
                      <div style={{ marginTop: "2px" }}>{item.productName}</div>
                      <div style={{ color: wmsColors.muted }}>{capture ? "현재 검색 조건 밖에 있거나 아직 WIMS에 등록되지 않았는지 확인하세요." : "다른 등록일 또는 다음 WIMS 페이지에 있는지 확인하세요."} 제품DB {item.sheetRowNumber}행</div>
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
