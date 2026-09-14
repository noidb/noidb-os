"use client";
import { STATUS_MANAGEMENT_PATH } from "@/lib/wms/status-management-path";
import { useEffect, useState } from "react";
import styles from "../weekly-work.module.css";
import layout from "./reorder-queue.module.css";
type Row = { purchaseOrderNumber: string; skuId: string; productName: string; shortageQuantity: number };
type Issue = { skuId: string; productName: string; purchaseOrderNumbers: string[]; message: string };
export default function ReorderQueue() {
  const [rows, setRows] = useState<Row[]>([]), [token, setToken] = useState("");
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [outputKey, setOutputKey] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]), [loaded, setLoaded] = useState(false), [loadFailed, setLoadFailed] = useState(false);
  async function load() {
    setBusy(true); setError(""); setOutputKey("");
    try { const response = await fetch("/api/wms/weekly-work/reorder-queue", { cache: "no-store" }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error); setRows(data.rows); setIssues(data.issues || []); setToken(data.token); setLoaded(true); setLoadFailed(false); }
    catch (error) { setLoadFailed(true); setError(error instanceof Error ? error.message : "목록을 불러오지 못했습니다."); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  async function act(action: "generate" | "complete" | "discardIssue", issue?: Issue) {
    if (busy || action === "complete" && !window.confirm("쿠팡에서 이 목록 전체의 재발주 요청을 완료했나요?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/wms/weekly-work/reorder-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, token, outputKey, skuId: issue?.skuId, purchaseOrderNumbers: issue?.purchaseOrderNumbers }) });
      const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error);
      if (action === "complete") { setMessage("재발주 요청 완료를 기록했습니다."); await load(); return; }
      if (action === "discardIssue") { setMessage("수량 확인 불가 항목을 삭제했습니다."); await load(); return; }
      setRows(data.rows); setOutputKey(data.outputKey);
      const bytes = Uint8Array.from(atob(data.base64), character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a"); link.href = url; link.download = data.fileName; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage("저장된 미납수량으로 전체 재발주 파일을 생성했습니다.");
    } catch (error) { setError(error instanceof Error ? error.message : "처리하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <main className={styles.page}>
    <div className={styles.topLinks}><a href="/wms/inbound">← 새 미입고 검토</a><a href="/wms/vendor-orders/manage">거래처 발주관리</a><a href={STATUS_MANAGEMENT_PATH}>단종관리</a></div>
    <h1>재발주요청 대기</h1><p>대기 중인 상품을 한 번에 받아 쿠팡에 요청한 뒤 완료를 기록해 주세요.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status">{message}</p>}
    <div className={layout.heading}><h2>{loadFailed ? "재발주요청 목록 확인 실패" : !loaded ? "저장 목록 확인 중…" : `재발주요청 ${new Set(rows.map(row => row.skuId)).size}개 SKU · ${rows.length}건`}</h2><button className={styles.secondary} disabled={busy} onClick={() => void load()}>저장 목록 다시 보기</button></div>
    <p>조회 버튼으로 저장한 발주번호별 미납수량을 사용합니다. 요청입고예정일은 생성일 다음 첫 금요일입니다.</p>
    <div className={styles.couponTable}><table><thead><tr><th>SKU</th><th>상품명</th><th>발주번호</th><th>미납수량</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.purchaseOrderNumber}:${row.skuId}`}><td>{row.skuId}</td><td>{row.productName}</td><td>{row.purchaseOrderNumber}</td><td>{row.shortageQuantity}개</td></tr>)}</tbody></table></div>
    {!!issues.length && <section aria-label="수량 확인이 필요한 상품"><h3>수량 확인 필요 · {issues.length}개 상품</h3><p>아래 상품은 파일에 포함되지 않으며, 정상 상품의 요청을 완료해도 대기 상태로 남습니다.</p>{issues.map(issue=><p key={`${issue.skuId}:${issue.purchaseOrderNumbers.join(",")}`}><strong>{issue.productName}</strong><br/>SKU {issue.skuId} · 발주 {issue.purchaseOrderNumbers.join(", ") || "확인 필요"}<br/>{issue.message} <button type="button" disabled={busy} onClick={() => { if (window.confirm("이 수량 확인 불가 항목을 대기 목록에서 삭제할까요?")) void act("discardIssue", issue); }}>삭제</button></p>)}</section>}
    {!rows.length && !issues.length && loaded && !busy && !error && <p>재발주 요청 대기 항목이 없습니다.</p>}
    <div className={layout.actions}><button className={styles.primary} disabled={busy || loadFailed || !rows.length} onClick={() => void act("generate")}>{busy ? "확인 중…" : issues.length ? `수량 확인된 ${rows.length}건 파일 받기` : "전체 재발주요청 파일 받기"}</button><a href="https://supplier.coupang.com/plan/ticket/reportIssue/Reorder" target="_blank" rel="noreferrer">쿠팡 재발주요청 화면 ↗</a><button className={styles.secondary} disabled={busy || loadFailed || !outputKey} onClick={() => void act("complete")}>쿠팡 재발주 요청 완료</button></div>
  </main>;
}
