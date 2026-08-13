import type { ColorCode, GeneratedAsset, QualityCheck } from "./types";

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = src;
  });
}

function drawContained(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number, padding = 0) {
  const scale = Math.min((w - padding * 2) / image.naturalWidth, (h - padding * 2) / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export async function normalizeSquare(dataUrl: string) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 1000;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지 변환을 시작하지 못했습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 1000, 1000);
  drawContained(ctx, image, 100, 100, 800, 800);
  return canvas.toDataURL("image/jpeg", 0.94);
}

export async function composeAllColorCut(colorAssets: GeneratedAsset[], colors: ColorCode[], variant: number) {
  const selected = colors.map(color => colorAssets.find(asset => asset.color === color && asset.approved));
  if (selected.some(asset => !asset)) throw new Error("선택한 색상의 승인 이미지가 모두 필요합니다.");
  const images = await Promise.all(selected.map(asset => loadImage(asset!.dataUrl)));
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 1000;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("전 컬러 옵션컷을 만들지 못했습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 1000, 1000);

  if (images.length === 2) {
    if (variant === 1) {
      drawContained(ctx, images[0], 30, 90, 470, 820, 18);
      drawContained(ctx, images[1], 500, 90, 470, 820, 18);
    } else {
      drawContained(ctx, images[0], 120, 30, 760, 470, 40);
      drawContained(ctx, images[1], 120, 500, 760, 470, 40);
    }
  } else {
    if (variant === 1) {
      images.forEach((image, index) => drawContained(ctx, image, 18 + index * 326, 120, 310, 760, 16));
    } else {
      drawContained(ctx, images[0], 40, 40, 460, 460, 22);
      drawContained(ctx, images[1], 500, 40, 460, 460, 22);
      drawContained(ctx, images[2], 270, 500, 460, 460, 22);
    }
  }
  return canvas.toDataURL("image/jpeg", 0.94);
}

export async function composeDetailPage(headerDataUrl: string, assets: GeneratedAsset[]) {
  const images = await Promise.all([headerDataUrl, ...assets.map(asset => asset.dataUrl)].map(loadImage));
  const headerHeight = Math.round(images[0].naturalHeight * (780 / images[0].naturalWidth));
  const contentWidth = Math.round(780 * 0.8);
  const contentX = Math.round((780 - contentWidth) / 2);
  const heights = [headerHeight, ...images.slice(1).map(image => Math.round(image.naturalHeight * (contentWidth / image.naturalWidth)))];
  const canvas = document.createElement("canvas");
  canvas.width = 780;
  canvas.height = heights.reduce((sum, value) => sum + value, 0);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("상세페이지를 연결하지 못했습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  images.forEach((image, index) => {
    if (index === 0) ctx.drawImage(image, 0, y, 780, heights[index]);
    else ctx.drawImage(image, contentX, y, contentWidth, heights[index]);
    y += heights[index];
  });
  return canvas.toDataURL("image/jpeg", 0.91);
}

export async function basicQualityChecks(asset: GeneratedAsset): Promise<QualityCheck[]> {
  const image = await loadImage(asset.dataUrl);
  const checks: QualityCheck[] = [{
    key: "dimensions",
    label: "이미지 크기",
    status: image.naturalWidth === 1000 && image.naturalHeight === 1000 ? "pass" : "fail",
    message: `${image.naturalWidth}×${image.naturalHeight}px`,
  }];
  if (asset.kind === "color" || asset.kind === "all-colors") {
    const sample = document.createElement("canvas");
    sample.width = 100; sample.height = 100;
    const sampleContext = sample.getContext("2d");
    let whiteRatio = 0;
    if (sampleContext) {
      sampleContext.drawImage(image, 0, 0, 100, 100);
      const pixels = sampleContext.getImageData(0, 0, 100, 100).data;
      let white = 0; let total = 0;
      for (let y = 0; y < 100; y += 1) for (let x = 0; x < 100; x += 1) {
        if (x > 14 && x < 85 && y > 14 && y < 85) continue;
        const offset = (y * 100 + x) * 4; total += 1;
        if (pixels[offset] > 245 && pixels[offset + 1] > 245 && pixels[offset + 2] > 245) white += 1;
      }
      whiteRatio = total ? white / total : 0;
    }
    checks.push({ key: "white-background", label: "흰색 배경", status: whiteRatio >= 0.9 ? "pass" : "fail", message: whiteRatio >= 0.9 ? "가장자리 흰색 배경 확인" : "가장자리가 완전한 흰색이 아닙니다." });
  }
  const validFilename = /^[^\\/:*?"<>|]+-(RG|GO|SI|WEAR-\d{2}|ALL-\d{2}|DETAIL-\d{2})\.jpg$/i.test(asset.filename) || asset.kind === "baseline" || asset.kind === "model-template";
  checks.push({ key: "filename", label: "파일명", status: validFilename ? "pass" : "fail", message: validFilename ? asset.filename : "파일명 규칙을 확인해주세요." });
  checks.push({
    key: "visual-review",
    label: "제품 정확도",
    status: "review",
    message: asset.kind === "all-colors" ? "선택한 색상마다 한 쌍인지 확인해주세요." : "제품 모양·개수·글자 유무를 직접 확인해주세요.",
  });
  return checks;
}

export function dataUrlToBlob(dataUrl: string) {
  const [meta, encoded] = dataUrl.split(",");
  const mime = meta.match(/data:([^;]+)/)?.[1] || "image/jpeg";
  const bytes = atob(encoded);
  const array = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) array[index] = bytes.charCodeAt(index);
  return new Blob([array], { type: mime });
}
