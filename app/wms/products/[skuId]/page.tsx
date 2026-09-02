"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import { wmsColors, wmsGhostButton, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";
import ImageEditSheet from "../../picking/waves/[waveId]/ImageEditSheet";

const EDIT_FIELDS = [
  ["modelSku", "모델SKU"], ["productName", "상품명"], ["optionLabel", "옵션명"], ["modelName", "모델명/품번"],
  ["category", "카테고리"], ["warehouseNumber", "창고번호"], ["vendorName", "거래처"],
  ["countryOfOrigin", "제조국명"], ["currentStatus", "현재상태"], ["barcode", "바코드"],
  ["costVatIncluded", "원가(부가세포함)"], ["productLink", "제품링크"],
] as const;

export default function WmsProductInfoPage() {
  const params = useParams<{ skuId: string }>();
  const router = useRouter();
  const fromWave = useSearchParams().get("fromWave") || "";
  const skuId = normalizeSkuId(decodeURIComponent(params.skuId || ""));
  const [item, setItem] = useState<ProductCatalogItem | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [imageEditOpen, setImageEditOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/wms/product-catalog", { cache: "no-store" });
      const data = await response.json();
      const found = ((data.items || []) as ProductCatalogItem[]).find(product => normalizeSkuId(product.skuId) === skuId) || null;
      setItem(found);
      if (found) setValues({ ...Object.fromEntries(EDIT_FIELDS.map(([field]) => [field, String(found[field] || "")])), imageUrl: found.imageUrl || "" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상품정보를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [skuId]);

  function goBackToList() {
    if (fromWave) router.push(`/wms/picking/waves/${encodeURIComponent(fromWave)}`);
    else router.back();
  }

  async function save() {
    if (!item) return;
    const fields = [...EDIT_FIELDS.map(([field]) => field), "imageUrl"];
    const patch = Object.fromEntries(fields.filter(field => values[field] !== String(item[field as keyof ProductCatalogItem] || "")).map(field => [field, values[field]]));
    if (!Object.keys(patch).length) { setMessage("변경된 항목이 없습니다."); return; }
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/wms/product-catalog/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skuId, ...patch }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "상품정보 저장에 실패했습니다.");
      setMessage(`${data.updatedFields.length}개 항목을 제품DB에 저장했습니다.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상품정보 저장에 실패했습니다.");
    } finally { setSaving(false); }
  }

  return (
    <main className="wms-page-shell" style={{ paddingTop: "12px", paddingBottom: "calc(20px + env(safe-area-inset-bottom))", color: wmsColors.ink, fontFamily: "sans-serif" }}>
      <button type="button" onClick={goBackToList} style={{ ...wmsGhostButton, marginBottom: "12px" }}>← 목록으로 돌아가기</button>
      <h1 style={{ margin: "0 0 4px", fontSize: "20px" }}>상품정보 확인·수정</h1>
      <p style={{ margin: "0 0 14px", color: wmsColors.muted, fontSize: "11px" }}>SKU {skuId} · 정확히 일치하는 제품DB 1개 행만 수정합니다.</p>
      {loading ? <p>불러오는 중...</p> : !item ? <p style={{ color: "#a33b2e" }}>제품DB에서 이 SKU를 찾지 못했습니다.</p> : <>
        <div style={{ display: "flex", gap: "12px", padding: "12px", border: `1px solid ${wmsColors.border}`, borderRadius: "12px", background: "#fff", marginBottom: "12px" }}>
          {values.imageUrl ? <img src={getWmsDisplayImageUrl(values.imageUrl)} alt={item.productName} width={96} height={96} style={{ width: "96px", height: "96px", borderRadius: "10px", objectFit: "contain", background: wmsColors.surfaceBeige }} /> : <div style={{ width: "96px", height: "96px", borderRadius: "10px", display: "grid", placeItems: "center", background: wmsColors.surfaceBeige, color: wmsColors.muted, fontSize: "11px" }}>이미지 없음</div>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong style={{ fontSize: "14px", lineHeight: 1.4 }}>{item.productName}</strong>
            <div style={{ marginTop: "4px", fontSize: "12px", color: wmsColors.muted }}>거래처 {values.vendorName || "거래처 미등록"}</div>
            <button type="button" onClick={() => setImageEditOpen(true)} style={{ ...wmsSecondaryButton, minHeight: "36px", marginTop: "8px", fontSize: "12px" }}>{values.imageUrl ? "이미지 변경" : "이미지 등록"}</button>
          </div>
        </div>
        {EDIT_FIELDS.map(([field, label]) => <label key={field} style={{ display: "block", marginBottom: "10px" }}>
          <span style={{ display: "block", fontSize: "11px", color: wmsColors.muted, marginBottom: "4px" }}>{label}</span>
          <input value={values[field] || ""} onChange={event => setValues(previous => ({ ...previous, [field]: event.target.value }))} style={{ width: "100%", minHeight: "42px", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "9px", padding: "8px 10px", fontSize: "14px" }} />
        </label>)}
        {values.productLink ? <a href={values.productLink} target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center", textDecoration: "none", ...wmsSecondaryButton, marginBottom: "10px" }}>제품페이지 열기 ↗</a> : <div style={{ textAlign: "center", color: wmsColors.muted, fontSize: "12px", marginBottom: "10px" }}>제품링크 없음</div>}
        {message && <p role="status" style={{ fontSize: "12px", color: message.includes("저장했습니다") ? wmsColors.greenDark : "#a33b2e" }}>{message}</p>}
        <button type="button" disabled={saving} onClick={save} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "48px", opacity: saving ? 0.6 : 1 }}>{saving ? "저장 중..." : "제품DB에 저장"}</button>
        {imageEditOpen && <ImageEditSheet skuId={skuId} currentImageUrl={values.imageUrl} onClose={() => setImageEditOpen(false)} onSaved={url => { setValues(previous => ({ ...previous, imageUrl: url })); setImageEditOpen(false); }} />}
      </>}
    </main>
  );
}
