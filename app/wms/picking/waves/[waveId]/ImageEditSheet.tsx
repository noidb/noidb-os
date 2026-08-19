"use client";

import { useRef, useState } from "react";
import { compressImageDataUrl } from "@/lib/image/compress";
import { wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";

interface Props {
  skuId: string;
  currentImageUrl?: string;
  onClose: () => void;
  onSaved: (url: string) => void;
}

/**
 * 대표이미지를 카메라로 바로 촬영하거나 사진 보관함에서 골라 교체하는 바텀시트.
 * 저장 시 구글드라이브(lib/wms/google-drive.ts, drive.file 스코프)에 업로드해 URL만 받아온다 —
 * 원본 사진을 시트 셀에 base64로 직접 넣지 않는다. 제품DB 셀에 실제로 반영하는 것은
 * 이 컴포넌트가 아니라 호출한 쪽(ProductInfoEditSheet)의 "저장" 확인 단계다.
 */
export default function ImageEditSheet({ skuId, currentImageUrl, onClose, onSaved }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreviewDataUrl(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (!previewDataUrl) return;
    setUploading(true);
    setError(null);
    try {
      const compressed = await compressImageDataUrl(previewDataUrl);
      const response = await fetch("/api/wms/product-image/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuId, dataUrl: compressed }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || "이미지 업로드에 실패했습니다.");
        return;
      }
      onSaved(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "이미지 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(37,37,37,0.6)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#ffffff", borderRadius: "16px 16px 0 0", padding: "20px", width: "100%", maxWidth: "420px", margin: "0 auto" }}
      >
        <h3 style={{ margin: "0 0 12px", fontSize: "15px" }}>대표이미지 교체 — SKU {skuId}</h3>

        <div style={{ textAlign: "center", marginBottom: "14px" }}>
          {previewDataUrl ? (
            <img src={previewDataUrl} alt="미리보기" style={{ maxWidth: "100%", maxHeight: "260px", borderRadius: "10px" }} />
          ) : currentImageUrl ? (
            <img src={currentImageUrl} alt="현재 이미지" style={{ maxWidth: "100%", maxHeight: "220px", borderRadius: "10px", opacity: 0.7 }} />
          ) : (
            <div style={{ padding: "40px", color: wmsColors.muted, background: wmsColors.surfaceBeige, borderRadius: "10px" }}>
              현재 이미지 없음
            </div>
          )}
        </div>

        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelected} style={{ display: "none" }} />
        <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleFileSelected} style={{ display: "none" }} />

        {!previewDataUrl ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button onClick={() => cameraInputRef.current?.click()} style={{ ...wmsPrimaryButton, width: "100%" }}>
              카메라로 촬영
            </button>
            <button onClick={() => galleryInputRef.current?.click()} style={{ ...wmsSecondaryButton, width: "100%" }}>
              사진 보관함에서 선택
            </button>
            <button onClick={onClose} style={{ ...wmsGhostButton, width: "100%" }}>
              취소
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {error && <p style={{ fontSize: "12px", color: "#c0392b", margin: 0 }}>{error}</p>}
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setPreviewDataUrl(null)} style={{ ...wmsGhostButton, flex: 1 }} disabled={uploading}>
                다시 선택
              </button>
              <button onClick={handleSave} style={{ ...wmsPrimaryButton, flex: 2, opacity: uploading ? 0.6 : 1 }} disabled={uploading}>
                {uploading ? "업로드 중..." : "이 사진으로 저장"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
