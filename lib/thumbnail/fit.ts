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

  const baseFill = 0.8;
  const scaleFactor = Math.max(0.3, Math.min(3.5, adjust.scale));
  const maxSide = size * baseFill * scaleFactor;
  const scale = Math.min(maxSide / img.width, maxSide / img.height);
  const drawW = Math.max(1, Math.round(img.width * scale));
  const drawH = Math.max(1, Math.round(img.height * scale));
  const x = Math.round((size - drawW) / 2 + adjust.offsetX);
  const y = Math.round((size - drawH) / 2 + adjust.offsetY);

  if (adjust.shadow) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.beginPath();
    ctx.ellipse(
      size / 2 + adjust.offsetX,
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

type DrawableImage = HTMLImageElement;

/**
 * 사진을 (dx,dy,dw,dh) 위치에 그리고, 캔버스에 남는 빈 곳은 사진 가장자리 색을
 * 그대로 이어 붙인 뒤 살짝 흐려 자연스럽게 채운다. 사진 자체는 그대로 둔다.
 */
function drawWithEdgeFill(ctx: CanvasRenderingContext2D, img: DrawableImage, dx: number, dy: number, dw: number, dh: number, size: number) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const strip = 4;
  const xl = Math.max(0, Math.round(dx));
  const xr = Math.min(size, Math.round(dx + dw));
  const yt = Math.max(0, Math.round(dy));
  const yb = Math.min(size, Math.round(dy + dh));
  const covers = xl === 0 && yt === 0 && xr === size && yb === size;
  if (!covers) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, size, size);
    if (xr - xl > strip * 2 && yb - yt > strip * 2) {
      const layer = document.createElement("canvas");
      layer.width = size;
      layer.height = size;
      const lc = layer.getContext("2d");
      if (lc) {
        lc.imageSmoothingEnabled = true;
        lc.imageSmoothingQuality = "high";
        lc.drawImage(img, dx, dy, dw, dh);
        const snapshot = () => {
          const copy = document.createElement("canvas");
          copy.width = size;
          copy.height = size;
          copy.getContext("2d")?.drawImage(layer, 0, 0);
          return copy;
        };
        let copy = snapshot();
        if (xl > 0) lc.drawImage(copy, xl, yt, strip, yb - yt, 0, yt, xl, yb - yt);
        if (xr < size) lc.drawImage(copy, xr - strip, yt, strip, yb - yt, xr, yt, size - xr, yb - yt);
        copy = snapshot();
        if (yt > 0) lc.drawImage(copy, 0, yt, size, strip, 0, 0, size, yt);
        if (yb < size) lc.drawImage(copy, 0, yb - strip, size, strip, 0, yb, size, size - yb);
        const pad = Math.round(size * 0.04);
        ctx.save();
        ctx.filter = `blur(${Math.max(1, Math.round(size * 0.015))}px)`;
        ctx.drawImage(layer, -pad, -pad, size + pad * 2, size + pad * 2);
        ctx.restore();
      }
    }
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

/** 원본 비율 그대로 1:1 안에 넣고 남는 곳은 가장자리 색으로 이어 채운다. */
export async function extendToSquareCanvas(sourceDataUrl: string, size = 1000): Promise<string> {
  const img = await loadImage(sourceDataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w === h && w === size) return sourceDataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  const scale = Math.min(size / w, size / h);
  const drawW = Math.round(w * scale);
  const drawH = Math.round(h * scale);
  drawWithEdgeFill(ctx, img, Math.round((size - drawW) / 2), Math.round((size - drawH) / 2), drawW, drawH, size);
  return canvas.toDataURL("image/jpeg", 0.95);
}

export type SquareCrop = { zoom: number; x: number; y: number; brightness?: number; sharpness?: number };

export function sharpenAmount(sharpness: number) { return Math.max(0, Math.min(1, sharpness)); }

/** 화면 미리보기와 저장이 같은 결과가 되도록 한 함수로 그린다. */
export function drawSquareCrop(canvas: HTMLCanvasElement, img: DrawableImage, crop: SquareCrop, size: number) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(size / w, size / h) * crop.zoom;
  const drawW = w * scale;
  const drawH = h * scale;
  drawWithEdgeFill(ctx, img, (size - drawW) / 2 + crop.x * size, (size - drawH) / 2 + crop.y * size, drawW, drawH, size);

  const brightness = crop.brightness || 0;
  const amount = sharpenAmount(crop.sharpness || 0);
  if (!brightness && !amount) return;
  const image = ctx.getImageData(0, 0, size, size);
  const src = image.data;
  if (amount) {
    const copy = new Uint8ClampedArray(src);
    const stride = size * 4;
    const center = 1 + 4 * amount;
    for (let yy = 1; yy < size - 1; yy += 1) {
      for (let xx = 1; xx < size - 1; xx += 1) {
        const i = yy * stride + xx * 4;
        for (let c = 0; c < 3; c += 1) {
          src[i + c] = copy[i + c] * center - amount * (copy[i + c - 4] + copy[i + c + 4] + copy[i + c - stride] + copy[i + c + stride]);
        }
      }
    }
  }
  if (brightness) {
    for (let i = 0; i < src.length; i += 4) {
      src[i] += brightness;
      src[i + 1] += brightness;
      src[i + 2] += brightness;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** 사용자가 드래그로 지정한 확대·위치·밝기·선명도대로 1:1 JPG를 만든다. */
export async function renderSquareCrop(sourceDataUrl: string, crop: SquareCrop, size = 1000): Promise<string> {
  const img = await loadImage(sourceDataUrl);
  const canvas = document.createElement("canvas");
  drawSquareCrop(canvas, img, crop, size);
  return canvas.toDataURL("image/jpeg", 0.95);
}

/** 원본 비율은 유지하면서 중앙을 잘라 여백 없는 정사각형 JPG로 만든다. */
export async function coverSquareCanvas(sourceDataUrl: string, size = 1000): Promise<string> {
  const img = await loadImage(sourceDataUrl);
  if (img.naturalWidth === img.naturalHeight && img.naturalWidth === size) return sourceDataUrl;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");

  const sourceSize = Math.min(img.naturalWidth, img.naturalHeight);
  const sourceX = Math.round((img.naturalWidth - sourceSize) / 2);
  const sourceY = Math.round((img.naturalHeight - sourceSize) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.95);
}
