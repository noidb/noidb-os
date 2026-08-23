"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import { WMS_MOBILE_WIDTH, wmsColors, wmsGhostButton, wmsPrimaryButton } from "@/lib/wms/ui-tokens";

const EDIT_FIELDS = [
  ["productName", "상품명"], ["optionLabel", "옵션명"], ["modelName", "모델명/품번"], ["category", "카테고리"],
  ["vendorName", "거래처"], ["warehouseNumber", "창고번호"], ["boxNumber", "BOX번호"],
  ["currentStock", "현재고"], ["barcode", "바코드"],
] as const;

export default function WmsProductInfoPage() {
  const params = useParams<{ skuId: string }>();
  const skuId = normalizeSkuId(decodeURIComponent(params.skuId || ""));
  const [item, setItem] = useState<ProductCatalogItem | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/wms/product-catalog", { cache: "no-store" });
      const data = await response.json();
      const found = ((data.items || []) as ProductCatalogItem[]).find(product => normalizeSkuId(product.skuId) === skuId) || null;
      setItem(found);
      if (found) setValues(Object.fromEntries(EDIT_FIELDS.map(([field]) => [field, String(found[field] || "")])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상품정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [skuId]);

  async function save() {
    if (!item) return;
    const patch = Object.fromEntries(EDIT_FIELDS.filter(([field]) => values[field] !== String(item[field] || "")).map(([field]) => [field, values[field]]));
    if (!Object.keys(patch).length) { setMessage("변경된 항목이 없습니다."); return; }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/wms/product-catalog/update", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skuId, ...patch }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "상품정보 저장에 실패했습니다.");
      setMessage(`${data.updatedFields.length}개 항목을 제품DB에 저장했습니다.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상품정보 저장에 실패했습니다.");
    } finally { setSaving(false); }
  }

  return (
    <main style={{ maxWidth: WMS_MOBILE_WIDTH, minHeight: "100vh", margin: "0 auto", padding: "12px 12px calc(20px + env(safe-area-inset-bottom))", background: wmsColors.background, color: wmsColors.ink, fontFamily: "sans-serif" }}>
      <a href="/wms/vendor-orders/receiving" style={{ display: "inline-block", marginBottom: "12px", color: wmsColors.slateDark, fontSize: "13px" }}>← 입고처리로</a>
      <h1 style={{ margin: "0 0 4px", fontSize: "20px" }}>상품정보입력</h1>
      <p style={{ margin: "0 0 14px", color: wmsColors.muted, fontSize: "11px" }}>SKU {skuId} · 정확히 일치하는 제품DB 1개 행만 수정합니다.</p>
      {loading ? <p>불러오는 중...</p> : !item ? <p style={{ color: "#a33b2e" }}>제품DB에서 이 SKU를 찾지 못했습니다.</p> : (
        <>
          <div style={{ display: "flex", gap: "12px", padding: "12px", border: `1px solid ${wmsColors.border}`, borderRadius: "12px", background: "#fff", marginBottom: "12px" }}>
            {item.imageUrl ? <img src={getWmsDisplayImageUrl(item.imageUrl)} alt={item.productName} width={88} height={88} style={{ width: "88px", height: "88px", borderRadius: "10px", objectFit: "cover" }} /> : <div style={{ width: "88px", height: "88px", borderRadius: "10px", display: "grid", placeItems: "center", background: wmsColors.surfaceBeige, color: wmsColors.muted, fontSize: "11px" }}>이미지 없음</div>}
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ fontSize: "14px", lineHeight: 1.4 }}>{item.productName}</strong>
              <div style={{ marginTop: "4px", fontSize: "12px", color: wmsColors.muted }}>모델SKU {item.modelSku || "미등록"}</div>
              <div style={{ marginTop: "3px", fontSize: "12px" }}>현재상태 {item.currentStatus || "빈값"}</div>
              <div style={{ marginTop: "3px", fontSize: "12px" }}>원가(포함) {item.costVatIncluded ? `${item.costVatIncluded}원` : "미등록"}</div>
              {item.productLink ? <a href={item.productLink} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: "6px", fontSize: "12px", color: wmsColors.slateDark }}>제품링크 ↗</a> : <span style={{ display: "block", marginTop: "6px", color: wmsColors.muted, fontSize: "11px" }}>제품링크 없음</span>}
            </div>
          </div>
          {EDIT_FIELDS.map(([field, label]) => field === "currentStock" ? (
            <div key={field} style={{ marginBottom: "10px" }}>
              <label style={{ display: "block", fontSize: "11px", color: wmsColors.muted, marginBottom: "4px" }}>{label}</label>
              <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 44px", gap: "6px" }}>
                <button type="button" onClick={() => setValues(previous => ({ ...previous, currentStock: String(Math.max(0, (Number(previous.currentStock) || 0) - 1)) }))} style={wmsGhostButton}>−</button>
                <input type="number" min={0} inputMode="numeric" value={values.currentStock || ""} onChange={event => setValues(previous => ({ ...previous, currentStock: event.target.value }))} style={{ minWidth: 0, minHeight: "44px", textAlign: "center", fontSize: "20px", fontWeight: 900, border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "9px" }} />
                <button type="button" onClick={() => setValues(previous => ({ ...previous, currentStock: String((Number(previous.currentStock) || 0) + 1) }))} style={wmsGhostButton}>＋</button>
              </div>
            </div>
          ) : (
            <label key={field} style={{ display: "block", marginBottom: "10px" }}>
              <span style={{ display: "block", fontSize: "11px", color: wmsColors.muted, marginBottom: "4px" }}>{label}</span>
              <input value={values[field] || ""} onChange={event => setValues(previous => ({ ...previous, [field]: event.target.value }))} style={{ width: "100%", minHeight: "42px", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "9px", padding: "8px 10px", fontSize: "14px" }} />
            </label>
          ))}
          {message && <p style={{ fontSize: "12px", color: message.includes("저장했습니다") ? wmsColors.greenDark : "#a33b2e" }}>{message}</p>}
          <button type="button" disabled={saving} onClick={save} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "48px", opacity: saving ? 0.6 : 1 }}>{saving ? "저장 중..." : "제품DB에 저장"}</button>
        </>
      )}
    </main>
  );
}
