"use client";

import { useRef, useState } from "react";
import { renderVendorOrderImage } from "@/lib/wms/vendor-order/render-order-image";
import type { VendorOrderDraftLine, VendorOrderDraftStatus } from "@/lib/wms/vendor-order/types";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsGreenDarkButton, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";

interface Props {
  wave: PickingWave;
  vendorName: string;
  lines: VendorOrderDraftLine[];
  status: VendorOrderDraftStatus;
  busy?: boolean;
  onBeforeExport: () => Promise<VendorOrderDraftLine[]>;
  onMarkSent: () => void | Promise<void>;
  onReviseAgain: () => void | Promise<void>;
}

/** Validate current rows, then open the device share sheet with one PNG attachment. */
export default function VendorOrderExportPanel({ wave, vendorName, status, busy = false, onBeforeExport, onMarkSent, onReviseAgain }: Props) {
  const [exportBusy, setExportBusy] = useState(false);
  const exporting = useRef(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const locked = busy || exportBusy;

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

  async function handleShare() {
    if (busy || exporting.current) return;
    exporting.current = true;
    setExportBusy(true);
    setNotice(null);
    try {
      const latestLines = await onBeforeExport();
      if (!Array.isArray(latestLines) || latestLines.length === 0) throw new Error("모든 품목이 처리되어 보낼 발주가 없습니다.");
      const blob = await renderVendorOrderImage(vendorName, latestLines, wave.id);
      if (!blob) throw new Error("이미지 발주서 생성에 실패했습니다. 다시 시도해 주세요.");
      const fileName = `발주서_${vendorName}_${wave.id}.png`;
      const file = new File([blob], fileName, { type: "image/png" });
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
      const canShareFile = Boolean(nav.share) && (!nav.canShare || nav.canShare({ files: [file] }));
      if (!canShareFile) {
        downloadBlob(blob, fileName);
        setNotice({ message: "이 브라우저에서는 카카오톡 공유창을 열 수 없어 발주서 이미지를 저장했습니다. 휴대폰의 Chrome 또는 Safari에서 다시 누르면 카카오톡 채팅방을 선택할 수 있습니다." });
        return;
      }
      try {
        // A single PNG attachment keeps KakaoTalk in its normal chat-share flow.
        await nav.share!({ files: [file] });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        throw new Error("카카오톡 공유창을 열지 못했습니다. 휴대폰의 Chrome 또는 Safari에서 다시 눌러 주세요.");
      }
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "발주서 공유 준비에 실패했습니다. 다시 시도해 주세요.", error: true });
    } finally {
      exporting.current = false;
      setExportBusy(false);
    }
  }

  return (
    <div aria-busy={locked} style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px dashed ${wmsColors.border}` }}>
      <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "8px" }}>발주서 이미지를 카카오톡 채팅방으로 바로 공유합니다.</div>
      {exportBusy && <p role="status" style={{ fontSize: "12px", marginBottom: "8px" }}>최신 발주서를 준비하고 있습니다…</p>}
      {notice && <p role={notice.error ? "alert" : "status"} style={{ fontSize: "12px", color: notice.error ? wmsColors.warn : wmsColors.greenDark, marginBottom: "8px", overflowWrap: "anywhere" }}>{notice.message}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
        <button type="button" onClick={() => void handleShare()} disabled={locked} style={{ ...wmsPrimaryButton, minHeight: "52px", fontSize: "13px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25, opacity: locked ? 0.6 : 1 }}>{exportBusy ? "준비 중…" : "카카오톡으로 공유"}</button>
        <button type="button" onClick={() => { if (!exporting.current) void onMarkSent(); }} disabled={locked} style={{ ...wmsGreenDarkButton, minHeight: "52px", fontSize: "13px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25 }}>{busy ? "저장 중..." : status === "sent" ? "전송완료 해제" : "전송완료"}</button>
        <button type="button" onClick={() => { if (!exporting.current) void onReviseAgain(); }} disabled={locked} style={{ ...wmsSecondaryButton, gridColumn: "1 / -1", minHeight: "42px", fontSize: "12px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25 }}>{status === "sent" ? "다시 수정" : "발주내용 수정"}</button>
      </div>
    </div>
  );
}
