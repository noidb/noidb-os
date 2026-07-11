/**
 * Fit an already-finished image onto a plain white square canvas.
 * Used only to nudge scale/position/exposure of user-provided option
 * thumbnails — never redraws or regenerates the product itself.
 */

export type FitAdjust = {
  scale: number;
  offsetX: number;
  offsetY: number;
  brightness: number;
  contrast: number;
  shadow: boolean;
};

export function defaultFitAdjust(): FitAdjust {
  return { scale: 1, offsetX: 0, offsetY: 0, brightness: 0, contrast: 1, shadow: true };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function applyBrightnessContrast(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  brightness: number,
  contrast: number
) {
  if (!brightness && contrast === 1) return;
  const imageData = ctx.getImageData(0, 0, width, height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = (d[i + c] - 128) * contrast + 128 + brightness;
      d[i + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

/** Compose onto #FFFFFF square canvas with user-tunable scale/offset/exposure. */
export async function fitToWhiteCanvas(
  sourceDataUrl: string,
  adjust: FitAdjust,
  size = 1000
): Promise<string> {
  const img = await loadImage(sourceDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);

  const baseFill = 0.84;
  const scaleFactor = Math.max(0.3, Math.min(2.5, adjust.scale));
  const maxSide = size * baseFill * scaleFactor;
  const scale = Math.min(maxSide / img.width, maxSide / img.height);
  const drawW = Math.max(1, Math.round(img.width * scale));
  const drawH = Math.max(1, Math.round(img.height * scale));
  const x = Math.round((size - drawW) / 2 + adjust.offsetX * size * 0.5);
  const y = Math.round((size - drawH) / 2 + adjust.offsetY * size * 0.5);

  if (adjust.shadow) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.beginPath();
    ctx.ellipse(
      size / 2 + adjust.offsetX * size * 0.5,
      y + drawH - 4,
      Math.max(36, drawW * 0.3),
      13,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x, y, drawW, drawH);

  applyBrightnessContrast(ctx, size, size, adjust.brightness, adjust.contrast);

  return canvas.toDataURL("image/jpeg", 0.95);
}
