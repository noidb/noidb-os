"use client";

import { useEffect, useRef, useState } from "react";
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
  statusSaving?: boolean;
  readOnly?: boolean;
  onBeforeExport: () => Promise<VendorOrderDraftLine[]>;
  onMarkSent: () => void | Promise<void>;
  onReviseAgain: () => void | Promise<void>;
}

/** Validate current rows, then open the device share sheet with one PNG attachment. */
export default function VendorOrderExportPanel({ wave, vendorName, lines, status, busy = false, statusSaving = false, readOnly = false, onBeforeExport, onMarkSent, onReviseAgain }: Props) {
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const exporting = useRef(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const [preparedShare, setPreparedShare] = useState<{ files: File[]; blobs: Blob[]; nextIndex?: number } | null>(null);
  const locked = busy || exportBusy || statusSaving;
  const contentVersion = JSON.stringify(lines);
  useEffect(() => { setPreparedShare(null); }, [contentVersion, status]);

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

  async function downloadPreparedFiles(blobs: Blob[], files: File[]) {
    if (files.length === 1) {
      downloadBlob(blobs[0], files[0].name);
      return;
    }
    setExportProgress(`발주서 이미지 ${files.length}장을 ZIP으로 묶고 있습니다…`);
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    files.forEach((file, index) => zip.file(file.name, blobs[index]));
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const safeVendor = vendorName.replace(/[\\/:*?"<>|]/g, "_");
    downloadBlob(zipBlob, `발주서_${safeVendor}_${wave.id}_${files.length}장.zip`);
  }

  async function handleShare() {
    if (busy || exporting.current) return;
    exporting.current = true;
    setExportBusy(true);
    setNotice(null);
    try {
      // Windows의 Web Share API가 true여도 카카오톡 PC가 PNG 파일 공유 대상으로 등록되어
      // 있지 않으면 공유창만 닫히고 채팅방에는 아무것도 전달되지 않는다. 화면 폭이나 터치
      // 지원 여부 대신 실제 모바일 UA만 OS 공유 대상으로 사용하고, PC는 확실한 파일 받기로
      // 처리한다.
      const mobileShare = typeof navigator !== "undefined"
        && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
      const desktop = !mobileShare;
      // Web Share API는 클릭 순간의 사용자 동작 권한이 있어야 열린다. 이미지 생성·서버 확인을
      // 기다린 뒤 share()를 호출하면 PC뿐 아니라 품목이 많은 모바일에서도 권한이 사라질 수 있다.
      // 첫 클릭으로 최신 파일을 준비하고 다음 클릭에서는 기다림 없이 공유창부터 연다.
      if (preparedShare) {
        const sharingIndex = preparedShare.nextIndex;
        const filesToShare = sharingIndex === undefined ? preparedShare.files : [preparedShare.files[sharingIndex]];
        setExportProgress("공유창을 열고 있습니다…");
        const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
        try {
          await nav.share!({ files: filesToShare });
          if (sharingIndex !== undefined && sharingIndex + 1 < preparedShare.files.length) {
            const nextIndex = sharingIndex + 1;
            setPreparedShare({ ...preparedShare, nextIndex });
            setNotice({ message: `${sharingIndex + 1}/${preparedShare.files.length}페이지를 공유했습니다. 다음 페이지를 이어서 공유해 주세요.` });
          } else {
            setPreparedShare(null);
            setNotice({ message: "발주서 공유가 완료됐습니다. 카카오톡 전송 여부를 확인한 뒤 발주 완료를 눌러 주세요." });
          }
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
          if (!desktop && sharingIndex === undefined && preparedShare.files.length > 1) {
            setPreparedShare({ ...preparedShare, nextIndex: 0 });
            setNotice({ message: `휴대폰 공유창이 여러 파일을 한 번에 받지 못했습니다. 1/${preparedShare.files.length}페이지부터 한 장씩 공유해 주세요.` });
            return;
          }
          await downloadPreparedFiles(preparedShare.blobs, preparedShare.files);
          setPreparedShare(null);
          setNotice({ message: `컴퓨터 공유창을 열 수 없어 발주서 이미지 ${preparedShare.files.length}장을 ZIP 파일 1개로 다운로드했습니다. 압축을 풀어 카카오톡 채팅창에 한꺼번에 넣어 주세요.` });
        }
        return;
      }

      setExportProgress("단종·재발주 완료 상품을 제외하고 있습니다…");
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
      const blobs: Blob[] = desktop ? await Promise.all(pages.map(renderPage)) : [];
      if (!desktop) {
        for (let index = 0; index < pages.length; index += 1) blobs.push(await renderPage(pages[index], index));
      }
      const files = blobs.map((blob, index) => {
        const suffix = blobs.length > 1 ? `_${index + 1}of${blobs.length}` : "";
        return new File([blob], `발주서_${vendorName}_${wave.id}${suffix}.png`, { type: "image/png" });
      });
      if (desktop) {
        await downloadPreparedFiles(blobs, files);
        setNotice({ message: files.length > 1
          ? `카카오톡용 발주서 이미지 ${files.length}장을 ZIP 파일 1개로 받았습니다. 압축을 푼 뒤 이미지 전체를 선택해 카카오톡 채팅창에 한꺼번에 넣어 주세요.`
          : "카카오톡용 발주서 이미지 1장을 받았습니다. 파일을 카카오톡 채팅창에 넣어 주세요." });
        return;
      }
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
      const canShareFile = Boolean(nav.share) && (!nav.canShare || nav.canShare({ files }));
      if (!canShareFile) {
        await downloadPreparedFiles(blobs, files);
        setNotice({ message: files.length > 1
          ? `컴퓨터 공유창을 사용할 수 없어 발주서 이미지 ${files.length}장을 ZIP 파일 1개로 다운로드했습니다. 압축을 풀어 카카오톡 채팅창에 한꺼번에 넣어 주세요.`
          : "컴퓨터 공유창을 사용할 수 없어 발주서 이미지 1장을 다운로드했습니다. 카카오톡 채팅창에 넣어 주세요." });
        return;
      }
      setPreparedShare({ files, blobs });
      setNotice({ message: `최신 발주서 이미지 ${files.length}장이 준비됐습니다. '공유창 열기'를 눌러 카카오톡을 선택해 주세요.` });
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
      <div style={{ fontSize: "11px", color: wmsColors.muted, marginBottom: "8px" }}>휴대폰은 카카오톡 공유창으로 보내고, 컴퓨터는 모든 발주서 이미지를 ZIP 파일 1개로 받습니다.</div>
      {exportBusy && <p role="status" style={{ fontSize: "12px", marginBottom: "8px" }}>{exportProgress || "발주서를 준비하고 있습니다…"}</p>}
      {notice && <p role={notice.error ? "alert" : "status"} style={{ fontSize: "12px", color: notice.error ? wmsColors.warn : wmsColors.greenDark, marginBottom: "8px", overflowWrap: "anywhere" }}>{notice.message}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
        <button type="button" onClick={() => void handleShare()} disabled={locked} style={{ ...wmsPrimaryButton, minHeight: "52px", fontSize: "13px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25, opacity: locked ? 0.6 : 1 }}>{exportBusy ? "준비 중…" : preparedShare?.nextIndex !== undefined ? `${preparedShare.nextIndex + 1}/${preparedShare.files.length} 페이지 공유` : preparedShare ? "공유창 열기" : "카카오톡으로 공유"}</button>
        {!readOnly && status !== "sent" && <button type="button" onClick={() => { if (!exporting.current) void onMarkSent(); }} disabled={locked} style={{ ...wmsGreenDarkButton, minHeight: "52px", fontSize: "13px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25 }}>{statusSaving ? "저장 중..." : "발주 완료"}</button>}
        {!readOnly && <button type="button" onClick={() => { if (!exporting.current) void onReviseAgain(); }} disabled={locked} style={{ ...wmsSecondaryButton, gridColumn: "1 / -1", minHeight: "42px", fontSize: "12px", padding: "0 6px", whiteSpace: "normal", lineHeight: 1.25 }}>발주내용 수정</button>}
      </div>
    </div>
  );
}
