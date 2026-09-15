"use client";

import { useEffect, useRef, useState } from "react";
import type { VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import { receivingDelayDate, type ReceivingDelaySummary } from "@/lib/wms/vendor-order/receiving-delay";
import { wmsColors, wmsGhostButton, wmsPrimaryButton } from "@/lib/wms/ui-tokens";

export default function ReceivingDelayDialog({ line, previous, busy, error, onClose, onSave, sentOrder = false }: {
  line: VendorOrderDraftLine;
  previous?: ReceivingDelaySummary;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (memo: string) => void;
  sentOrder?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [memo, setMemo] = useState(previous?.memo || line.memo || "");
  const delayed = !previous?.active;
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-labelledby="receiving-delay-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} style={{ width: "min(430px, calc(100vw - 24px))", boxSizing: "border-box", maxHeight: "85dvh", overflowY: "auto", border: `1px solid ${wmsColors.border}`, borderRadius: "14px", padding: "18px", color: wmsColors.ink }}>
    <h2 id="receiving-delay-title" style={{ fontSize: "18px", margin: "0 0 12px" }}>{delayed ? "입고지연 등록" : "입고지연 해제"}</h2>
    <p style={{ fontSize: "13px", lineHeight: 1.5 }}>{line.productName}<br />SKU {line.skuId} · {line.vendorName}</p>
    <p style={{ fontSize: "12px" }}>처리일 {receivingDelayDate(new Date().toISOString())} · {delayed ? "정상 → 입고지연" : "입고지연 → 해제"}</p>
    <label style={{ display: "block", fontSize: "13px" }}>입고지연 메모
      <textarea aria-label="입고지연 메모" value={memo} onChange={event => setMemo(event.target.value)} maxLength={500} rows={3} disabled={busy} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: "6px", padding: "9px", borderRadius: "8px", border: `1px solid ${wmsColors.border}`, fontSize: "16px", resize: "vertical" }} />
    </label>
    <p style={{ fontSize: "11px", lineHeight: 1.6, color: wmsColors.muted }}>{sentOrder ? "이 상품은 이 발주서에 계속 남습니다. 몇 주 후 입고되어도 사진과 상품명을 보고 재발주요청·보충분 입고완료·단종 중 선택해 마무리할 수 있습니다." : "다른 PC·모바일과 다음 출고작업에도 반영됩니다. 제품DB·발주수량·전송완료 상태는 바뀌지 않습니다."}</p>
    {error && <p role="alert" style={{ fontSize: "12px", color: "#b42318" }}>{error}</p>}
    <div style={{ display: "flex", gap: "8px" }}><button type="button" disabled={busy} onClick={onClose} style={{ ...wmsGhostButton, flex: 1, minHeight: "46px" }}>취소</button><button type="button" disabled={busy} onClick={() => onSave(memo)} style={{ ...wmsPrimaryButton, flex: 2, minHeight: "46px" }}>{busy ? "저장 중..." : delayed ? "입고지연 저장" : "지연 해제 저장"}</button></div>
  </dialog>;
}
