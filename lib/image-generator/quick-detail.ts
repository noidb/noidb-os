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
  const imageGap = 30;
  const headerHeight = Math.round(header.naturalHeight * (targetWidth / header.naturalWidth));
  const footerHeight = footer ? Math.round(footer.naturalHeight * (targetWidth / footer.naturalWidth)) : 0;
  const sectionHeight = targetWidth;
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  // 로고 아래, 사진 사이, 마지막 사진 아래까지 모두 30px 여백을 둡니다.
  const gapCount = images.length + 1 + (footer ? 1 : 0);
  canvas.height = headerHeight + images.length * sectionHeight + gapCount * imageGap + footerHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("새 상세페이지를 연결하지 못했습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(header, 0, 0, targetWidth, headerHeight);
  images.forEach((image, index) => {
    const y = headerHeight + imageGap + index * (sectionHeight + imageGap);
    ctx.drawImage(image, 0, y, targetWidth, sectionHeight);
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
