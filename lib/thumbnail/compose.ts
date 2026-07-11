/** Compose a 1000×1000 white-background thumbnail. Never redesigns the product. */

export type CropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Soft auto-crop: trim near-white margins when product is clearly centered. */
export async function detectContentCrop(sourceDataUrl: string): Promise<CropRect | null> {
  const img = await loadImageElement(sourceDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);

  const isBg = (i: number) => {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return r > 245 && g > 245 && b > 245;
  };

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!isBg(i)) {
        count++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (count < width * height * 0.01) return null;
  const pad = Math.round(Math.max(width, height) * 0.04);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w / width > 0.97 && h / height > 0.97) return null;

  return {
    x: minX / width,
    y: minY / height,
    w: w / width,
    h: h / height,
  };
}

function enhancePixels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  brightness = 8,
  contrast = 1.08
) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const d = imageData.data;
  const factor = contrast;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 248 && d[i + 1] > 248 && d[i + 2] > 248) continue;
    for (let c = 0; c < 3; c++) {
      let v = d[i + c];
      v = (v - 128) * factor + 128 + brightness;
      d[i + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Place product on #FFFFFF 1000×1000.
 * Mild brightness/contrast only — shape never changed.
 */
export async function composeWhiteThumbnail(
  sourceDataUrl: string,
  fillRatio = 0.84,
  crop?: CropRect | null
): Promise<string> {
  const img = await loadImageElement(sourceDataUrl);
  const size = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);

  const sx = crop ? Math.round(crop.x * img.width) : 0;
  const sy = crop ? Math.round(crop.y * img.height) : 0;
  const sw = crop ? Math.max(1, Math.round(crop.w * img.width)) : img.width;
  const sh = crop ? Math.max(1, Math.round(crop.h * img.height)) : img.height;

  const maxSide = Math.round(size * Math.min(0.88, Math.max(0.8, fillRatio)));
  const scale = Math.min(maxSide / sw, maxSide / sh);
  const drawW = Math.round(sw * scale);
  const drawH = Math.round(sh * scale);
  const x = Math.round((size - drawW) / 2);
  const y = Math.round((size - drawH) / 2);

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.beginPath();
  ctx.ellipse(size / 2, y + drawH - 4, Math.max(36, drawW * 0.3), 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, x, y, drawW, drawH);
  enhancePixels(ctx, size, size, 6, 1.06);

  return canvas.toDataURL("image/jpeg", 0.96);
}

export async function normalizeToJpg1000(sourceDataUrl: string): Promise<string> {
  const img = await loadImageElement(sourceDataUrl);
  const size = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const scale = Math.min(size / img.width, size / img.height);
  const dw = Math.round(img.width * scale);
  const dh = Math.round(img.height * scale);
  ctx.drawImage(img, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
  return canvas.toDataURL("image/jpeg", 0.96);
}
