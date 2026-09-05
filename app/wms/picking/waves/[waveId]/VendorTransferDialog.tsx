"use client";

import { useEffect, useRef, useState } from "react";
import { resolveLiveFields, type LiveCatalogLookup } from "@/lib/wms/picking-wave/live-catalog";
import { suggestVendorTransferQuantity, type VendorTransferSelection } from "@/lib/wms/picking-wave/vendor-transfer";
import type { PickingWaveItem } from "@/lib/wms/picking-wave/types";
import { toVendorOrderQuantity } from "@/lib/wms/vendor-order/aggregate";
import { wmsColors, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";

export default function VendorTransferDialog({ items, catalog, busy, error, onCancel, onConfirm }: {
  items: PickingWaveItem[];
  catalog: LiveCatalogLookup;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (selections: VendorTransferSelection[]) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(items.map(item => [item.productCode, String(suggestVendorTransferQuantity(item))])));
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const valid = items.every(item => /^\d+$/.test(quantities[item.productCode] || "") && Number(quantities[item.productCode]) <= item.totalQuantity);
  const selected = items.filter(item => Number(quantities[item.productCode]) > 0);
  const total = selected.reduce((sum, item) => sum + Number(quantities[item.productCode]), 0);
  return <dialog ref={dialogRef} aria-labelledby="vendor-transfer-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }} style={{ width: "min(560px, calc(100vw - 24px))", maxHeight: "calc(100dvh - 32px)", boxSizing: "border-box", padding: "16px", border: `1px solid ${wmsColors.border}`, borderRadius: "14px", color: wmsColors.ink, background: wmsColors.surfaceBeige }}>
    <h2 id="vendor-transfer-title" style={{ margin: "0 0 8px", fontSize: "18px" }}>부족수량 확인 · 거래처 발주</h2>
    <p style={{ margin: "0 0 12px", fontSize: "12px", lineHeight: 1.5 }}>확인한 부족수량만 피킹에 저장하고 거래처별 초안에 연결합니다. 0개는 제외하며 다른 SKU와 발주확정·Shipment는 바뀌지 않습니다.</p>
    <div style={{ display: "grid", gap: "8px" }}>
      {items.map(item => {
        const live = resolveLiveFields(item, catalog);
        return <label key={item.productCode} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 76px", gap: "8px", alignItems: "center", padding: "10px", background: "#fff", border: `1px solid ${wmsColors.border}`, borderRadius: "10px" }}>
          <span style={{ minWidth: 0, fontSize: "12px", overflowWrap: "anywhere" }}><strong>{live.name}</strong><span style={{ display: "block", marginTop: "4px" }}>옵션 · {live.optionLabel || "옵션 없음"}</span><span style={{ display: "block", marginTop: "4px", fontSize: "11px", color: wmsColors.muted }}>SKU {item.productCode} · {live.vendorName || "거래처 미등록"}<br />요청 {item.totalQuantity}개 · 현재 찾음 {item.pickedQuantity}개</span></span>
          <span style={{ fontSize: "11px", textAlign: "center" }}>부족수량<input aria-label={`SKU ${item.productCode} 부족수량`} type="number" inputMode="numeric" min={0} max={item.totalQuantity} step={1} disabled={busy} value={quantities[item.productCode]} onChange={event => setQuantities(previous => ({ ...previous, [item.productCode]: event.target.value }))} style={{ boxSizing: "border-box", width: "100%", minHeight: "42px", marginTop: "4px", padding: "6px", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "8px", fontSize: "16px" }} /></span>
        </label>;
      })}
    </div>
    <p style={{ fontSize: "12px", fontWeight: 700 }}>{valid ? `부족 ${selected.length}종 · ${total}개 / 초안 기본 발주 ${selected.reduce((sum, item) => sum + toVendorOrderQuantity(Number(quantities[item.productCode])), 0)}개` : "부족수량을 요청수량 이하의 정수로 확인해 주세요."}</p>
    <p style={{ fontSize: "11px", color: wmsColors.muted }}>새 초안은 기존 12개 주문단위로 제안합니다. 이미 수정한 초안의 수량과 메모는 보존하며, 실제 전송은 하지 않습니다.</p>
    {error && <p role="alert" style={{ fontSize: "12px", color: "#b42318" }}>{error}</p>}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "8px", position: "sticky", bottom: "-16px", padding: "10px 0", background: wmsColors.surfaceBeige }}>
      <button type="button" disabled={busy} onClick={onCancel} style={{ ...wmsSecondaryButton, minHeight: "46px" }}>취소</button>
      <button type="button" disabled={busy || !valid || total === 0} onClick={() => void onConfirm(items.map(item => ({ productCode: item.productCode, shortageQuantity: quantities[item.productCode] })))} style={{ ...wmsPrimaryButton, minHeight: "46px", opacity: busy || !valid || total === 0 ? .5 : 1 }}>{busy ? "저장 중..." : "부족수량 저장 · 초안 연결"}</button>
    </div>
  </dialog>;
}
