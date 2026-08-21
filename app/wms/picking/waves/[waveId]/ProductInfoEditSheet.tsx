"use client";

import { useEffect, useState } from "react";
import type { PickingWaveItem } from "@/lib/wms/picking-wave/types";
import type { LiveResolvedFields } from "@/lib/wms/picking-wave/live-catalog";
import type { ProductCatalogWritableField } from "@/lib/wms/product-catalog-write";
import { wmsColors, wmsPrimaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import ImageEditSheet from "./ImageEditSheet";

interface Props {
  item: PickingWaveItem;
  /** 목록·상세 화면과 완전히 같은 최신 제품DB 값 — 호출한 쪽이 resolveLiveFields()를 한 번만
   *  실행해 넘겨준다(2026-08-20 신규, 이 시트가 매칭 로직을 따로 만들지 않기 위함). */
  live: LiveResolvedFields;
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

/**
 * 그룹별 피킹 목록·체크리스트 등 다른 화면과 완전히 같은 최신 제품DB 값(live)으로 초기값을
 * 만든다 — item(웨이브 생성 시점 스냅샷) 필드는 더 이상 직접 쓰지 않는다(2026-08-20 수정,
 * 근본 원인: 이전에는 이 시트만 item.* 원본 필드를 그대로 썼는데, 웨이브 생성 시점에 제품DB
 * 조인이 실패했던 상품은 그 필드들이 전부 빈 값으로 저장돼 있어 상세창이 통째로 빈칸이었다).
 * live.* 는 resolveLiveFields()가 이미 "최신 제품DB 값이 있으면 그것을 쓰고, 없을 때만 웨이브
 * 저장값으로 대체" 순서로 계산해두므로 여기서 매칭 로직을 다시 만들지 않는다.
 */
function initialValues(item: PickingWaveItem, live: LiveResolvedFields): Record<ProductCatalogWritableField, string> {
  return {
    modelName: live.catalogModelName || "",
    productName: live.name || item.productName || "",
    optionLabel: live.optionLabel || "",
    category: live.category || "",
    vendorName: live.vendorName || "",
    warehouseNumber: live.catalogWarehouseNumber || "",
    boxNumber: live.catalogBoxNumber || "",
    currentStock: live.catalogCurrentStock || "",
    currentStatus: "",
    barcode: live.catalogBarcode || "",
    imageUrl: live.imageUrl || "",
  };
}

/**
 * 상품정보를 필드별로 탭해서 바로 수정하는 바텀시트. SKU ID는 구글시트 행을 찾는 고유 키라서
 * 읽기 전용으로만 보여준다. 실제 저장(Google Sheets 반영)은 이 시트 안의 "저장" 확인 단계에서만
 * 일어난다 — 필드를 눌러 값을 바꾸는 것만으로는 아무 것도 반영되지 않는다.
 *
 * 이 시트는 열릴 때(부모가 조건부 렌더링으로 새로 mount할 때)마다 useState 초기값이 다시
 * 계산되므로, 다른 상품으로 전환하면 항상 그 상품의 최신 live 값으로 시작한다 — 별도의
 * 리셋 useEffect가 필요 없다(같은 상품을 계속 편집하는 동안은 remount되지 않으므로 타이핑
 * 중간에 초기화되지도 않는다).
 */
export default function ProductInfoEditSheet({ item, live, onClose, onSaved }: Props) {
  const original = initialValues(item, live);
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
        style={{ background: "#ffffff", borderRadius: "16px 16px 0 0", padding: "20px 20px calc(20px + env(safe-area-inset-bottom))", width: "100%", maxWidth: "420px", margin: "0 auto", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }}
      >
        <h3 style={{ margin: "0 0 4px", fontSize: "15px" }}>상품 정보 수정</h3>
        <p style={{ margin: "0 0 4px", fontSize: "11px", color: wmsColors.muted }}>
          SKU ID: {item.productCode} (읽기 전용) · 값을 눌러 바로 고치고, 마지막에 저장을 눌러야 구글시트에 반영됩니다.
        </p>
        {live.liveModelSku && (
          <p style={{ margin: "0 0 2px", fontSize: "11px", color: wmsColors.muted }}>모델SKU: {live.liveModelSku} (읽기 전용)</p>
        )}
        {live.productLink ? (
          <p style={{ margin: "0 0 14px", fontSize: "11px" }}>
            제품링크:{" "}
            <a href={live.productLink} target="_blank" rel="noopener noreferrer" style={{ color: wmsColors.slateDark }}>
              열기
            </a>{" "}
            (읽기 전용)
          </p>
        ) : (
          <p style={{ margin: "0 0 14px", fontSize: "11px", color: wmsColors.muted }}>제품링크: 미등록</p>
        )}

        {!confirming ? (
          <>
            <button
              onClick={() => setImageEditOpen(true)}
              style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "10px", marginBottom: "10px", cursor: "pointer" }}
            >
              <InfoSheetThumbnail imageUrl={values.imageUrl} />
              <div style={{ textAlign: "left", flex: 1 }}>
                <div style={{ fontSize: "11px", color: wmsColors.muted }}>대표이미지</div>
                <div style={{ fontSize: "12px", fontWeight: 700 }}>{values.imageUrl ? "이미지 변경" : "탭해서 사진 추가"}</div>
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

/** 대표이미지 미리보기 썸네일 — Google Drive 이미지는 image-proxy를 거치고, 로드 실패 시
 *  빈 placeholder로 전환한다(2026-08-20 신규). */
function InfoSheetThumbnail({ imageUrl }: { imageUrl?: string }) {
  const displaySrc = getWmsDisplayImageUrl(imageUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [displaySrc]);

  if (displaySrc && !failed) {
    return (
      <img
        src={displaySrc}
        alt=""
        width={40}
        height={40}
        onError={() => setFailed(true)}
        style={{ width: "40px", height: "40px", borderRadius: "6px", objectFit: "cover" }}
      />
    );
  }
  return <div style={{ width: "40px", height: "40px", borderRadius: "6px", background: wmsColors.border }} />;
}
