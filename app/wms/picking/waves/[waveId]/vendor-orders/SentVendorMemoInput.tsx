"use client";

import { useEffect, useRef, useState } from "react";
import type { VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import { wmsColors, wmsSageButton } from "@/lib/wms/ui-tokens";

/** 전송 완료 발주 SKU의 결과 참고 메모. 입고/분류 상태는 바꾸지 않는다. */
export default function SentVendorMemoInput({ line, disabled = false, onSaved }: { line: VendorOrderDraftLine; disabled?: boolean; onSaved: (line: VendorOrderDraftLine) => void }) {
  const [memo, setMemo] = useState(line.resultMemo || "");
  const [baseMemo, setBaseMemo] = useState(line.resultMemo || "");
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(line.updatedAt);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const memoRef = useRef(memo);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const awaitingSavedVersion = useRef<string | null>(null);
  const lineIdRef = useRef(line.id);
  memoRef.current = memo;

  useEffect(() => {
    const remoteMemo = line.resultMemo || "";
    if (line.id !== lineIdRef.current) {
      lineIdRef.current = line.id;
      dirtyRef.current = false;
      awaitingSavedVersion.current = null;
      setMemo(remoteMemo);
      setBaseMemo(remoteMemo);
      setBaseUpdatedAt(line.updatedAt);
      setNotice(null);
      return;
    }
    const awaitedVersion = awaitingSavedVersion.current;
    if (awaitedVersion) {
      if (line.updatedAt === awaitedVersion) awaitingSavedVersion.current = null;
      else if (line.updatedAt < awaitedVersion) return;
      else awaitingSavedVersion.current = null;
    }
    if (line.updatedAt === baseUpdatedAt) return;
    if (dirtyRef.current) {
      setNotice({ text: "다른 변경이 있어 현재 입력을 유지했습니다. 저장하면 다시 확인합니다.", error: true });
      return;
    }
    setMemo(remoteMemo);
    setBaseMemo(remoteMemo);
    setBaseUpdatedAt(line.updatedAt);
  }, [line.id, line.resultMemo, line.updatedAt, baseUpdatedAt]);

  async function save() {
    if (savingRef.current || disabled || memoRef.current === baseMemo) return;
    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/wms/vendor-orders/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId: line.id, expectedUpdatedAt: baseUpdatedAt, memo: memoRef.current }),
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.line) throw new Error(data.error || "결과 메모를 저장하지 못했습니다.");
      const savedMemo = data.line.resultMemo || "";
      dirtyRef.current = false;
      awaitingSavedVersion.current = data.line.updatedAt;
      setMemo(savedMemo);
      setBaseMemo(savedMemo);
      setBaseUpdatedAt(data.line.updatedAt);
      setNotice({ text: savedMemo ? "메모 저장됨" : "메모를 지웠습니다.", error: false });
      onSaved(data.line);
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "결과 메모를 저장하지 못했습니다.", error: true });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <div style={{ minWidth: 0, marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${wmsColors.border}` }}>
    <label htmlFor={`sent-result-memo-${line.id}`} style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 800, color: wmsColors.slate }}>결과 메모</label>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "end" }}>
      <textarea id={`sent-result-memo-${line.id}`} aria-label="결과 메모" value={memo} maxLength={500} rows={2} disabled={disabled || saving} placeholder="선택 입력" onChange={event => { const next = event.target.value; setMemo(next); dirtyRef.current = next !== baseMemo; setNotice(null); }} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", resize: "vertical", fontSize: 13 }} />
      <button type="button" aria-label="메모 저장" disabled={disabled || saving || memo === baseMemo} onClick={() => void save()} style={{ ...wmsSageButton, minHeight: 44, whiteSpace: "nowrap", opacity: disabled || memo === baseMemo ? .55 : 1 }}>{saving ? "저장 중…" : "저장"}</button>
    </div>
    {notice && <p role={notice.error ? "alert" : "status"} style={{ margin: "6px 0 0", fontSize: 12, color: notice.error ? "#b42318" : wmsColors.greenDark, overflowWrap: "anywhere" }}>{notice.text}</p>}
  </div>;
}
