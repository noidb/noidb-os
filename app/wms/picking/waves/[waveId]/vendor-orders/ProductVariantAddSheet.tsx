"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import { getVendorVariantOptions } from "@/lib/wms/vendor-order/variant-options";
import { wmsColors } from "@/lib/wms/ui-tokens";

interface Props {
  anchorSkuId: string;
  catalogItems: Iterable<ProductCatalogItem>;
  existingSkuIds: string[];
  onClose: () => void;
  onSelect: (products: ProductCatalogItem[]) => void;
}
const button: CSSProperties = { minHeight: "44px", padding: "9px 13px", borderRadius: "9px", border: `1px solid ${wmsColors.borderStrong}`, background: "#fff", color: wmsColors.ink, fontSize: "14px", cursor: "pointer", whiteSpace: "normal", overflowWrap: "anywhere" };

export default function ProductVariantAddSheet({ anchorSkuId, catalogItems, existingSkuIds, onClose, onSelect }: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const variants = useMemo(() => getVendorVariantOptions({ anchorSkuId, catalogItems, existingSkuIds }), [anchorSkuId, catalogItems, existingSkuIds]);
  const filtered = useMemo(() => {
    const key = query.trim().toLocaleLowerCase("ko");
    return variants.options.filter(option => !key || [option.skuId, option.optionLabel, option.product.productName, option.product.modelSku].some(value => value.toLocaleLowerCase("ko").includes(key)));
  }, [query, variants.options]);
  const chosen = variants.options.filter(option => option.selectable && selected.has(option.skuId));
  const selectable = filtered.filter(option => option.selectable);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    search.current?.focus();
    return () => { element?.close(); };
  }, []);
  useEffect(() => { setSelected(new Set()); setQuery(""); }, [anchorSkuId]);

  return <dialog ref={dialog} aria-labelledby={id + "-title"} onCancel={event => { event.preventDefault(); onClose(); }} style={{ width: "min(660px, calc(100vw - 24px))", maxWidth: "100%", maxHeight: "calc(100dvh - 24px)", boxSizing: "border-box", margin: "auto", padding: 0, border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "16px", color: wmsColors.ink, background: "#fff", overflow: "hidden" }}>
    <div style={{ display: "flex", flexDirection: "column", maxHeight: "calc(100dvh - 28px)", minWidth: 0 }}>
      <header style={{ padding: "16px", borderBottom: `1px solid ${wmsColors.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
          <h2 id={id + "-title"} style={{ fontSize: "19px", margin: 0 }}>같은 모델 옵션 추가</h2>
          <button type="button" onClick={onClose} style={button}>닫기</button>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: 1.6, overflowWrap: "anywhere" }}>{variants.modelName ? `모델 ${variants.modelName} · 제품DB 옵션 ${variants.options.length}개` : `SKU ${anchorSkuId}`}</p>
      </header>
      <div style={{ minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "16px" }}>
        {variants.reason ? <p role="status" style={{ margin: 0, lineHeight: 1.7 }}>{variants.reason}</p> : <>
          <label htmlFor={id + "-search"} style={{ display: "block", fontSize: "13px", fontWeight: 700, marginBottom: "6px" }}>색상·호수·SKU 검색</label>
          <input ref={search} id={id + "-search"} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="예: 로즈골드, 14호" style={{ width: "100%", minWidth: 0, minHeight: "44px", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "9px", padding: "10px", color: wmsColors.ink, fontSize: "16px" }} />
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", margin: "10px 0" }}>
            <button type="button" disabled={!selectable.length} onClick={() => setSelected(current => new Set([...current, ...selectable.map(option => option.skuId)]))} style={{ ...button, opacity: selectable.length ? 1 : 0.5 }}>검색된 추가 가능 옵션 선택</button>
            <button type="button" disabled={!chosen.length} onClick={() => setSelected(new Set())} style={{ ...button, opacity: chosen.length ? 1 : 0.5 }}>선택 해제</button>
          </div>
          <p role="status" style={{ fontSize: "12px", color: wmsColors.muted, margin: "8px 0" }}>검색 결과 {filtered.length}개 · 추가 가능 {selectable.length}개</p>
          <ul aria-label="같은 모델 옵션 목록" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "8px" }}>
            {filtered.map(option => <li key={option.skuId}>
              <label style={{ display: "flex", gap: "10px", alignItems: "flex-start", minWidth: 0, padding: "12px", border: `1px solid ${selected.has(option.skuId) && option.selectable ? wmsColors.green : wmsColors.border}`, borderRadius: "10px", background: option.selectable ? selected.has(option.skuId) ? wmsColors.greenSoft : "#fff" : wmsColors.surfaceBeige, cursor: option.selectable ? "pointer" : "default" }}>
                <input type="checkbox" checked={option.selectable && selected.has(option.skuId)} disabled={!option.selectable} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(option.skuId); else next.delete(option.skuId); return next; })} style={{ flexShrink: 0, width: "20px", height: "20px", margin: "1px 0 0", accentColor: wmsColors.green }} />
                <span style={{ minWidth: 0, display: "grid", gap: "4px", overflowWrap: "anywhere", lineHeight: 1.5 }}>
                  <strong style={{ fontSize: "15px" }}>{option.optionLabel || "옵션명 미등록"}</strong>
                  <span style={{ fontSize: "12px", color: wmsColors.muted }}>{option.name}</span>
                  <span style={{ fontSize: "12px" }}>SKU {option.skuId}{option.product.modelSku ? ` · ${option.product.modelSku}` : ""}</span>
                  {(option.alreadyAdded || option.discontinued) && <strong style={{ fontSize: "12px" }}>{[option.alreadyAdded ? "이미 추가됨" : "", option.discontinued ? "단종" : ""].filter(Boolean).join(" · ")}</strong>}
                </span>
              </label>
            </li>)}
          </ul>
          {!filtered.length && <p style={{ lineHeight: 1.6 }}>검색 결과가 없습니다. 색상, 호수 또는 SKU를 다시 확인해 주세요.</p>}
          {chosen.length > 0 && <section aria-label="선택한 옵션" style={{ marginTop: "14px", borderRadius: "10px", background: wmsColors.greenSoft, padding: "12px", fontSize: "13px", lineHeight: 1.6 }}>
            <strong>선택한 옵션 {chosen.length}개</strong>
            <ul style={{ paddingLeft: "20px", margin: "6px 0 0", overflowWrap: "anywhere" }}>{chosen.map(option => <li key={option.skuId}>{option.optionLabel || "옵션명 미등록"} · SKU {option.skuId}</li>)}</ul>
          </section>}
        </>}
      </div>
      <footer style={{ padding: "12px 16px", borderTop: `1px solid ${wmsColors.border}`, background: "#fff", flexShrink: 0 }}>
        <button type="button" disabled={!chosen.length} onClick={() => { if (chosen.length) onSelect(chosen.map(option => option.product)); }} style={{ ...button, width: "100%", background: wmsColors.green, color: "#fff", border: 0, fontWeight: 800, opacity: chosen.length ? 1 : 0.5 }}>선택한 {chosen.length}개 옵션 추가</button>
      </footer>
    </div>
  </dialog>;
}
