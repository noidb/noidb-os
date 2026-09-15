"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ActualInboundShortageLine } from "@/lib/wms/vendor-order/actual-inbound-shortage";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";


type ShortageLine = ActualInboundShortageLine & { needsConfirmation: boolean };
type Classification = "vendor" | "discontinue" | "reorder" | "delay";
type SnapshotConflict = { purchaseOrderNumber: string; snapshotTime: string; sourceFileNames: string[] };


function keyOf(purchaseOrderNumber: string, productCode: string): string {
  return `${purchaseOrderNumber}::${productCode}`;
}

function expectedDateValue(value: string | undefined): string {
  const text = value?.trim() || "";
  return text || "미확인";
}

export default function ActualInboundShortage({ pendingOnly = false }: { pendingOnly?: boolean }) {

  const [lines, setLines] = useState<ShortageLine[]>([]);
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [classifications, setClassifications] = useState<Record<string, Classification>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [snapshotConflicts, setSnapshotConflicts] = useState<SnapshotConflict[]>([]);
  
  const [justCreated, setJustCreated] = useState(false);
  
  const [discontinuing, setDiscontinuing] = useState<Set<string>>(new Set());
  

  const [delayMemo, setDelayMemo] = useState("");
  const [needsEvidence, setNeedsEvidence] = useState<ShortageLine[]>([]);
  const [delayed, setDelayed] = useState<Array<ShortageLine & { runId: string; releaseAvailable?: boolean; route: { decision: Classification; completed: boolean; memo?: string; at: string } }>>([]);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/wms/vendor-orders/actual-inbound-shortage?pending=1", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "실제 미납 목록을 불러오지 못했습니다.");
      setLines(data.lines || []);
      setSourceFile(data.inboundHistorySourceFile || null);
      setSnapshotConflicts(data.snapshotConflicts || []);
      setExistingKeys(new Set());
      setDelayed(data.delayedLines || []);
      setNeedsEvidence(data.needsEvidenceLines || []);
      setSelected(new Set());
      setClassifications({});
      setFailures({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "실제 미납 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  
  const rows = useMemo(
    () => lines.filter(row => !existingKeys.has(keyOf(row.purchaseOrderNumber, row.productCode))).sort((a, b) => {
      const dateA = a.expectedDate?.trim() || "9999-99-99";
      const dateB = b.expectedDate?.trim() || "9999-99-99";
      return dateA.localeCompare(dateB) || a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber) || a.productCode.localeCompare(b.productCode);
    }),
    [lines, existingKeys]
  );

  const counts = useMemo(() => rows.reduce((result, row) => {
    const classification = classifications[keyOf(row.purchaseOrderNumber, row.productCode)];
    if (classification) result[classification]++;
    else if (!row.needsConfirmation) result.unclassified++;
    return result;
  }, { vendor: 0, discontinue: 0, reorder: 0, delay: 0, unclassified: 0 }), [rows, classifications]);

  function toggle(key: string, alreadyAdded: boolean, needsConfirmation: boolean) {
    if (alreadyAdded || needsConfirmation) return;
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function classify(keys: Iterable<string>, classification: Classification) {
    setClassifications(previous => {
      const next = { ...previous };
      for (const key of keys) next[key] = classification;
      return next;
    });
  }

  async function routeRow(row: ShortageLine, action: Classification | "receive-delay") {
    const response = await fetch("/api/wms/vendor-orders/actual-inbound-shortage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, purchaseOrderNumber: row.purchaseOrderNumber, skuId: row.productCode, ...(action === "delay" ? { memo: delayMemo } : {}) }) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "분류 저장에 실패했습니다.");
    if (action === "vendor") setJustCreated(true);
    window.dispatchEvent(new Event("noidb-inbound-updated"));
  }
  async function reroute(row: ShortageLine, action: Classification | "receive-delay") {
    setCreating(true); setError(null);
    try { await routeRow(row, action); await reload(); }
    catch (error) { setError(error instanceof Error ? error.message : "이동 실패"); }
    finally { setCreating(false); }
  }

  async function executeClassifications() {
    const targets = rows.filter(row => classifications[keyOf(row.purchaseOrderNumber, row.productCode)] && !row.needsConfirmation);
    if (!targets.length) return;
    setCreating(true); setMessage(null); setFailures({}); setJustCreated(false);
    const failed: Record<string, string> = {};
    let completed = 0;
    try {
      for (const row of targets) {
        const key = keyOf(row.purchaseOrderNumber, row.productCode);
        try { await routeRow(row, classifications[key]); completed++; }
        catch (error) { failed[key] = error instanceof Error ? error.message : "분류 실패"; }
      }
      setFailures(failed);
      setMessage(Object.keys(failed).length ? `${completed}건 처리, ${Object.keys(failed).length}건 실패했습니다. 실패 사유를 확인해 주세요.` : `${completed}건을 분류대로 처리했습니다.`);
      await reload();
      if (Object.keys(failed).length) {
        setFailures(failed);
        setClassifications(Object.fromEntries(Object.keys(failed).map(key => [key, classifications[key]])) as Record<string, Classification>);
      }
    } finally { setCreating(false); }
  }

  return (
    <main style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: "12px 12px calc(12px + env(safe-area-inset-bottom))", fontFamily: "sans-serif", background: wmsColors.background, color: wmsColors.ink, minHeight: "100vh" }}>
      <Link href="/wms/vendor-orders" style={{ color: wmsColors.slateDark, fontSize: "13px" }}>← 거래처 발주관리</Link>
      <h1 style={{ fontSize: "20px", margin: "10px 0 4px" }}>{pendingOnly ? "과거청산 · 미처리 미납 SKU 분류" : "실제 미납 처리"}</h1>
      <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 14px" }}>
        Supplier Hub 발주서리스트의 확정수량-실제입고수량 기준 실제 미납 SKU입니다. 피킹 부족분과는
        별개입니다. 각 SKU를 거래처발주·단종·쿠팡 미납 재발주·입고지연 중 하나로 먼저 분류하며, 미분류 SKU는 처리하지 않습니다.
        {sourceFile && <><br />입고상세내역 반영 파일: {sourceFile}</>}
      </p>
      <label>입고지연 확인 근거 <input aria-label="입고지연 기간과 확인 근거" value={delayMemo} onChange={e => setDelayMemo(e.target.value)} placeholder="예: 거래처 확인, 3주 후 입고" /></label>
      {snapshotConflicts.map(conflict => <p key={conflict.purchaseOrderNumber} style={{ padding: "9px", borderRadius: "8px", background: "#fff2dc", color: "#8a6100", fontSize: "11px", lineHeight: 1.6 }}>
        확인필요 · 발주 {conflict.purchaseOrderNumber}의 동일 시각 원본 내용이 다릅니다: {conflict.sourceFileNames.join(" / ")}
      </p>)}

      {loading ? (
        <p style={{ color: wmsColors.muted, fontSize: "13px" }}>불러오는 중...</p>
      ) : error ? (
        <p style={{ color: "#c0392b", fontSize: "13px" }}>{error}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: wmsColors.muted, fontSize: "13px" }}>현재 실제 미납으로 확인된 SKU가 없습니다.</p>
      ) : (
        <>
          {message && <p style={{ fontSize: "12px", color: wmsColors.greenDark, marginBottom: "8px" }}>{message}</p>}
          {justCreated && (
            <Link href="/wms/vendor-orders/manage" style={{ display: "block", textDecoration: "none", marginBottom: "14px" }}>
              <button type="button" style={{ ...wmsPrimaryButton, width: "100%" }}>거래처 발주서 확인하러 가기 →</button>
            </Link>
          )}
          <div style={{ padding: "10px", border: `1px solid ${wmsColors.border}`, borderRadius: "10px", background: "#fff", marginBottom: "10px", fontSize: "12px", lineHeight: 1.7 }}>
            <strong>실행 전 분류 확인</strong><br />
            거래처발주 {counts.vendor}건 · 단종 {counts.discontinue}건 · 미납분 재발주 {counts.reorder}건 · 입고지연 {counts.delay}건 · 미분류 {counts.unclassified}건
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", marginTop: "8px" }}>
              <button type="button" disabled={!selected.size || creating} onClick={() => classify(selected, "vendor")} style={{ ...wmsGhostButton, padding: "8px 3px", fontSize: "11px" }}>선택 → 거래처발주</button>
              <button type="button" disabled={!selected.size || creating} onClick={() => classify(selected, "discontinue")} style={{ ...wmsGhostButton, padding: "8px 3px", fontSize: "11px" }}>선택 → 단종</button>
              <button type="button" disabled={!selected.size || creating} onClick={() => classify(selected, "reorder")} style={{ ...wmsGhostButton, padding: "8px 3px", fontSize: "11px" }}>선택 → 미납분 재발주</button>
              <button type="button" disabled={!selected.size || creating} onClick={() => classify(selected, "delay")} style={wmsGhostButton}>선택 → 입고지연</button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
            {rows.map(row => {
              const key = keyOf(row.purchaseOrderNumber, row.productCode);
              const alreadyAdded = existingKeys.has(key);
              const needsConfirmation = row.needsConfirmation;
              return (
                <label
                  key={key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "24px 1fr",
                    gap: "10px",
                    alignItems: "flex-start",
                    padding: "10px",
                    border: needsConfirmation ? `1px solid #d8b26a` : `1px solid ${wmsColors.border}`,
                    borderRadius: "12px",
                    background: needsConfirmation ? "#fff8ea" : alreadyAdded ? wmsColors.surfaceBeige : "#fff",
                    opacity: alreadyAdded ? 0.6 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    disabled={alreadyAdded || needsConfirmation}
                    onChange={() => toggle(key, alreadyAdded, needsConfirmation)}
                    style={{ width: "20px", height: "20px", marginTop: "2px" }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "12px", color: wmsColors.slateDark, fontWeight: 700 }}>입고예정일 {expectedDateValue(row.expectedDate)}</div>
                    <div style={{ fontSize: "11px", color: wmsColors.muted }}>원발주번호 {row.purchaseOrderNumber} · SKU {row.productCode}</div>
                    <div style={{ fontSize: "13px", fontWeight: 700, marginTop: "2px" }}>{row.productName}{row.optionLabel ? ` · ${row.optionLabel}` : ""}</div>
                    <div style={{ fontSize: "12px", marginTop: "4px" }}>
                      확정 <strong>{row.confirmedQuantity}</strong> · 실제입고 <strong>{row.receivedQuantity}</strong> · 미납 <strong style={{ color: wmsColors.warn }}>{row.shortageQuantity}</strong>
                    </div>
                    <div style={{ fontSize: "11px", color: wmsColors.slateDark, marginTop: "2px" }}>
                      거래처 {row.vendorName}{alreadyAdded ? " · 이미 발주서에 추가됨" : ""}
                    </div>
                    {needsConfirmation && (
                      <div style={{ fontSize: "11px", color: "#8a6100", fontWeight: 700, marginTop: "4px" }}>
                        ⚠ 확인필요 — 입고예정일 이후 재확인된 최신 발주서 스냅샷이 없어 자동 처리 대상에서 제외됨
                      </div>
                    )}
                    {!needsConfirmation && <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "5px", marginTop: "8px" }}>
                      {([['vendor','거래처발주'],['discontinue','단종'],['reorder','미납분 재발주'],['delay','입고지연']] as Array<[Classification,string]>).map(([value, label]) => <button
                        key={value} type="button" disabled={creating || discontinuing.has(key)}
                        onClick={event => { event.preventDefault(); event.stopPropagation(); classify([key], value); }}
                        style={{ minHeight: "36px", padding: "4px", border: classifications[key] === value ? `2px solid ${wmsColors.greenDark}` : `1px solid ${wmsColors.border}`, borderRadius: "8px", background: classifications[key] === value ? wmsColors.surfaceBeige : "#fff", color: wmsColors.ink, fontSize: "10px", fontWeight: 800 }}
                      >{label}</button>)}
                    </div>}
                    {failures[key] && <div style={{ marginTop: "6px", color: "#c0392b", fontSize: "11px", fontWeight: 700 }}>실패: {failures[key]}</div>}
                  </div>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            disabled={creating || counts.vendor + counts.discontinue + counts.reorder + counts.delay === 0}
            onClick={() => void executeClassifications()}
            style={{ ...wmsPrimaryButton, width: "100%", opacity: creating || counts.vendor + counts.discontinue + counts.reorder + counts.delay === 0 ? 0.5 : 1 }}
          >
            {creating ? "처리 중..." : `분류대로 실행 (${counts.vendor + counts.discontinue + counts.reorder + counts.delay})`}
          </button>
          <button type="button" onClick={() => void reload()} disabled={loading} style={{ ...wmsGhostButton, width: "100%", marginTop: "8px" }}>
            새로고침
          </button>
        </>
      )}
      <section aria-label="단종 완료근거 확인" style={{ marginTop: 24 }}><h2>단종 완료근거 확인 {needsEvidence.length}건</h2><p>제품DB에는 단종으로 표시되지만 이 원발주에 연결된 업로드 완료근거가 없습니다. 확인 후 단종 목록에 연결하고 기존 파일·업로드 완료 절차를 진행하세요.</p>
        {needsEvidence.map(row => <p key={keyOf(row.purchaseOrderNumber,row.productCode)}>{row.purchaseOrderNumber} · SKU {row.productCode} · {row.productName} <button disabled={creating} onClick={() => void reroute(row,"discontinue")}>단종 대기에 연결</button></p>)}
      </section>
      <section aria-label="입고지연 및 이동 재시도" style={{ marginTop: 24 }}><h2>입고지연 / 이동 재시도 {delayed.length}건</h2>
        {delayed.map(row => <article key={row.runId} style={{ background: "white", padding: 12, marginBottom: 8 }}>
          <strong>{row.productName} · SKU {row.productCode}</strong><p>원발주 {row.purchaseOrderNumber} · {row.vendorName} · {row.shortageQuantity}개</p><p>{row.route.memo} · {row.route.at}</p>
          {row.releaseAvailable && <button disabled={creating} onClick={() => void reroute(row, "receive-delay")}>실제입고 완료 확인</button>}
          {row.route.completed ? (row.releaseAvailable ? null : ([ ["vendor", "거래처발주"], ["discontinue", "단종"], ["reorder", "쿠팡 재발주"] ] as const).map(([action,label]) => <button key={action} disabled={creating} onClick={() => void reroute(row, action)} style={wmsGhostButton}>{label}로 이동</button>)) : <button disabled={creating} onClick={() => void reroute(row, row.route.decision)}>선택한 목적지로 다시 연결</button>}
        </article>)}
      </section>
    </main>
  );
}
