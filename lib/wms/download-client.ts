export type ReservedDownloadTarget = Window | null;

function isAppleMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** iOS가 비동기 Blob 다운로드를 현재 탭 미리보기로 바꾸지 않도록 클릭 순간 새 탭을 확보한다. */
export function reserveDownloadTarget(): ReservedDownloadTarget {
  if (typeof window === "undefined" || !isAppleMobileBrowser()) return null;
  const target = window.open("about:blank", "_blank");
  if (target) {
    target.opener = null;
    target.document.title = "파일 생성 중";
    target.document.body.textContent = "파일을 생성하고 있습니다. 잠시만 기다려주세요.";
  }
  return target;
}

export function closeReservedDownloadTarget(target: ReservedDownloadTarget) {
  if (target && !target.closed) target.close();
}

export function downloadBlobPreservingPage(blob: Blob, fileName: string, target: ReservedDownloadTarget = null) {
  const url = URL.createObjectURL(blob);
  if (target && !target.closed) {
    target.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
