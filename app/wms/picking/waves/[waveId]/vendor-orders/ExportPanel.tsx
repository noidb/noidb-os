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
  productLinksBySku: Record<string, string>;
  onMarkSent: () => void | Promise<void>;
}

/**
 * 승인 완료된 거래처별 부족분 발주서의 카카오톡 전송용 결과물을 만드는 패널.
 * 카카오 SDK/API가 연결되어 있지 않으므로 자동 전송하지 않는다. SKU별 카드 파일을 생성해
 * 사용자가 카카오톡에 직접 첨부한다.
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
export default function VendorOrderExportPanel({ wave, vendorName, lines, status, productLinksBySku, onMarkSent }: Props) {
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

  /** SKU별 카드 파일만 저장한다. Web Share나 자동 카카오톡 전송은 사용하지 않는다. */
  async function handleShare() {
    setShareBusy(true);
    setShareFallbackMessage(null);
    try {
      const blobs = await Promise.all(lines.map(line => renderVendorOrderImage(vendorName, [line], wave.id)));
      if (blobs.some(blob => !blob)) {
        setShareFallbackMessage("이미지 발주서 생성에 실패했습니다 — 다시 시도해주세요.");
        return;
      }
      blobs.forEach((blob, index) => downloadBlob(blob!, `발주서_${vendorName}_${lines[index].skuId}.png`));
      setShareFallbackMessage("SKU별 카드 이미지를 다운로드했습니다 — 카카오톡에서 직접 첨부해주세요.");
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        setShareFallbackMessage("공유 중 오류가 발생했습니다 — 다시 시도해주세요.");
      }
    } finally {
      setShareBusy(false);
    }
  }

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
          {shareBusy ? "생성 중..." : "SKU별 카드 다운로드"}
        </button>
        <button
          onClick={() => onMarkSent()}
          disabled={status === "sent"}
          style={{ ...wmsGreenDarkButton, minHeight: "48px", fontSize: "12px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25, opacity: status === "sent" ? 0.65 : 1 }}
        >
          {status === "sent" ? "전송완료" : "전송완료 표시"}
        </button>
        <a href={`/wms/vendor-orders/receiving?waveId=${encodeURIComponent(wave.id)}&vendor=${encodeURIComponent(vendorName)}`} style={{ ...wmsSecondaryButton, minHeight: "48px", fontSize: "12px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", boxSizing: "border-box" }}>
          발주결과
        </a>
      </div>
    </div>
  );
}
