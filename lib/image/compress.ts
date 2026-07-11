/** Compress a data-URL image for API upload (long edge + JPEG quality). */

export async function compressImageDataUrl(
  sourceDataUrl: string,
  maxLongEdge = 1600,
  quality = 0.82
): Promise<string> {
  const img = await loadImage(sourceDataUrl);
  const long = Math.max(img.width, img.height);
  const scale = long > maxLongEdge ? maxLongEdge / long : 1;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지 압축 캔버스를 만들 수 없습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
