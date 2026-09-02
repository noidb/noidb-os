export type ReservedDownloadTarget = Window | null;

/** 호출부 호환용. iOS에서 빈 탭을 선점하면 Blob 이동이 실패할 때 about:blank에 갇히므로 사용하지 않는다. */
export function reserveDownloadTarget(): ReservedDownloadTarget {
  return null;
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
