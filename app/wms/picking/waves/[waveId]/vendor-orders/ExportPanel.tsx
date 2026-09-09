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
  const [exportProgress, setExportProgress] = useState("");
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
    setExportProgress("최신 발주서를 확인하고 있습니다…");
    setNotice(null);
    try {
      const latestLines = await onBeforeExport();
      if (!Array.isArray(latestLines) || latestLines.length === 0) throw new Error("모든 품목이 처리되어 보낼 발주가 없습니다.");
      // Mobile Safari cannot export an extremely tall canvas. Split large vendors
      // into safe-sized PNG pages and hand all pages to KakaoTalk in one share action.
      const pageSize = 6;
      const pages = Array.from({ length: Math.ceil(latestLines.length / pageSize) }, (_, index) =>
        latestLines.slice(index * pageSize, index * pageSize + pageSize)
      );
      let completedPages = 0;
      const renderPage = async (pageLines: VendorOrderDraftLine[], index: number) => {
        const blob = await renderVendorOrderImage(vendorName, pageLines, wave.id);
        if (!blob) throw new Error(`이미지 발주서 ${index + 1}페이지 생성에 실패했습니다. 다시 시도해 주세요.`);
        completedPages += 1;
        setExportProgress(`발주서 이미지 ${completedPages}/${pages.length}장 생성 완료`);
        return blob;
      };
      const desktop = typeof window !== "undefined" && window.innerWidth >= 768 && !window.matchMedia("(pointer: coarse)").matches;
      const blobs: Blob[] = desktop ? await Promise.all(pages.map(renderPage)) : [];
      if (!desktop) {
        for (let index = 0; index < pages.length; index += 1) blobs.push(await renderPage(pages[index], index));
      }
      const files = blobs.map((blob, index) => {
        const suffix = blobs.length > 1 ? `_${index + 1}of${blobs.length}` : "";
        return new File([blob], `발주서_${vendorName}_${wave.id}${suffix}.png`, { type: "image/png" });
      });
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
      const canShareFile = Boolean(nav.share) && (!nav.canShare || nav.canShare({ files }));
      if (!canShareFile) {
        files.forEach((file, index) => downloadBlob(blobs[index], file.name));
        setNotice({ message: `컴퓨터 공유창을 사용할 수 없어 발주서 이미지 ${files.length}장을 다운로드 폴더에 저장했습니다. 카카오톡 채팅창에 파일을 끌어 넣어 주세요.` });
        return;
      }
      try {
        setExportProgress("컴퓨터 공유창을 열고 있습니다…");
        await nav.share!({ files });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        throw new Error("카카오톡 공유창을 열지 못했습니다. 휴대폰의 Chrome 또는 Safari에서 다시 눌러 주세요.");
      }
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "발주서 공유 준비에 실패했습니다. 다시 시도해 주세요.", error: true });
    } finally {
      exporting.current = false;
      setExportBusy(false);
      setExportProgress("");
    }
  }

  return (
    <div aria-busy={locked} style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px dashed ${wmsColors.border}` }}>
      <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "8px" }}>발주서 이미지를 카카오톡 채팅방으로 바로 공유합니다. 상품이 많으면 여러 장으로 자동 분할됩니다.</div>
      {exportBusy && <p role="status" style={{ fontSize: "12px", marginBottom: "8px" }}>{exportProgress || "발주서를 준비하고 있습니다…"}</p>}
      {notice && <p role={notice.error ? "alert" : "status"} style={{ fontSize: "12px", color: notice.error ? wmsColors.warn : wmsColors.greenDark, marginBottom: "8px", overflowWrap: "anywhere" }}>{notice.message}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
        <button type="button" onClick={() => void handleShare()} disabled={locked} style={{ ...wmsPrimaryButton, minHeight: "52px", fontSize: "13px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25, opacity: locked ? 0.6 : 1 }}>{exportBusy ? "준비 중…" : "카카오톡으로 공유"}</button>
        <button type="button" onClick={() => { if (!exporting.current) void onMarkSent(); }} disabled={locked} style={{ ...wmsGreenDarkButton, minHeight: "52px", fontSize: "13px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25 }}>{busy ? "저장 중..." : status === "sent" ? "전송완료 해제" : "전송완료"}</button>
        <button type="button" onClick={() => { if (!exporting.current) void onReviseAgain(); }} disabled={locked} style={{ ...wmsSecondaryButton, gridColumn: "1 / -1", minHeight: "42px", fontSize: "12px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25 }}>{status === "sent" ? "다시 수정" : "발주내용 수정"}</button>
      </div>
    </div>
  );
}
