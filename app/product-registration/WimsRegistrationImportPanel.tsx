"use client";

import { useEffect, useMemo, useState } from "react";
import { parseWimsClipboard, wimsRowKey, type WimsRegistrationSnapshot } from "@/lib/wms/wims-registration";
import type { WimsRegistrationAudit } from "@/lib/wms/wims-registration-audit";
import { ensureNoidbActionSession } from "@/lib/wms/noidb-action-session-client";
import { wmsColors } from "@/lib/wms/ui-tokens";

// 2026-11-04 상품등록일이 이 날짜 이전인 WIMS 줄은 화면·제품DB 대조에서 아예 뺀다(저장된 원본 데이터는 그대로 둔다).
const WIMS_SHOW_FROM = "2026-08-27";
function dropOldRegistrations(snapshot: WimsRegistrationSnapshot): WimsRegistrationSnapshot {
  const rows = snapshot.rows.filter(row => {
    const match = String(row.registeredAt || "").trim().match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
    if (!match) return true; // 등록일을 읽을 수 없는 줄은 빼지 않는다
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` >= WIMS_SHOW_FROM;
  });
  if (rows.length === snapshot.rows.length) return snapshot;
  return {
    rows,
    reviewingCount: rows.filter(row => row.status === "reviewing").length,
    approvedCount: rows.filter(row => row.status === "approved").length,
    rejectedCount: rows.filter(row => row.status === "rejected").length,
    unknownCount: rows.filter(row => row.status === "unknown").length,
  };
}

const statusText = { reviewing: "검수중", approved: "검수완료", rejected: "반려", unknown: "확인 필요" } as const;
const STORAGE_KEY = "noidb_wims_registration_snapshot_v1";
const EXTENSION_EVENT_TYPE = "NOIDB_WIMS_EXTENSION_TRANSFER";
const EXTENSION_ACK_TYPE = "NOIDB_WIMS_EXTENSION_ACK";
const MAX_WIMS_TRANSFER_ROWS = 1000;
const RECENT_DAYS = 14;

interface PreviousStatuses {
  capturedAt: string;
  statuses: Record<string, string>;
}

interface SavedSnapshot {
  previous?: PreviousStatuses | null;
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
  // 2026-11-10: '최근 14일 등록분 결과'의 날짜 줄은 기본 접힘. 누르면 그날 건(검수중 포함)이 펼쳐진다.
  const [openDays, setOpenDays] = useState<Record<number, boolean>>({});
  // 2026-11-04: 지난 전송 때의 상태(새 결과 표시용). 서버가 상태가 달라질 때만 갱신한다.
  const [previous, setPrevious] = useState<PreviousStatuses | null>(null);

  // 2026-10-15: 새로 가져오기 전까지 마지막 결과를 계속 보여준다. 이 기기 저장본을 바로 보여주고,
  // 서버 저장본(다른 PC·모바일에서 가져온 것)이 더 새로우면 그것으로 바꾼다. 수집 중에도 지난 결과는 남겨 둔다.
  useEffect(() => {
    let cancelled = false;
    let shownAt = "";
    const show = (saved: SavedSnapshot) => {
      if (cancelled || !saved?.capturedAt || !Array.isArray(saved.snapshot?.rows) || saved.capturedAt <= shownAt) return;
      shownAt = saved.capturedAt;
      const visible = dropOldRegistrations(saved.snapshot);
      setSnapshot(visible);
      setCapturedAt(saved.capturedAt);
      setCapture(saved.capture || null);
      setPrevious(saved.previous || null);
      setAudit(null);
      void auditRows(visible.rows);
    };
    const params = new URLSearchParams(window.location.search);
    if (params.get("source") === "wims-extension" && params.get("transferId")) {
      setMessage("Supplier Hub에서 WIMS 전체 결과를 수집하고 있습니다. 완료될 때까지 이 화면을 그대로 두세요.");
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) show(JSON.parse(raw) as SavedSnapshot);
    } catch { /* 이 기기 저장본이 깨졌으면 서버 저장본을 쓴다 */ }
    fetch("/api/wms/wims-registration/last", { cache: "no-store" })
      .then(response => response.json())
      .then(data => {
        if (!data?.saved) return;
        show(data.saved as SavedSnapshot);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data.saved)); } catch { /* 저장 공간 부족 등 — 화면 표시는 그대로 */ }
      })
      .catch(() => { /* 오프라인 등 — 이 기기 저장본으로 계속 */ });
    return () => { cancelled = true; };
  }, []);

  function persistSnapshot(saved: SavedSnapshot) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* 이 기기 저장 실패해도 서버에는 남긴다 */ }
    void fetch("/api/wms/wims-registration/last", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(saved) })
      .then(response => response.json())
      .then(data => {
        if (!data?.ok) return;
        const nextPrevious = (data.previous || null) as PreviousStatuses | null;
        setPrevious(nextPrevious);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, previous: nextPrevious })); } catch { /* 화면 표시는 그대로 */ }
      })
      .catch(() => undefined);
  }

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
        const visibleSnapshot = dropOldRegistrations(nextSnapshot);
        setSnapshot(visibleSnapshot);
        setCapturedAt(nextCapturedAt);
        setCapture(nextCapture);
        setAudit(null);
        setError("");
        setMessage(nextCapture
          ? `WIMS 전체 ${nextCapture.totalRowCount}건 · ${nextCapture.pageCount}페이지를 빠짐없이 받았습니다. 제품DB와 자동 대조합니다.`
          : `확장 기능에서 현재 화면 ${nextSnapshot.rows.length}건을 받았습니다. 제품DB와 자동 대조합니다.`);
        persistSnapshot({ capturedAt: nextCapturedAt, snapshot: nextSnapshot, capture: nextCapture });
        const completedUrl = new URL(window.location.href);
        completedUrl.searchParams.delete("source");
        completedUrl.searchParams.delete("transferId");
        window.history.replaceState(window.history.state, "", `${completedUrl.pathname}${completedUrl.search}${completedUrl.hash}`);
        window.postMessage({ type: EXTENSION_ACK_TYPE, accepted: true }, window.location.origin);
        void auditRows(visibleSnapshot.rows);
      } catch (caught) {
        // 새 결과를 못 읽어도 지난 결과는 지우지 않고 그대로 보여준다.
        setText(incomingText);
        setMessage("");
        setError(`${caught instanceof Error ? caught.message : "확장 기능에서 받은 WIMS 표를 읽지 못했습니다."} 아래는 지난번 가져온 결과입니다.`);
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
      setSnapshot(dropOldRegistrations(nextSnapshot));
      setCapturedAt(nextCapturedAt);
      setCapture(null);
      persistSnapshot({ capturedAt: nextCapturedAt, snapshot: nextSnapshot, capture: null });
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "WIMS 표를 읽지 못했습니다.");
    }
  }

  /** 이미 반영된 기존상품승인대기 옵션 아래로 같은 모델 줄을 붙인다(줄 위치만 이동). */
  async function regroupPendingModels() {
    if (applying) return;
    setApplying(true);
    setError("");
    setMessage("");
    try {
      if (!await ensureNoidbActionSession()) return;
      const response = await fetch("/api/wms/wims-registration/regroup", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "모델별 정렬에 실패했습니다.");
      setMessage(data.movedModelCount > 0 ? `${data.movedModelCount}개 모델 정렬 완료 · 백업 ${data.backupSheetName}` : "정렬할 옵션이 없습니다. 이미 모델별로 붙어 있습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "모델별 정렬에 실패했습니다.");
    } finally {
      setApplying(false);
    }
  }

  async function applyApprovedCandidates() {
    if (!snapshot || !audit || applying || (audit.approvedCandidateCount + audit.reviewingCandidateCount) === 0) return;
    if (!window.confirm("검수완료 " + audit.approvedCandidateCount + "건 연결 · 검수중 " + audit.reviewingCandidateCount + "건 승인대기 상태 반영\n\n전체 시트를 먼저 백업합니다. 검수중은 현재상태만 변경하고, 검수완료는 상품명·SKU ID·R바코드·현재상태를 반영합니다. 누적입고·창고번호·발주가능상태 등 다른 정보는 유지합니다.")) return;
    setApplying(true);
    setError("");
    setMessage("");
    try {
      if (!await ensureNoidbActionSession()) return;
      const response = await fetch("/api/wms/wims-registration/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: snapshot.rows, dryRunToken: audit.dryRunToken, confirmation: "WIMS 검수상태 반영", includeReviewing: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "WIMS 검수상태 반영에 실패했습니다.");
      const regroupNote = data.regroupError ? ` · 모델별 정렬 실패: ${data.regroupError} (아래 '모델별 정렬' 버튼으로 다시 시도)` : data.regroupedModelCount > 0 ? ` · ${data.regroupedModelCount}개 모델 옵션을 승인대기 옵션 아래로 정렬` : "";
      setMessage(data.applied ? `${data.writtenRowCount}건 검수상태 반영·재확인 완료 · 백업 ${data.backupSheetName}${regroupNote}` : "반영할 상품이 없습니다.");
      await compareProductDb();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "WIMS 검수상태 반영에 실패했습니다.");
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

  const allActionRows = useMemo(() => audit?.rows.filter(row =>
    (row.wims.status === "rejected" && !["등록불가", "재등록시도"].includes(row.productDbStatus || "")) || row.type === "conflict" || (row.type === "unmatched" && row.wims.status !== "rejected") || row.type === "approved_candidate" || (row.type === "reviewing" && Boolean(row.proposedStatus))
  ) || [], [audit]);
  // 지난 건은 접어두고, 바로 반영할 수 있는 건과 최근 등록 건만 보여준다.
  const isApplicable = (row: WimsRegistrationAudit["rows"][number]) => row.type === "approved_candidate" || (row.type === "reviewing" && Boolean(row.proposedStatus));
  const isRecent = (row: WimsRegistrationAudit["rows"][number]) => {
    const match = String(row.wims.registeredAt || "").trim().match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
    if (!match) return false;
    const stamp = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
    return Date.now() - stamp <= RECENT_DAYS * 24 * 60 * 60 * 1000;
  };
  // 2026-10-23: 반려 건은 등록일이 오래돼도 사용자가 처리 결정(등록불가·재등록시도)을 해야 하므로 항상 맨 위에 둔다.
  const isRejectedPending = (row: WimsRegistrationAudit["rows"][number]) => row.wims.status === "rejected";
  const actionRows = useMemo(() => allActionRows
    .filter(row => isRejectedPending(row) || isApplicable(row) || isRecent(row))
    .sort((a, b) => Number(isRejectedPending(b)) - Number(isRejectedPending(a))), [allActionRows]);
  const pastRows = useMemo(() => allActionRows.filter(row => !isRejectedPending(row) && !isApplicable(row) && !isRecent(row)), [allActionRows]);

  // 2026-11-04: 맨 위에는 '최근 14일 등록분 결과'만 간단히 보여준다(나머지는 '자세히 보기'로 접음).
  // 검수 결과(완료·반려)는 보통 1~2주 뒤에 나오므로 오늘 건만 보면 결과를 놓친다.
  const resultSummary = useMemo(() => {
    if (!snapshot) return null;
    const pad = (value: number) => String(value).padStart(2, "0");
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayOf = (registeredAt: string) => {
      const match = String(registeredAt || "").trim().match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
      if (!match) return null;
      const stamp = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
      return { label: `${pad(Number(match[2]))}/${pad(Number(match[3]))}`, sortKey: stamp, age: Math.round((todayStart - stamp) / 86400000) };
    };
    type DayGroup = { label: string; sortKey: number; age: number; reviewing: number; approved: number; rejected: number; unknown: number; total: number; rows: WimsRegistrationSnapshot["rows"] };
    const days = new Map<number, DayGroup>();
    let slow = 0, slowMax = 0, rejectedRecent = 0;
    for (const row of snapshot.rows) {
      const day = dayOf(row.registeredAt);
      if (!day) continue;
      if (row.status === "reviewing" && day.age > RECENT_DAYS && day.age <= 60) { slow += 1; slowMax = Math.max(slowMax, day.age); }
      if (day.age < 0 || day.age > RECENT_DAYS) continue;
      const group = days.get(day.sortKey) || { ...day, reviewing: 0, approved: 0, rejected: 0, unknown: 0, total: 0, rows: [] };
      group[row.status] += 1;
      group.total += 1;
      group.rows.push(row);
      if (row.status === "rejected") rejectedRecent += 1;
      days.set(day.sortKey, group);
    }
    // 지난 전송과 비교해 검수중 → 완료/반려로 바뀐 건
    const newResults = previous ? snapshot.rows.filter(row => {
      const before = previous.statuses[wimsRowKey(row)];
      return before && (before === "reviewing" || before === "unknown") && (row.status === "approved" || row.status === "rejected");
    }) : [];
    const recentTotal = [...days.values()].reduce((sum, group) => sum + group.total, 0);
    return { days: [...days.values()].sort((a, b) => b.sortKey - a.sortKey), recentTotal, rejectedRecent, slow, slowMax, newResults };
  }, [snapshot, previous]);
  const recentRejectedRows = useMemo(() => audit?.rows.filter(row => row.wims.status === "rejected" && !["등록불가", "재등록시도"].includes(row.productDbStatus || "") && isRecent(row)) || [], [audit]);

  function actionLabel(row: WimsRegistrationAudit["rows"][number]) {
    if (row.type === "rejected") return { title: "반려 · 자동 연결 제외", color: "#c0392b", guide: "반려된 등록 건이라 SKU·바코드를 제품DB에 자동 반영하지 않습니다." };
    if (row.type === "conflict") return { title: "충돌 · 자동반영 금지", color: "#c0392b", guide: row.message };
    if (row.type === "unmatched") return { title: "미연결 · 모델SKU 확인", color: "#a06118", guide: row.message };
    if (row.type === "reviewing") return { title: "검수중 · " + row.proposedStatus + " 반영 가능", color: wmsColors.greenDark, guide: row.message };
    return { title: "승인 · 안전 연결 가능", color: wmsColors.greenDark, guide: "위의 검수상태 반영 버튼으로 SKU와 바코드를 기존 행에 채울 수 있습니다." };
  }

  function renderActionRow(row: WimsRegistrationAudit["rows"][number], index: number) {
    const action = actionLabel(row);
    // 2026-11-10: 반려 카드는 검수중 줄처럼 간단히(모델SKU·상품명) + 오른쪽에 색 있는 버튼 두 개.
    if (row.type === "rejected") {
      return (
        <div key={`${row.wims.estimateId}-${row.wims.modelSku}-${index}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", border: `1px solid ${action.color}55`, borderLeft: `4px solid ${action.color}`, borderRadius: "9px", padding: "8px 12px", fontSize: "12px", background: "#fff" }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ color: action.color }}>{row.wims.modelSku || "모델SKU 확인 필요"} · 반려</strong>
            <div style={{ marginTop: "2px", overflowWrap: "anywhere" }}>{row.wims.productName}</div>
          </div>
          {row.sheetRowNumber && (
            <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
              <button type="button" className="softPinkButton" style={{ minHeight: "32px", padding: "4px 12px", fontSize: "12px" }} disabled={decidingRow !== null} onClick={() => void setRejectionDecision(row.sheetRowNumber!, "등록불가")}>등록불가</button>
              <button type="button" className="softSageButton" style={{ minHeight: "32px", padding: "4px 12px", fontSize: "12px" }} disabled={decidingRow !== null} onClick={() => void setRejectionDecision(row.sheetRowNumber!, "재등록시도")}>재등록시도</button>
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={`${row.wims.estimateId}-${row.wims.modelSku}-${index}`} style={{ border: `1px solid ${action.color}55`, borderLeft: `4px solid ${action.color}`, borderRadius: "9px", padding: "10px 12px", fontSize: "12px", background: "#fff" }}>
        <strong style={{ color: action.color }}>{row.wims.modelSku || "모델SKU 확인 필요"} · {action.title}</strong>
        <div style={{ marginTop: "2px" }}>{row.wims.productName}</div>
        <div style={{ color: wmsColors.muted, marginTop: "2px" }}>{action.guide}</div>
        <div style={{ color: wmsColors.muted }}>{[row.wims.skuId && `SKU ${row.wims.skuId}`, row.wims.barcode, row.wims.estimateId && `견적서 ${row.wims.estimateId}`].filter(Boolean).join(" · ") || "SKU·바코드 없음"}</div>
      </div>
    );
  }

  return (
    // 2026-10-20: 옆 칸(상품공급상태)이 입고결과 확인으로 옮겨져, 위 '카테고리별 묶음 견적서'와 같은 넓은 칸으로 바꿈.
    <section id="wims-registration" className="quoteQueuePanel wimsWidePanel" style={{ marginTop: 0 }}>
      <div className="quoteQueueHeader">
        <div>
          <h3>WIMS 상품등록상태</h3>
          <p>열린 WIMS 화면에서 확장 기능의 `WIMS 전체를 NOID-B로 전송`을 누르면 자동으로 가져옵니다.</p>
        </div>
        {/* 2026-10-15: WIMS 화면으로 바로 가는 버튼. 그 화면에 확장 기능의 전송 버튼이 자동으로 뜬다. */}
        <div className="wimsHeaderButtons">
          <a href="https://supplier.coupang.com/qvt/wims" target="_blank" rel="noopener noreferrer" className="softSageButton" style={{ textDecoration: "none" }}>
            상품등록상태 확인하기
          </a>
          <a href="/downloads/noidb-supplier-sync.zip" download className="softBeigeButton" style={{ textDecoration: "none" }}>
            확장 기능 v1.3.6 받기
          </a>
        </div>
      </div>
      {error && <p style={{ color: "#c0392b", fontSize: "12px", margin: "8px 0 0" }}>{error}</p>}
      {message && <p style={{ color: wmsColors.greenDark, fontSize: "12px", margin: "8px 0 0", fontWeight: 700 }}>{message}</p>}
      {snapshot && (
        <div style={{ marginTop: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "8px" }}>
            <span style={{ color: capture ? wmsColors.greenDark : wmsColors.muted, fontSize: "12px", fontWeight: capture ? 800 : 400 }}>
              {capture
                ? `전체 ${capture.totalRowCount}건 · ${capture.pageCount}페이지 완전수집 · ${new Date(capturedAt).toLocaleString("ko-KR")}`
                : capturedAt ? `현재 페이지만 확인 · ${new Date(capturedAt).toLocaleString("ko-KR")}` : "현재 붙여넣은 결과"}
            </span>
          </div>
          {resultSummary && (
            <div style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "14px 16px", background: "#fff", marginBottom: "12px" }}>
              <strong style={{ display: "block", fontSize: "15px" }}>최근 {RECENT_DAYS}일 등록분 결과</strong>
              {resultSummary.recentTotal === 0 ? (
                <p style={{ margin: "8px 0 0", color: wmsColors.muted, fontSize: "13px" }}>최근 {RECENT_DAYS}일 안에 등록한 건이 보이지 않습니다. 등록 직후라면 위의 `상품등록상태 확인하기`에서 다시 전송해 주세요.</p>
              ) : (
                <>
                  <p style={{ margin: "8px 0 0", fontSize: "18px", fontWeight: 800, color: resultSummary.rejectedRecent > 0 ? "#c0392b" : wmsColors.greenDark }}>
                    {resultSummary.rejectedRecent > 0 ? `반려 ${resultSummary.rejectedRecent}건 확인 필요` : resultSummary.newResults.length > 0 ? `새 결과 ${resultSummary.newResults.length}건` : "반려 없음 · 모두 정상 진행 중"}
                  </p>
                  {resultSummary.newResults.length > 0 && (
                    <div style={{ marginTop: "10px", padding: "10px 12px", borderRadius: "8px", background: "#fff8e6", border: "1px solid #f0d58a" }}>
                      <strong style={{ fontSize: "13px" }}>새 결과 {resultSummary.newResults.length}건 <small style={{ fontWeight: 500, color: wmsColors.muted }}>({new Date(previous!.capturedAt).toLocaleString("ko-KR")} 전송 이후 바뀐 건)</small></strong>
                      <div style={{ display: "grid", gap: "4px", marginTop: "6px", fontSize: "13px" }}>
                        {resultSummary.newResults.slice(0, 20).map((row, index) => (
                          <div key={`new-${index}-${row.modelSku}`} style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
                            <span style={{ overflowWrap: "anywhere" }}>{row.modelSku || row.productName}</span>
                            <strong style={{ color: row.status === "rejected" ? "#c0392b" : wmsColors.greenDark, whiteSpace: "nowrap" }}>{row.status === "rejected" ? "✖ 반려" : "✔ 검수완료"}</strong>
                          </div>
                        ))}
                        {resultSummary.newResults.length > 20 && <span style={{ color: wmsColors.muted }}>외 {resultSummary.newResults.length - 20}건은 '자세히 보기'에서 확인</span>}
                      </div>
                    </div>
                  )}
                  <div style={{ display: "grid", gap: "6px", marginTop: "10px" }}>
                    {resultSummary.days.map(group => {
                      const bad = group.rejected + group.unknown > 0;
                      const parts = [group.reviewing > 0 && `검수중 ${group.reviewing}`, group.approved > 0 && `검수완료 ${group.approved}`, group.rejected > 0 && `반려 ${group.rejected}`, group.unknown > 0 && `확인필요 ${group.unknown}`].filter(Boolean).join(" · ");
                      const open = Boolean(openDays[group.sortKey]);
                      // 그날 반려 카드(등록불가·재등록시도 버튼 있음) + 나머지(검수중·검수완료 등)는 간단한 줄
                      const dayCards = recentRejectedRows.filter(row => {
                        const match = String(row.wims.registeredAt || "").trim().match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
                        return match && new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() === group.sortKey;
                      });
                      const cardKeys = new Set(dayCards.map(row => wimsRowKey(row.wims)));
                      const statusOrder = { rejected: 0, unknown: 1, reviewing: 2, approved: 3 } as const;
                      const otherRows = group.rows.filter(row => !cardKeys.has(wimsRowKey(row))).sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
                      return (
                        <div key={group.sortKey}>
                          <button type="button" aria-expanded={open} onClick={() => setOpenDays(current => ({ ...current, [group.sortKey]: !current[group.sortKey] }))}
                            style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: "10px", fontSize: "13px", padding: "7px 10px", borderRadius: "8px", border: 0, background: bad ? "#fdecea" : wmsColors.greenSoft, cursor: "pointer", textAlign: "left", font: "inherit" }}>
                            <span>{open ? "▼" : "▶"} {group.label} ({group.age === 0 ? "오늘" : `${group.age}일째`}) · {group.total}건</span>
                            <strong style={{ color: bad ? "#c0392b" : wmsColors.greenDark, textAlign: "right" }}>{bad ? "✖" : "✔"} {parts}</strong>
                          </button>
                          {open && (
                            <div style={{ display: "grid", gap: "7px", marginTop: "7px" }}>
                              {otherRows.map((row, index) => {
                                const color = row.status === "rejected" || row.status === "unknown" ? "#c0392b" : wmsColors.greenDark;
                                return (
                                  <div key={`${wimsRowKey(row)}-${index}`} style={{ border: `1px solid ${color}55`, borderLeft: `4px solid ${color}`, borderRadius: "9px", padding: "8px 12px", fontSize: "12px", background: "#fff" }}>
                                    <strong style={{ color }}>{row.modelSku || "모델SKU 확인 필요"} · {statusText[row.status]}</strong>
                                    <div style={{ marginTop: "2px" }}>{row.productName}</div>
                                  </div>
                                );
                              })}
                              {dayCards.length > 0 && <p style={{ margin: 0, color: wmsColors.muted, fontSize: "12px" }}>반려된 등록 건은 SKU·바코드를 제품DB에 자동 반영하지 않습니다.</p>}
                              {dayCards.map((row, index) => renderActionRow(row, index))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {resultSummary.slow > 0 && (
                    <p style={{ margin: "10px 0 0", padding: "8px 10px", borderRadius: "8px", background: "#fff3d6", color: "#a06118", fontSize: "13px", fontWeight: 700 }}>
                      검수중이 {RECENT_DAYS}일을 넘긴 건 {resultSummary.slow}건 (최대 {resultSummary.slowMax}일째) · 쿠팡에서 멈췄는지 확인하세요.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          <details style={{ marginTop: "4px" }}>
          <summary style={{ cursor: "pointer", color: wmsColors.muted, fontSize: "12px", fontWeight: 700 }}>자세히 보기 (전체 현황 · 조치할 상품 · 지난 항목)</summary>
          <div className="wms-supply-audit-grid wimsSummaryGrid" style={{ marginTop: "10px" }}>
            <Summary label="검수중" value={snapshot.reviewingCount} />
            <Summary label="검수완료" value={snapshot.approvedCount} good />
            <Summary label="반려" value={snapshot.rejectedCount} warning />
          </div>
          {auditing && <p style={{ fontSize: "11px", margin: "8px 0 0", color: wmsColors.muted }}>제품DB와 대조 중...</p>}
          {audit && (audit.approvedCandidateCount + audit.reviewingCandidateCount) > 0 && <button type="button" onClick={applyApprovedCandidates} disabled={applying} className="softBeigeButton" style={{ width: "100%", marginTop: "10px", fontSize: "15px" }}>{applying ? "백업 후 반영·검증 중..." : `검수상태 ${audit.approvedCandidateCount + audit.reviewingCandidateCount}건 반영`}</button>}
          <button type="button" onClick={regroupPendingModels} disabled={applying} className="softSageButton" style={{ width: "100%", marginTop: "10px", fontSize: "15px" }}>{applying ? "처리 중..." : "승인대기 옵션 모델별 정렬"}</button>
          {audit && (
            <div style={{ marginTop: "13px" }}>
              <strong style={{ display: "block", fontSize: "13px" }}>지금 조치할 상품</strong>
              {actionRows.length === 0 ? (
                <p style={{ margin: "7px 0 0", padding: "10px", borderRadius: "9px", background: wmsColors.greenSoft, color: wmsColors.greenDark, fontSize: "11px", fontWeight: 700 }}>현재 WIMS에서 조치할 상품이 없습니다.</p>
              ) : (
                <div className="wimsActionGrid">
                  {actionRows.map((row, index) => renderActionRow(row, index))}
                </div>
              )}
            </div>
          )}
          {audit && (pastRows.length > 0 || audit.pendingNotInWims.length > 0) && (
            <details style={{ marginTop: "10px" }}>
              <summary style={{ cursor: "pointer", color: wmsColors.muted, fontSize: "11px", fontWeight: 700 }}>지난 확인 필요 항목 {pastRows.length + audit.pendingNotInWims.length}건 보기 ({RECENT_DAYS}일 이전 등록 건 등)</summary>
              <div style={{ display: "grid", gap: "7px", marginTop: "8px", maxHeight: "320px", overflowY: "auto" }}>
                {pastRows.map((row, index) => renderActionRow(row, index))}
                {audit.pendingNotInWims.map(item => (
                  <div key={`pending-${item.sheetRowNumber}`} style={{ border: "1px solid #a0611855", borderLeft: "4px solid #a06118", borderRadius: "9px", padding: "9px 10px", fontSize: "11px" }}>
                    <strong style={{ color: "#a06118" }}>{item.modelSku || "모델SKU 확인 필요"} · WIMS 범위에서 미확인</strong>
                    <div style={{ marginTop: "2px" }}>{item.productName}</div>
                    <div style={{ color: wmsColors.muted }}>{capture ? "현재 검색 조건 밖에 있거나 아직 WIMS에 등록되지 않았는지 확인하세요." : "다른 등록일 또는 다음 WIMS 페이지에 있는지 확인하세요."} 제품DB {item.sheetRowNumber}행</div>
                  </div>
                ))}
              </div>
            </details>
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
          </details>
        </div>
      )}
    </section>
  );
}

function Summary({ label, value, good = false, warning = false }: { label: string; value: number; good?: boolean; warning?: boolean }) {
  const color = warning && value > 0 ? "#c0392b" : good ? wmsColors.greenDark : wmsColors.ink;
  return <div style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "10px 14px", background: "#fff" }}><span style={{ display: "block", color: wmsColors.muted, fontSize: "12px" }}>{label}</span><strong style={{ color, fontSize: "20px" }}>{value.toLocaleString()}건</strong></div>;
}
