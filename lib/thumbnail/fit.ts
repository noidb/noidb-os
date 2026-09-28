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

/**
 * 사진을 자르거나 늘리지 않고 1:1로 만든다. 남는 양옆(또는 위아래)은 같은 사진을
 * 크게 흐려 깔아 흰 여백 없이 이어 붙인다.
 */
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const coverScale = Math.max(size / w, size / h);
  ctx.save();
  ctx.filter = "blur(40px)";
  ctx.drawImage(img, (size - w * coverScale) / 2, (size - h * coverScale) / 2, w * coverScale, h * coverScale);
  ctx.restore();

  const scale = Math.min(size / w, size / h);
  const drawW = Math.round(w * scale);
  const drawH = Math.round(h * scale);
  const x = Math.round((size - drawW) / 2);
  const y = Math.round((size - drawH) / 2);

  const layer = document.createElement("canvas");
  layer.width = size;
  layer.height = size;
  const lctx = layer.getContext("2d");
  if (!lctx) throw new Error("캔버스를 만들 수 없습니다.");
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = "high";
  lctx.drawImage(img, x, y, drawW, drawH);
  const feather = 40;
  lctx.globalCompositeOperation = "destination-in";
  if (drawW < size) {
    const g = lctx.createLinearGradient(x, 0, x + drawW, 0);
    const f = Math.min(0.5, feather / drawW);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(f, "rgba(0,0,0,1)");
    g.addColorStop(1 - f, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    lctx.fillStyle = g;
    lctx.fillRect(0, 0, size, size);
  }
  if (drawH < size) {
    const g = lctx.createLinearGradient(0, y, 0, y + drawH);
    const f = Math.min(0.5, feather / drawH);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(f, "rgba(0,0,0,1)");
    g.addColorStop(1 - f, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    lctx.fillStyle = g;
    lctx.fillRect(0, 0, size, size);
  }
  ctx.drawImage(layer, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.95);
}

export type SquareCrop = { zoom: number; x: number; y: number; brightness?: number; sharpness?: number };

/** 선명도(0~1)를 3x3 샤픈 커널의 세기로 바꾼다. 화면 미리보기(SVG 필터)와 저장 결과가 같은 값을 쓴다. */
export function sharpenAmount(sharpness: number) { return Math.max(0, Math.min(1, sharpness)); }

/** 사용자가 드래그로 지정한 확대·위치(프레임 대비 비율)대로 1:1 JPG를 만든다. 변형 없이 비율 유지. */
export async function renderSquareCrop(sourceDataUrl: string, crop: SquareCrop, size = 1000): Promise<string> {
  const img = await loadImage(sourceDataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const coverScale = Math.max(size / w, size / h);
  ctx.save();
  ctx.filter = "blur(40px)";
  ctx.drawImage(img, (size - w * coverScale) / 2, (size - h * coverScale) / 2, w * coverScale, h * coverScale);
  ctx.restore();
  const scale = Math.min(size / w, size / h) * crop.zoom;
  const drawW = w * scale;
  const drawH = h * scale;
  ctx.drawImage(img, (size - drawW) / 2 + crop.x * size, (size - drawH) / 2 + crop.y * size, drawW, drawH);

  const brightness = crop.brightness || 0;
  const amount = sharpenAmount(crop.sharpness || 0);
  if (brightness || amount) {
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
