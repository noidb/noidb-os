"use client";

import { useState } from "react";
import { buildKakaoOrderText } from "@/lib/wms/vendor-order/export-text";
import { renderVendorOrderImage } from "@/lib/wms/vendor-order/render-order-image";
import type { VendorOrderDraftLine, VendorOrderDraftStatus } from "@/lib/wms/vendor-order/types";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsSecondaryButton, wmsGhostButton, wmsPrimaryButton } from "@/lib/wms/ui-tokens";

interface Props {
  wave: PickingWave;
  vendorName: string;
  lines: VendorOrderDraftLine[];
  status: VendorOrderDraftStatus;
  onMarkSent: () => void | Promise<void>;
  onReviseAgain: () => void | Promise<void>;
}

/**
 * 승인 완료된 거래처별 부족분 발주서의 카카오톡 전송용 결과물(문구/이미지/엑셀)을 만드는 패널.
 * 어디로도 자동 전송하지 않는다 — 문구 복사, 이미지/엑셀 다운로드, (지원 시) OS 공유 시트를 여는
 * Web Share API만 쓴다. 카카오 로그인이나 카카오 SDK는 전혀 쓰지 않는다 (2026-08-19 사용자 확정).
 */
export default function VendorOrderExportPanel({ wave, vendorName, lines, status, onMarkSent, onReviseAgain }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [imageBusy, setImageBusy] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareFallbackMessage, setShareFallbackMessage] = useState<string | null>(null);
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  const kakaoText = buildKakaoOrderText(vendorName, lines, wave.id);

  async function handleCopyText() {
    try {
      await navigator.clipboard.writeText(kakaoText);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
    }
  }

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleSaveImage() {
    setImageBusy(true);
    try {
      const blob = await renderVendorOrderImage(vendorName, lines, wave.id);
      if (blob) downloadBlob(blob, `발주서_${vendorName}_${wave.id}.png`);
    } finally {
      setImageBusy(false);
    }
  }

  async function handleDownloadExcel() {
    setExcelBusy(true);
    try {
      const response = await fetch("/api/wms/vendor-orders/export-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorName, waveId: wave.id, lines }),
      });
      if (!response.ok) return;
      const blob = await response.blob();
      downloadBlob(blob, `발주서_${vendorName}_${wave.id}.xlsx`);
    } finally {
      setExcelBusy(false);
    }
  }

  async function handleShare() {
    setShareBusy(true);
    setShareFallbackMessage(null);
    try {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
      if (!nav.share) {
        setShareFallbackMessage("이 기기/브라우저는 공유 기능을 지원하지 않습니다 — 위의 '카카오톡 문구 복사'와 '이미지 저장'을 사용해 카카오톡에 직접 붙여넣어 주세요.");
        return;
      }
      const blob = await renderVendorOrderImage(vendorName, lines, wave.id);
      const shareData: ShareData = { title: `노이드비 발주서 - ${vendorName}`, text: kakaoText };
      if (blob) {
        const file = new File([blob], `발주서_${vendorName}_${wave.id}.png`, { type: "image/png" });
        if (!nav.canShare || nav.canShare({ files: [file] })) {
          shareData.files = [file];
        }
      }
      await nav.share(shareData);
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        setShareFallbackMessage("공유 중 오류가 발생했습니다 — '카카오톡 문구 복사'와 '이미지 저장'을 사용해주세요.");
      }
    } finally {
      setShareBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px dashed ${wmsColors.border}` }}>
      <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "8px" }}>
        카카오톡 전송용 결과물 (자동 전송 없음 — 직접 복사/공유해주세요)
      </div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
        <button onClick={handleShare} disabled={shareBusy} style={{ ...wmsPrimaryButton, minHeight: "40px", fontSize: "12px", flex: 1 }}>
          {shareBusy ? "여는 중..." : "카카오톡 공유"}
        </button>
        <button onClick={handleSaveImage} disabled={imageBusy} style={{ ...wmsSecondaryButton, minHeight: "40px", fontSize: "12px", flex: 1 }}>
          {imageBusy ? "생성 중..." : "이미지 저장"}
        </button>
      </div>

      {shareFallbackMessage && (
        <p style={{ fontSize: "11px", color: wmsColors.warn, marginBottom: "8px" }}>{shareFallbackMessage}</p>
      )}

      <button
        onClick={() => setShowMoreOptions(prev => !prev)}
        style={{ background: "none", border: "none", color: wmsColors.muted, fontSize: "11px", padding: "2px 0", marginBottom: "8px", cursor: "pointer" }}
      >
        {showMoreOptions ? "다른 옵션 숨기기 ▲" : "다른 옵션 (문구 복사 · 엑셀 다운로드) ▼"}
      </button>

      {showMoreOptions && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
          <button onClick={handleCopyText} style={{ ...wmsGhostButton, minHeight: "34px", fontSize: "11px" }}>
            {copyState === "copied" ? "복사됨!" : copyState === "failed" ? "복사 실패" : "카카오톡 문구 복사"}
          </button>
          <button onClick={handleDownloadExcel} disabled={excelBusy} style={{ ...wmsGhostButton, minHeight: "34px", fontSize: "11px" }}>
            {excelBusy ? "생성 중..." : "엑셀 다운로드"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: "8px" }}>
        {status !== "sent" && (
          <button onClick={() => onMarkSent()} style={{ ...wmsPrimaryButton, minHeight: "34px", fontSize: "11px", flex: 1 }}>
            전송완료 표시
          </button>
        )}
        <button onClick={() => onReviseAgain()} style={{ ...wmsGhostButton, minHeight: "34px", fontSize: "11px", flex: 1 }}>
          다시 수정
        </button>
      </div>
    </div>
  );
}
