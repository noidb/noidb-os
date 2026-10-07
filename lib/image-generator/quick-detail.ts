import { extendToSquareCanvas } from "@/lib/thumbnail/fit";

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

/** 저장·조합에 쓰는 개별 사진: 여백 없이 꽉 찬 1:1 (사진은 자르거나 늘리지 않고 남는 곳은 가장자리 색으로 채움). */
export async function resizeSectionTo1000(dataUrl: string) {
  return extendToSquareCanvas(dataUrl, 1000);
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
  const header = await loadImage(headerUrl);
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
  // 흰 바탕에 글자만 있는 줄(다른 업체 영문·설명 문구)은 대부분 흰색이다. 사진이 있는 줄은 그렇지 않다.
  const mostlyWhiteRows: boolean[] = [];
  for (let y = 0; y < scanCanvas.height; y += 1) {
    let white = 0;
    let nearWhite = 0;
    for (let x = 0; x < scanCanvas.width; x += 2) {
      const offset = (y * scanCanvas.width + x) * 4;
      if (pixels[offset] > 246 && pixels[offset + 1] > 246 && pixels[offset + 2] > 246) white += 1;
      if (pixels[offset] > 236 && pixels[offset + 1] > 236 && pixels[offset + 2] > 236) nearWhite += 1;
    }
    const samples = Math.ceil(scanCanvas.width / 2);
    whiteRows.push(white / samples > 0.97);
    mostlyWhiteRows.push(nearWhite / samples > 0.8);
  }
  // 사진 구간 = 흰 줄이 아닌 줄이 이만큼 이어지는 곳. 글자 한두 줄은 이보다 짧아서 사진으로 보지 않는다.
  const photoBand = Math.max(10, Math.round(scanWidth * 0.06));
  const bigPiece = Math.round(scanWidth * 0.25);
  /**
   * 한 구간을 사진 조각으로 정리한다. 흰 여백 위의 글자 줄(다른 업체 영문·문구)은 잘라내고,
   * 사진과 사진 사이에 글자 줄이 끼어 있으면 그 자리에서 나눈다. 사진 위에 얹힌 글자는 사진 줄 안에 있어 그대로 남는다.
   */
  function photoPieces(start: number, end: number): Array<[number, number]> {
    const bands: Array<{ from: number; to: number; text: boolean }> = [];
    for (let y = start; y < end;) {
      if (mostlyWhiteRows[y]) { y += 1; continue; }
      let to = y + 1;
      while (to < end && !mostlyWhiteRows[to]) to += 1;
      bands.push({ from: y, to, text: to - y < photoBand });
      y = to;
    }
    const pieces: Array<[number, number]> = [];
    let current: [number, number] | null = null;
    let textSince = false;
    for (const band of bands) {
      if (band.text) { if (current) textSince = true; continue; }
      if (current && textSince && current[1] - current[0] >= bigPiece && band.to - band.from >= bigPiece) {
        pieces.push(current);
        current = null;
      }
      current = current ? [current[0], band.to] : [band.from, band.to];
      textSince = false;
    }
    if (current) pieces.push(current);
    // 사진 줄을 못 찾았거나 너무 많이 잘리면(흰 배경 제품컷 등) 원래 구간을 그대로 쓴다.
    const kept = pieces.reduce((sum, [a, b]) => sum + (b - a), 0);
    if (!pieces.length || kept < (end - start) * 0.4) return [[start, end]];
    return pieces;
  }

  const minWhiteBand = Math.max(3, Math.round(scanWidth * 0.012));
  const minSection = Math.round(scanWidth * 0.42);
  // Remove an already embedded copy of the selected header. This prevents the
  // small "SINCE 2017®" line at the bottom of the header from becoming its own
  // product section and being inserted twice in the rebuilt detail page.
  let contentStart = 0;
  const expectedHeaderHeight = Math.min(source.naturalHeight, Math.round(source.naturalWidth * (header.naturalHeight / header.naturalWidth)));
  if (expectedHeaderHeight > 0) {
    const compareWidth = 80;
    const compareHeight = Math.max(1, Math.round(compareWidth * (header.naturalHeight / header.naturalWidth)));
    const sourceSample = document.createElement("canvas");
    const headerSample = document.createElement("canvas");
    sourceSample.width = headerSample.width = compareWidth;
    sourceSample.height = headerSample.height = compareHeight;
    const sourceContext = sourceSample.getContext("2d", { willReadFrequently: true });
    const headerContext = headerSample.getContext("2d", { willReadFrequently: true });
    if (sourceContext && headerContext) {
      sourceContext.drawImage(source, 0, 0, source.naturalWidth, expectedHeaderHeight, 0, 0, compareWidth, compareHeight);
      headerContext.drawImage(header, 0, 0, compareWidth, compareHeight);
      const a = sourceContext.getImageData(0, 0, compareWidth, compareHeight).data;
      const b = headerContext.getImageData(0, 0, compareWidth, compareHeight).data;
      let difference = 0;
      for (let index = 0; index < a.length; index += 4) {
        difference += Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2]);
      }
      const meanDifference = difference / (compareWidth * compareHeight * 3);
      if (meanDifference < 28) contentStart = Math.round(expectedHeaderHeight * scanScale);
    }
  }
  const boundaries = [contentStart];
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
  // (사진이 2장 이상 나뉘면 그대로 쓴다 — 예전에는 3장 미만이면 가로 길이로 다시 잘라 사진 중간이 잘렸다.)
  if (boundaries.length < 3) {
    boundaries.length = 0;
    for (let y = contentStart / scanScale; y < source.naturalHeight; y += source.naturalWidth) boundaries.push(Math.round(y * scanScale));
    boundaries.push(scanCanvas.height);
  }

  /** 구간의 좌우 흰 여백(거의 흰 열)을 찾아 사진 폭만 남긴다. 너무 많이 잘리면(흰 배경 제품컷) 그대로 둔다. */
  function trimSides(top: number, bottom: number): [number, number] {
    const columnWhite = (x: number) => {
      let white = 0;
      let count = 0;
      for (let y = top; y < bottom; y += 2) {
        const offset = (y * scanCanvas.width + x) * 4;
        if (pixels[offset] > 236 && pixels[offset + 1] > 236 && pixels[offset + 2] > 236) white += 1;
        count += 1;
      }
      return count ? white / count > 0.97 : true;
    };
    let left = 0;
    while (left < scanCanvas.width && columnWhite(left)) left += 1;
    let right = scanCanvas.width;
    while (right > left && columnWhite(right - 1)) right -= 1;
    if (right - left < scanCanvas.width * 0.5) return [0, scanCanvas.width];
    return [left, right];
  }
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) ranges.push(...photoPieces(boundaries[index], boundaries[index + 1]));
  for (let index = 0; index < ranges.length; index += 1) {
    const [trimStart, trimEnd] = ranges[index];
    // 축소 검사(약 240px)의 경계 한 칸에는 흰 여백이 섞여 있을 수 있어 반 칸 안쪽에서 자른다 → 가장자리에 흰 선이 남지 않는다.
    const sourceY = trimStart > 0 ? Math.ceil((trimStart + 0.5) / scanScale) : 0;
    const sourceEnd = Math.min(source.naturalHeight, trimEnd < scanCanvas.height ? Math.floor((trimEnd - 0.5) / scanScale) : source.naturalHeight);
    const height = sourceEnd - sourceY;
    if (height < source.naturalWidth * 0.25) continue;
    // Keep the source section's aspect ratio and available pixels. Baking every
    // section into a 1024px square added side margins and softened product shots.
    // 사진이 상세페이지 폭보다 좁아 좌우에 흰 여백이 있으면 그 여백도 잘라낸다
    // (안 자르면 1000×1000과 780px 상세페이지에서 사진이 폭을 꽉 채우지 못한다).
    const [sideStart, sideEnd] = trimSides(trimStart, trimEnd);
    const sourceX = sideStart > 0 ? Math.ceil((sideStart + 0.5) / scanScale) : 0;
    const sourceW = (sideEnd < scanCanvas.width ? Math.floor((sideEnd - 0.5) / scanScale) : source.naturalWidth) - sourceX;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1560 / sourceW);
    canvas.width = Math.max(1, Math.round(sourceW * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("상세페이지 사진을 구분하지 못했습니다.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, sourceX, sourceY, sourceW, height, 0, 0, canvas.width, canvas.height);
    sections.push({ id: `quick-${index + 1}`, dataUrl: canvas.toDataURL("image/jpeg", 0.97) });
  }
  if (!sections.length) throw new Error("상세페이지 안에서 변형할 사진을 찾지 못했습니다.");
  return sections;
}

export async function composeQuickDetailPage(headerUrl: string, sections: QuickDetailSection[], footerUrl?: string): Promise<QuickDetailResult> {
  const targetWidth = 780;
  const squareUrls = await Promise.all(sections.map(section => extendToSquareCanvas(section.dataUrl, targetWidth)));
  const loaded = await Promise.all([loadImage(headerUrl), ...squareUrls.map(url => loadImage(url)), ...(footerUrl ? [loadImage(footerUrl)] : [])]);
  const header = loaded[0];
  const images = loaded.slice(1, 1 + sections.length);
  const footer = footerUrl ? loaded[loaded.length - 1] : undefined;
  const imageGap = 90;
  const headerHeight = Math.round(header.naturalHeight * (targetWidth / header.naturalWidth));
  const footerHeight = footer ? Math.round(footer.naturalHeight * (targetWidth / footer.naturalWidth)) : 0;
  const sectionHeight = targetWidth;
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  // 로고 아래, 사진 사이, 마지막 사진 아래까지 모두 90px 여백을 둡니다. 사진은 가로 폭을 꽉 채웁니다.
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
