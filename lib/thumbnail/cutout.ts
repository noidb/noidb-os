/**
 * 2026-11-11 대표이미지 정리: 폰으로 찍은 실물 사진 → 배경 제거 → 흰 배경 정사각형 + 밝기 보정.
 *
 * - 배경 제거는 브라우저에서 도는 무료 라이브러리(@imgly/background-removal)를 쓴다. 서버·유료 AI를 쓰지 않는다.
 *   처음 한 번은 모델 파일을 내려받느라 몇 초 더 걸리고, 그 뒤에는 브라우저가 기억해서 빠르다.
 * - 상품 모양은 그대로 두고(다시 그리지 않음) 배경만 지운다.
 * - 이 파일의 함수는 브라우저에서만 호출한다(canvas·Image 사용).
 */

export type CutoutOptions = {
  /** 결과 한 변(px). 쿠팡 대표이미지 기준 1000. */
  size?: number;
  /** 상품이 차지하는 비율(0~1). 나머지는 흰 여백. */
  fill?: number;
  /** 밝기 자동 보정 사용 여부. */
  autoBrighten?: boolean;
  /** 진행 상황 알림(모델 내려받기 등). */
  onProgress?: (message: string) => void;
};

export type CutoutResult = {
  /** 흰 배경 정사각형 JPEG(data URL). */
  squareDataUrl: string;
  /** 배경만 지운 PNG(data URL, 투명). 상세페이지 등 다른 합성에 재사용. */
  transparentDataUrl: string;
  /** 보정에 쓴 밝기 배율(1이면 그대로). */
  brightnessGain: number;
};

type Remover = {
  removeBackground: (
    image: Blob,
    config?: { output?: { format?: string }; progress?: (key: string, current: number, total: number) => void }
  ) => Promise<Blob>;
};

/**
 * 배경 제거 라이브러리는 사이트 빌드에 넣지 않고, 쓸 때 인터넷(esm.sh)에서 불러온다.
 * (npm으로 넣으면 onnxruntime 파일 때문에 Next 빌드가 실패한다 — 2026-11-11 확인.)
 * 버전을 고정해 두어 갑자기 바뀌지 않게 한다. 모델 파일은 라이브러리가 자체 CDN에서 내려받는다.
 */
const REMOVER_URL = "https://esm.sh/@imgly/background-removal@1.7.0";
let removerPromise: Promise<Remover> | null = null;

function loadRemover(): Promise<Remover> {
  if (!removerPromise) {
    removerPromise = (import(/* webpackIgnore: true */ REMOVER_URL) as Promise<Remover>).catch(error => {
      removerPromise = null;
      throw new Error(`배경 제거 도구를 불러오지 못했습니다. 인터넷 연결을 확인해주세요. (${error instanceof Error ? error.message : "알 수 없는 오류"})`);
    });
  }
  return removerPromise;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("사진을 열 수 없습니다."));
    img.src = src;
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

/** 너무 큰 사진은 줄여서 처리한다(속도·메모리). */
async function downscale(dataUrl: string, maxSide = 2000) {
  const img = await loadImage(dataUrl);
  const long = Math.max(img.naturalWidth, img.naturalHeight);
  if (long <= maxSide) return dataUrl;
  const scale = maxSide / long;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

/** 투명이 아닌 부분(상품)의 경계 사각형. */
function opaqueBounds(data: Uint8ClampedArray, width: number, height: number, threshold = 24) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** 상품 픽셀의 밝은 쪽(98%) 밝기를 보고 살짝만 밝게. 최대 1.25배, 어두운 사진만 올린다. */
function autoGain(data: Uint8ClampedArray) {
  const histogram = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const luminance = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    histogram[luminance] += 1;
    count += 1;
  }
  if (!count) return 1;
  const target = count * 0.98;
  let acc = 0;
  let p98 = 255;
  for (let value = 0; value < 256; value += 1) {
    acc += histogram[value];
    if (acc >= target) { p98 = value; break; }
  }
  if (p98 < 40) return 1;
  return Math.max(1, Math.min(1.25, 235 / p98));
}

/** 배경 제거 후 흰 배경 정사각형으로 맞춘다. */
export async function cutoutToWhiteSquare(sourceDataUrl: string, options: CutoutOptions = {}): Promise<CutoutResult> {
  const size = options.size ?? 1000;
  const fill = Math.max(0.3, Math.min(0.98, options.fill ?? 0.86));
  const notify = options.onProgress ?? (() => {});

  notify("배경을 지우는 중입니다... (처음 한 번은 준비 파일을 내려받느라 조금 더 걸립니다)");
  const { removeBackground } = await loadRemover();
  const small = await downscale(sourceDataUrl);
  const cutBlob = await removeBackground(await dataUrlToBlob(small), {
    output: { format: "image/png" },
    progress: (key: string, current: number, total: number) => {
      if (total > 0 && key.startsWith("fetch")) notify(`준비 파일 내려받는 중... ${Math.round((current / total) * 100)}%`);
    },
  });
  const transparentDataUrl = await blobToDataUrl(cutBlob);

  notify("흰 배경 정사각형으로 맞추는 중...");
  const cut = await loadImage(transparentDataUrl);
  const work = document.createElement("canvas");
  work.width = cut.naturalWidth;
  work.height = cut.naturalHeight;
  const workCtx = work.getContext("2d", { willReadFrequently: true });
  if (!workCtx) throw new Error("이미지를 처리할 캔버스를 만들 수 없습니다.");
  workCtx.drawImage(cut, 0, 0);
  const pixels = workCtx.getImageData(0, 0, work.width, work.height);
  const bounds = opaqueBounds(pixels.data, work.width, work.height);
  if (!bounds) throw new Error("사진에서 상품을 찾지 못했습니다. 배경이 단순한 곳에서 다시 찍어주세요.");

  const gain = options.autoBrighten === false ? 1 : autoGain(pixels.data);

  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("결과 캔버스를 만들 수 없습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);
  const scale = (size * fill) / Math.max(bounds.width, bounds.height);
  const drawWidth = bounds.width * scale;
  const drawHeight = bounds.height * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (gain > 1.001) ctx.filter = `brightness(${gain.toFixed(3)})`;
  ctx.drawImage(
    work,
    bounds.x, bounds.y, bounds.width, bounds.height,
    (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight
  );
  ctx.filter = "none";

  return {
    squareDataUrl: out.toDataURL("image/jpeg", 0.95),
    transparentDataUrl,
    brightnessGain: Math.round(gain * 100) / 100,
  };
}
