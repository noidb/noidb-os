export type QuickDetailStyle = "clean" | "ivory" | "modern";

export type QuickDetailSection = {
  id: string;
  dataUrl: string;
  kind?: "product" | "wear";
  reason?: string;
};

export type QuickDetailResult = {
  dataUrl: string;
  sectionCount: number;
  width: number;
  height: number;
};

type CropRect = { x: number; y: number; size: number };

function findSquareContentCrop(image: HTMLImageElement): CropRect {
  const sampleSize = Math.min(320, image.naturalWidth, image.naturalHeight);
  const sample = document.createElement("canvas");
  const scale = sampleSize / Math.max(image.naturalWidth, image.naturalHeight);
  sample.width = Math.max(1, Math.round(image.naturalWidth * scale));
  sample.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, size: Math.min(image.naturalWidth, image.naturalHeight) };
  ctx.drawImage(image, 0, 0, sample.width, sample.height);
  const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
  const cornerPoints = [[0, 0], [sample.width - 1, 0], [0, sample.height - 1], [sample.width - 1, sample.height - 1]];
  const background = cornerPoints.reduce((sum, [x, y]) => {
    const offset = (y * sample.width + x) * 4;
    return [sum[0] + pixels[offset], sum[1] + pixels[offset + 1], sum[2] + pixels[offset + 2]];
  }, [0, 0, 0]).map(value => value / cornerPoints.length);
  let minX = sample.width;
  let minY = sample.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < sample.height; y += 1) {
    for (let x = 0; x < sample.width; x += 1) {
      const offset = (y * sample.width + x) * 4;
      const difference = Math.abs(pixels[offset] - background[0]) + Math.abs(pixels[offset + 1] - background[1]) + Math.abs(pixels[offset + 2] - background[2]);
      if (difference < 18) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, size: Math.min(image.naturalWidth, image.naturalHeight) };
  const padding = Math.max(2, Math.round(Math.max(maxX - minX, maxY - minY) * 0.035));
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(sample.width - 1, maxX + padding);
  maxY = Math.min(sample.height - 1, maxY + padding);
  const desiredSize = Math.max(maxX - minX + 1, maxY - minY + 1);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const squareSize = Math.min(desiredSize, sample.width, sample.height);
  const sampleX = Math.max(0, Math.min(sample.width - squareSize, centerX - squareSize / 2));
  const sampleY = Math.max(0, Math.min(sample.height - squareSize, centerY - squareSize / 2));
  return {
    x: Math.round(sampleX / scale),
    y: Math.round(sampleY / scale),
    size: Math.min(Math.round(squareSize / scale), image.naturalWidth, image.naturalHeight),
  };
}

function drawFullSquare(ctx: CanvasRenderingContext2D, image: HTMLImageElement, size: number, x = 0, y = 0) {
  const crop = findSquareContentCrop(image);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // 확대 비율이 큰 저해상도 사진은 단계별로 키워 계단 현상과 뭉개짐을 줄입니다.
  let source: CanvasImageSource = image;
  let sourceX = crop.x;
  let sourceY = crop.y;
  let sourceSize = crop.size;
  if (crop.size < size * 0.9) {
    const cropped = document.createElement("canvas");
    cropped.width = crop.size;
    cropped.height = crop.size;
    const croppedContext = cropped.getContext("2d");
    if (croppedContext) {
      croppedContext.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, crop.size, crop.size);
      source = cropped;
      sourceX = 0;
      sourceY = 0;
      while (sourceSize < size) {
        const nextSize = Math.min(size, sourceSize * 2);
        const next = document.createElement("canvas");
        next.width = nextSize;
        next.height = nextSize;
        const nextContext = next.getContext("2d");
        if (!nextContext) break;
        nextContext.imageSmoothingEnabled = true;
        nextContext.imageSmoothingQuality = "high";
        nextContext.drawImage(source, sourceX, sourceY, sourceSize, sourceSize, 0, 0, nextSize, nextSize);
        source = next;
        sourceX = 0;
        sourceY = 0;
        sourceSize = nextSize;
      }
      // 약한 대비·선명도 보정만 적용해 제품 무늬를 새로 만들지 않습니다.
      ctx.filter = "contrast(1.025) saturate(1.015)";
    }
  }
  ctx.drawImage(source, sourceX, sourceY, sourceSize, sourceSize, x, y, size, size);
  ctx.restore();
}

export async function resizeSectionTo1000(dataUrl: string) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 1000;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("개별 이미지를 1000px로 저장하지 못했습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 1000, 1000);
  drawFullSquare(ctx, image, 1000);
  return canvas.toDataURL("image/jpeg", 0.93);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("상세이미지를 불러오지 못했습니다."));
    image.src = src;
  });
}

export function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("상세이미지 파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

export async function splitDetailPage(sourceUrl: string, headerUrl: string): Promise<QuickDetailSection[]> {
  const source = await loadImage(sourceUrl);
  void headerUrl;
  const sections: QuickDetailSection[] = [];
  const scanCanvas = document.createElement("canvas");
  const scanWidth = Math.min(240, source.naturalWidth);
  const scanScale = scanWidth / source.naturalWidth;
  scanCanvas.width = scanWidth;
  scanCanvas.height = Math.max(1, Math.round(source.naturalHeight * scanScale));
  const scan = scanCanvas.getContext("2d", { willReadFrequently: true });
  if (!scan) throw new Error("상세페이지의 사진 경계를 찾지 못했습니다.");
  scan.drawImage(source, 0, 0, scanCanvas.width, scanCanvas.height);
  const pixels = scan.getImageData(0, 0, scanCanvas.width, scanCanvas.height).data;
  const whiteRows: boolean[] = [];
  for (let y = 0; y < scanCanvas.height; y += 1) {
    let white = 0;
    for (let x = 0; x < scanCanvas.width; x += 2) {
      const offset = (y * scanCanvas.width + x) * 4;
      if (pixels[offset] > 246 && pixels[offset + 1] > 246 && pixels[offset + 2] > 246) white += 1;
    }
    whiteRows.push(white / Math.ceil(scanCanvas.width / 2) > 0.97);
  }

  const minWhiteBand = Math.max(3, Math.round(scanWidth * 0.012));
  const minSection = Math.round(scanWidth * 0.42);
  const boundaries = [0];
  for (let start = 0; start < whiteRows.length;) {
    if (!whiteRows[start]) { start += 1; continue; }
    let end = start + 1;
    while (end < whiteRows.length && whiteRows[end]) end += 1;
    if (end - start >= minWhiteBand) {
      const middle = Math.round((start + end) / 2);
      if (middle - boundaries[boundaries.length - 1] >= minSection) boundaries.push(middle);
    }
    start = end;
  }
  if (scanCanvas.height - boundaries[boundaries.length - 1] >= minSection) boundaries.push(scanCanvas.height);

  // 흰 여백 경계가 거의 없는 상세페이지는 기존의 가로 길이 단위로 안전하게 나눕니다.
  if (boundaries.length < 4) {
    boundaries.length = 0;
    for (let y = 0; y < source.naturalHeight; y += source.naturalWidth) boundaries.push(Math.round(y * scanScale));
    boundaries.push(scanCanvas.height);
  }

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const sourceY = Math.round(boundaries[index] / scanScale);
    const sourceEnd = Math.min(source.naturalHeight, Math.round(boundaries[index + 1] / scanScale));
    const height = sourceEnd - sourceY;
    if (height < source.naturalWidth * 0.25) continue;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("상세페이지 사진을 구분하지 못했습니다.");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(1024 / source.naturalWidth, 1024 / height);
    const outputWidth = Math.round(source.naturalWidth * scale);
    const outputHeight = Math.round(height * scale);
    ctx.drawImage(source, 0, sourceY, source.naturalWidth, height, Math.round((1024 - outputWidth) / 2), Math.round((1024 - outputHeight) / 2), outputWidth, outputHeight);
    sections.push({ id: `quick-${index + 1}`, dataUrl: canvas.toDataURL("image/jpeg", 0.92) });
  }
  if (!sections.length) throw new Error("상세페이지 안에서 변형할 사진을 찾지 못했습니다.");
  return sections;
}

export async function composeQuickDetailPage(headerUrl: string, sections: QuickDetailSection[], footerUrl?: string): Promise<QuickDetailResult> {
  const loaded = await Promise.all([loadImage(headerUrl), ...sections.map(section => loadImage(section.dataUrl)), ...(footerUrl ? [loadImage(footerUrl)] : [])]);
  const header = loaded[0];
  const images = loaded.slice(1, 1 + sections.length);
  const footer = footerUrl ? loaded[loaded.length - 1] : undefined;
  const targetWidth = 780;
  const imageGap = 90;
  const headerHeight = Math.round(header.naturalHeight * (targetWidth / header.naturalWidth));
  const footerHeight = footer ? Math.round(footer.naturalHeight * (targetWidth / footer.naturalWidth)) : 0;
  const sectionHeight = targetWidth;
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  // 로고 아래, 사진 사이, 마지막 사진 아래까지 모두 90px 여백을 둡니다.
  const gapCount = images.length + 1 + (footer ? 1 : 0);
  canvas.height = headerHeight + images.length * sectionHeight + gapCount * imageGap + footerHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("새 상세페이지를 연결하지 못했습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(header, 0, 0, targetWidth, headerHeight);
  images.forEach((image, index) => {
    const y = headerHeight + imageGap + index * (sectionHeight + imageGap);
    drawFullSquare(ctx, image, targetWidth, 0, y);
  });
  if (footer) {
    const footerY = headerHeight + images.length * sectionHeight + (images.length + 1) * imageGap;
    ctx.drawImage(footer, 0, footerY, targetWidth, footerHeight);
  }
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.92),
    sectionCount: sections.length,
    width: targetWidth,
    height: canvas.height,
  };
}
