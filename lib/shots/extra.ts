/** Extra Coupang images: canvas crop / collage only — no generative redesign. */

import { loadImageElement } from "@/lib/thumbnail/compose";

/** Detail close-up: center crop + light sharpening/brightness, 1000×1000 JPG. */
export async function buildCloseupFromSource(
  sourceDataUrl: string,
  zoom = 1.65
): Promise<string> {
  const img = await loadImageElement(sourceDataUrl);
  const size = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");

  const side = Math.min(img.width, img.height) / Math.max(1.2, Math.min(2.4, zoom));
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  // Mild brightness lift (pixel copy)
  const imageData = ctx.getImageData(0, 0, size, size);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] + 6);
    d[i + 1] = Math.min(255, d[i + 1] + 6);
    d[i + 2] = Math.min(255, d[i + 2] + 6);
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/jpeg", 0.95);
}

/**
 * Natural multi-option layout using approved thumbnails only.
 * No borders/dividers. Requires ≥2 approved images.
 */
export async function buildOptionsCollage(
  approvedDataUrls: string[]
): Promise<string> {
  if (approvedDataUrls.length < 2) {
    throw new Error("승인된 옵션 썸네일이 2개 이상 필요합니다.");
  }

  const imgs = await Promise.all(approvedDataUrls.slice(0, 3).map(loadImageElement));
  const size = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");

  ctx.fillStyle = "#FAFAFA";
  ctx.fillRect(0, 0, size, size);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const n = imgs.length;
  if (n === 2) {
    const item = 460;
    const gap = 40;
    const total = item * 2 + gap;
    const startX = Math.round((size - total) / 2);
    const y = Math.round((size - item) / 2);
    imgs.forEach((img, i) => {
      const x = startX + i * (item + gap);
      ctx.drawImage(img, x, y, item, item);
    });
  } else {
    // 3 options: triangular natural placement
    const large = 420;
    const small = 360;
    const positions = [
      { x: 290, y: 80, s: large },
      { x: 70, y: 480, s: small },
      { x: 570, y: 480, s: small },
    ];
    imgs.forEach((img, i) => {
      const p = positions[i];
      ctx.drawImage(img, p.x, p.y, p.s, p.s);
    });
  }

  return canvas.toDataURL("image/jpeg", 0.95);
}
