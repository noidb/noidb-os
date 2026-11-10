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

type DrawableImage = HTMLImageElement | HTMLCanvasElement;

function dims(img: DrawableImage) {
  return img instanceof HTMLImageElement ? { w: img.naturalWidth, h: img.naturalHeight } : { w: img.width, h: img.height };
}

/**
 * 크게 줄여 그릴 때 한 번에 줄이면 거칠어진다(깨진 선·계단).
 * 목표 폭의 2배 안쪽이 될 때까지 절반씩 줄여 두면 마지막 줄이기가 부드럽다. 사진 내용은 만들지 않고 줄이기만 한다.
 */
function halveToward(img: DrawableImage, targetWidth: number): DrawableImage {
  let current: DrawableImage = img;
  let { w, h } = dims(img);
  while (w / 2 >= targetWidth && w > 2 && h > 2) {
    const nw = Math.max(1, Math.round(w / 2));
    const nh = Math.max(1, Math.round(h / 2));
    const step = document.createElement("canvas");
    step.width = nw;
    step.height = nh;
    const sc = step.getContext("2d");
    if (!sc) break;
    sc.imageSmoothingEnabled = true;
    sc.imageSmoothingQuality = "high";
    sc.drawImage(current, 0, 0, nw, nh);
    current = step;
    w = nw;
    h = nh;
  }
  return current;
}

/**
 * 화면 미리보기용으로 큰 원본을 한 번만 줄여 둔다(긴 변 기본 2400px).
 * 끌고 확대할 때 수천 px 원본을 매번 다시 그리지 않아 빨라진다. 저장 파일은 이 미리보기가 아니라 원본에서 만든다.
 */
export function makePreviewSource(img: HTMLImageElement, maxSide = 2400): DrawableImage {
  const { w, h } = dims(img);
  const longSide = Math.max(w, h);
  if (longSide <= maxSide) return img;
  const ratio = maxSide / longSide;
  const tw = Math.max(1, Math.round(w * ratio));
  const th = Math.max(1, Math.round(h * ratio));
  const half = halveToward(img, tw);
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) return img;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(half, 0, 0, tw, th);
  return canvas;
}

export type CropQuality = {
  level: "ok" | "warn" | "blur";
  /** 결과 1px을 만드는 데 쓰는 원본 점 수의 역수. 1보다 크면 원본보다 늘려 그리는 중(흐려짐). */
  scale: number;
  /** 지금 잘라 쓰는 원본 부분의 폭(px). 1000보다 작으면 늘려서 쓰는 중. */
  regionPx: number;
};

/** 원본 크기와 확대 정도로 화질 단계를 알려준다. 1.0배까지 충분, 1.5배까지 주의, 그 위는 흐려짐. */
export function cropQuality(sourceWidth: number, sourceHeight: number, zoom: number, size = 1000): CropQuality {
  const scale = Math.min(size / Math.max(1, sourceWidth), size / Math.max(1, sourceHeight)) * zoom;
  const level = scale <= 1.001 ? "ok" : scale <= 1.5 ? "warn" : "blur";
  return { level, scale, regionPx: Math.round(size / scale) };
}

/** 화질이 흐려지기 직전까지의 최대 확대 배율(원래 크기 1배는 항상 허용). */
export function maxZoomForQuality(sourceWidth: number, sourceHeight: number, size = 1000, maxScale = 1.5) {
  const base = Math.min(size / Math.max(1, sourceWidth), size / Math.max(1, sourceHeight));
  return Math.max(1, maxScale / base);
}

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
    // 축소했을 때 사진 가장자리와 채운 배경 사이에 선이 보이지 않게, 사진 테두리를 배경 쪽으로 부드럽게 녹여 그린다.
    const feather = Math.max(2, Math.round(size * 0.035));
    if (xr - xl > feather * 3 && yb - yt > feather * 3) {
      const photo = document.createElement("canvas");
      photo.width = size;
      photo.height = size;
      const pc = photo.getContext("2d");
      if (pc) {
        pc.imageSmoothingEnabled = true;
        pc.imageSmoothingQuality = "high";
        pc.drawImage(img, dx, dy, dw, dh);
        pc.globalCompositeOperation = "destination-in";
        const fade = (x0: number, y0: number, x1: number, y1: number) => {
          const g = pc.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, "rgba(0,0,0,0)");
          g.addColorStop(1, "rgba(0,0,0,1)");
          pc.fillStyle = g;
          pc.fillRect(0, 0, size, size);
        };
        if (xl > 0) fade(xl, 0, xl + feather, 0);
        if (xr < size) fade(xr, 0, xr - feather, 0);
        if (yt > 0) fade(0, yt, 0, yt + feather);
        if (yb < size) fade(0, yb, 0, yb - feather);
        ctx.drawImage(photo, 0, 0);
        return;
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
export function drawSquareCrop(canvas: HTMLCanvasElement, img: DrawableImage, crop: SquareCrop, size: number, reference?: { width: number; height: number }) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  const { w, h } = dims(img);
  const scale = Math.min(size / w, size / h) * crop.zoom;
  const drawW = w * scale;
  const drawH = h * scale;
  // 원본이 그릴 크기의 2배보다 크면 절반씩 줄여 두고 그린다(고화질 축소).
  const source = scale < 0.5 ? halveToward(img, Math.max(1, Math.round(drawW))) : img;
  drawWithEdgeFill(ctx, source, (size - drawW) / 2 + crop.x * size, (size - drawH) / 2 + crop.y * size, drawW, drawH, size);

  const brightness = crop.brightness || 0;
  // 원본보다 늘려 그린 만큼(scale>1) 아주 약한 선명도만 자동으로 더한다. 없던 모양을 만들지 않고 흐릿함만 살짝 줄이는 정도(최대 0.12).
  // reference: 미리보기(줄인 사진)로 그릴 때도 원본·1000px 기준으로 계산해 저장 결과와 같게 보이게 한다.
  const qualityScale = reference ? Math.min(1000 / reference.width, 1000 / reference.height) * crop.zoom : scale;
  const autoSharpen = qualityScale > 1.001 ? Math.min(0.12, (qualityScale - 1) * 0.12) : 0;
  const amount = Math.min(1, sharpenAmount(crop.sharpness || 0) + autoSharpen);
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
