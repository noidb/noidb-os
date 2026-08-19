"use client";

import { useState } from "react";
import type { PickingWaveItem } from "@/lib/wms/picking-wave/types";
import type { ProductCatalogWritableField } from "@/lib/wms/product-catalog-write";
import { wmsColors, wmsPrimaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
import ImageEditSheet from "./ImageEditSheet";

interface Props {
  item: PickingWaveItem;
  onClose: () => void;
  onSaved: (patch: Partial<PickingWaveItem>) => void;
}

interface FieldRow {
  field: ProductCatalogWritableField;
  label: string;
}

const TEXT_FIELDS: FieldRow[] = [
  { field: "productName", label: "상품명" },
  { field: "optionLabel", label: "옵션명" },
  { field: "modelName", label: "모델명" },
  { field: "category", label: "카테고리" },
  { field: "vendorName", label: "거래처" },
  { field: "warehouseNumber", label: "창고번호" },
  { field: "boxNumber", label: "BOX번호" },
  { field: "currentStock", label: "현재고" },
  { field: "barcode", label: "쿠팡 바코드" },
];

function initialValues(item: PickingWaveItem): Record<ProductCatalogWritableField, string> {
  return {
    modelName: item.modelName || "",
    productName: item.productName || "",
    optionLabel: item.optionLabel || "",
    category: item.category || "",
    vendorName: item.vendorName || "",
    warehouseNumber: item.catalogWarehouseNumber || "",
    boxNumber: item.catalogBoxNumber || "",
    currentStock: item.catalogCurrentStock || "",
    barcode: item.catalogBarcode || "",
    imageUrl: item.imageUrl || "",
  };
}

/**
 * 상품정보를 필드별로 탭해서 바로 수정하는 바텀시트. SKU ID는 구글시트 행을 찾는 고유 키라서
 * 읽기 전용으로만 보여준다. 실제 저장(Google Sheets 반영)은 이 시트 안의 "저장" 확인 단계에서만
 * 일어난다 — 필드를 눌러 값을 바꾸는 것만으로는 아무 것도 반영되지 않는다.
 */
export default function ProductInfoEditSheet({ item, onClose, onSaved }: Props) {
  const original = initialValues(item);
  const [values, setValues] = useState(original);
  const [editingField, setEditingField] = useState<ProductCatalogWritableField | null>(null);
  const [imageEditOpen, setImageEditOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const changedFields = (Object.keys(values) as ProductCatalogWritableField[]).filter(f => values[f] !== original[f]);

  function updateValue(field: ProductCatalogWritableField, value: string) {
    setValues(prev => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaveState("saving");
    setSaveError(null);
    try {
      const body: Record<string, string | boolean> = { skuId: item.productCode };
      for (const field of changedFields) body[field] = values[field];

      const response = await fetch("/api/wms/product-catalog/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setSaveState("error");
        setSaveError(data.error || "제품DB 저장에 실패했습니다.");
        return;
      }

      const patch: Partial<PickingWaveItem> = {};
      for (const field of data.updatedFields as ProductCatalogWritableField[]) {
        if (field === "warehouseNumber") patch.catalogWarehouseNumber = values.warehouseNumber;
        else if (field === "boxNumber") patch.catalogBoxNumber = values.boxNumber;
        else if (field === "currentStock") patch.catalogCurrentStock = values.currentStock;
        else if (field === "imageUrl") patch.imageUrl = values.imageUrl;
        else (patch as any)[field] = values[field];
      }
      onSaved(patch);
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "제품DB 저장 중 오류가 발생했습니다.");
    } finally {
      setSaveState(prev => (prev === "saving" ? "idle" : prev));
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(37,37,37,0.6)", display: "flex", alignItems: "flex-end", zIndex: 55 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#ffffff", borderRadius: "16px 16px 0 0", padding: "20px", width: "100%", maxWidth: "420px", margin: "0 auto", maxHeight: "85vh", overflowY: "auto" }}
      >
        <h3 style={{ margin: "0 0 4px", fontSize: "15px" }}>상품 정보 수정</h3>
        <p style={{ margin: "0 0 14px", fontSize: "11px", color: wmsColors.muted }}>
          SKU ID: {item.productCode} (읽기 전용) · 값을 눌러 바로 고치고, 마지막에 저장을 눌러야 구글시트에 반영됩니다.
        </p>

        {!confirming ? (
          <>
            <button
              onClick={() => setImageEditOpen(true)}
              style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "10px", marginBottom: "10px", cursor: "pointer" }}
            >
              {values.imageUrl ? (
                <img src={values.imageUrl} alt="" width={40} height={40} style={{ width: "40px", height: "40px", borderRadius: "6px", objectFit: "cover" }} />
              ) : (
                <div style={{ width: "40px", height: "40px", borderRadius: "6px", background: wmsColors.border }} />
              )}
              <div style={{ textAlign: "left", flex: 1 }}>
                <div style={{ fontSize: "11px", color: wmsColors.muted }}>대표이미지</div>
                <div style={{ fontSize: "12px", fontWeight: 700 }}>{values.imageUrl ? "탭해서 교체" : "탭해서 사진 추가"}</div>
              </div>
            </button>

            {TEXT_FIELDS.map(row => (
              <div key={row.field} style={{ borderBottom: `1px solid ${wmsColors.border}`, padding: "8px 2px" }}>
                <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "2px" }}>{row.label}</div>
                {editingField === row.field ? (
                  <input
                    autoFocus
                    value={values[row.field]}
                    onChange={e => updateValue(row.field, e.target.value)}
                    onBlur={() => setEditingField(null)}
                    style={{ width: "100%", fontSize: "13px", padding: "6px 8px", borderRadius: "6px", border: `1px solid ${wmsColors.borderStrong}` }}
                  />
                ) : (
                  <button
                    onClick={() => setEditingField(row.field)}
                    style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, fontSize: "13px", fontWeight: 700, cursor: "pointer", color: values[row.field] ? wmsColors.ink : wmsColors.muted }}
                  >
                    {values[row.field] || "(비어있음 — 탭해서 입력)"}
                  </button>
                )}
              </div>
            ))}

            <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
              <button onClick={onClose} style={{ ...wmsGhostButton, flex: 1 }}>
                닫기
              </button>
              <button
                onClick={() => setConfirming(true)}
                disabled={changedFields.length === 0}
                style={{ ...wmsPrimaryButton, flex: 2, opacity: changedFields.length === 0 ? 0.5 : 1 }}
              >
                변경사항 저장{changedFields.length > 0 ? ` (${changedFields.length}개)` : ""}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: "12px", color: wmsColors.muted, marginBottom: "10px" }}>
              아래 내용을 제품DB 구글시트에 즉시 반영합니다. 확인해주세요.
            </p>
            {changedFields.map(field => {
              const label = field === "imageUrl" ? "대표이미지" : TEXT_FIELDS.find(r => r.field === field)?.label || field;
              return (
                <div key={field} style={{ fontSize: "12px", marginBottom: "6px" }}>
                  <span style={{ color: wmsColors.muted }}>{label}: </span>
                  {field === "imageUrl" ? (
                    <strong style={{ color: wmsColors.greenDark }}>새 이미지로 교체</strong>
                  ) : (
                    <>
                      <span style={{ textDecoration: "line-through", color: wmsColors.muted }}>{original[field] || "(없음)"}</span>
                      {" → "}
                      <strong style={{ color: wmsColors.greenDark }}>{values[field] || "(없음)"}</strong>
                    </>
                  )}
                </div>
              );
            })}

            {saveState === "error" && <p style={{ fontSize: "11px", color: "#c0392b", margin: "8px 0" }}>{saveError}</p>}

            <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
              <button onClick={() => setConfirming(false)} style={{ ...wmsGhostButton, flex: 1 }}>
                뒤로
              </button>
              <button
                onClick={handleSave}
                disabled={saveState === "saving"}
                style={{ ...wmsPrimaryButton, flex: 2, opacity: saveState === "saving" ? 0.6 : 1 }}
              >
                {saveState === "saving" ? "저장 중..." : saveState === "error" ? "재시도" : "확인 후 저장"}
              </button>
            </div>
          </>
        )}
      </div>

      {imageEditOpen && (
        <ImageEditSheet
          skuId={item.productCode}
          currentImageUrl={values.imageUrl}
          onClose={() => setImageEditOpen(false)}
          onSaved={url => {
            updateValue("imageUrl", url);
            setImageEditOpen(false);
          }}
        />
      )}
    </div>
  );
}
