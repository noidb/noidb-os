"use client";

import { useState } from "react";
import { renderVendorOrderImage } from "@/lib/wms/vendor-order/render-order-image";
import type { VendorOrderDraftLine, VendorOrderDraftStatus } from "@/lib/wms/vendor-order/types";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsGreenDarkButton, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";

interface Props {
  wave: PickingWave;
  vendorName: string;
  lines: VendorOrderDraftLine[];
  status: VendorOrderDraftStatus;
  onMarkSent: () => void | Promise<void>;
  onReviseAgain: () => void | Promise<void>;
}

/**
 * 승인 완료된 거래처별 부족분 발주서의 카카오톡 전송용 결과물을 만드는 패널.
 * 어디로도 자동 전송하지 않는다 — 이미지 공유/저장, (지원 시) OS 공유 시트를 여는 Web Share API만
 * 쓴다. 카카오 로그인이나 카카오 SDK는 전혀 쓰지 않는다 (2026-08-19 사용자 확정).
 *
 * 2026-08-19 5차 실사용 테스트 반영: "다른 옵션(카카오톡 문구 복사·엑셀 다운로드)" 보조 메뉴를
 * 이 화면 UI에서 제거했다 — 카카오톡 공유/이미지 저장/전송완료 표시/다시 수정 4개만 남긴다.
 * 문구 생성 로직(buildKakaoOrderText, lib/wms/vendor-order/export-text.ts)과 엑셀 생성 API
 * (/api/wms/vendor-orders/export-excel)는 다른 화면에서 다시 쓸 수 있어 그대로 남겨뒀고, 이
 * 컴포넌트에서 더는 호출하지 않을 뿐이다.
 *
 * 2026-08-20 실기기 테스트 반영: 실제로 쓰는 버튼은 카카오톡 공유/전송완료 표시/다시 수정
 * 3개뿐이라 "이미지 저장" 버튼을 화면에서 완전히 제거했다. 이미지를 직접 만드는 내부 함수
 * (renderVendorOrderImage)는 카카오톡 공유가 파일 공유를 지원하지 않는 기기에서 대신 자동
 * 다운로드하는 폴백으로 계속 쓴다 — 기능 자체는 사라지지 않는다.
 */
export default function VendorOrderExportPanel({ wave, vendorName, lines, status, onMarkSent, onReviseAgain }: Props) {
  const [shareBusy, setShareBusy] = useState(false);
  const [shareFallbackMessage, setShareFallbackMessage] = useState<string | null>(null);

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

  /**
   * 카카오톡 공유는 이미지 발주서 파일만 첨부한다 — 긴 상품목록 텍스트는 공유 본문에 넣지 않는다
   * (2026-08-19 3차 실사용 테스트 반영). 제목은 어떤 발주서인지 구분하는 한 줄만 사용한다.
   * 파일 공유가 안 되는 기기/브라우저에서는 자동으로 텍스트를 대신 보내지 않고, 이미지를 저장해
   * 직접 첨부하도록 안내만 한다.
   */
  async function handleShare() {
    setShareBusy(true);
    setShareFallbackMessage(null);
    try {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
      const blob = await renderVendorOrderImage(vendorName, lines, wave.id);
      if (!blob) {
        setShareFallbackMessage("이미지 발주서 생성에 실패했습니다 — 다시 시도해주세요.");
        return;
      }
      const file = new File([blob], `발주서_${vendorName}_${wave.id}.png`, { type: "image/png" });
      const canShareFile = Boolean(nav.share) && (!nav.canShare || nav.canShare({ files: [file] }));
      if (!canShareFile) {
        // 이 기기/브라우저가 파일 공유를 지원하지 않으면 대신 자동으로 이미지를 다운로드해
        // 사용자가 카카오톡에서 직접 첨부할 수 있게 한다(2026-08-20, "이미지 저장" 버튼 제거에
        // 따른 폴백 — 기능은 그대로 유지).
        downloadBlob(blob, `발주서_${vendorName}_${wave.id}.png`);
        setShareFallbackMessage("이 기기/브라우저는 파일 공유를 지원하지 않아 이미지를 대신 다운로드했습니다 — 카카오톡에서 직접 첨부해주세요.");
        return;
      }
      await nav.share!({ title: `노이드비 발주서 - ${vendorName}`, files: [file] });
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        setShareFallbackMessage("공유 중 오류가 발생했습니다 — 다시 시도해주세요.");
      }
    } finally {
      setShareBusy(false);
    }
  }

  const sent = status === "sent";

  return (
    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px dashed ${wmsColors.border}` }}>
      <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "8px" }}>
        카카오톡 전송용 결과물 (자동 전송 없음 — 직접 공유해주세요)
      </div>

      {shareFallbackMessage && (
        <p style={{ fontSize: "11px", color: wmsColors.warn, marginBottom: "8px" }}>{shareFallbackMessage}</p>
      )}

      {/* 실제로 쓰는 버튼은 이 3개뿐이다(2026-08-20) — 3열 동일 비율, 동일 높이·모서리·글자크기.
       *  세 버튼 모두 배경색이 있는 기존 브랜드 토큰만 쓴다 — 흰색 버튼 금지(2026-08-20 실기기
       *  추가 확인 5번): 진그레이(slate)/그린(greenDark)/베이지(secondary=sand) 3계열로 구분. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
        <button
          onClick={handleShare}
          disabled={shareBusy}
          style={{ ...wmsPrimaryButton, minHeight: "48px", fontSize: "12px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25, opacity: shareBusy ? 0.6 : 1 }}
        >
          {shareBusy ? "여는 중..." : "카카오톡 공유"}
        </button>
        <button
          onClick={() => onMarkSent()}
          disabled={sent}
          style={{ ...wmsGreenDarkButton, minHeight: "48px", fontSize: "12px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25, opacity: sent ? 0.55 : 1 }}
        >
          {sent ? "전송완료됨" : "전송완료 표시"}
        </button>
        <button
          onClick={() => onReviseAgain()}
          style={{ ...wmsSecondaryButton, minHeight: "48px", fontSize: "12px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25 }}
        >
          다시 수정
        </button>
      </div>
    </div>
  );
}
