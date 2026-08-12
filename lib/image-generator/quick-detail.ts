export type QuickDetailStyle = "clean" | "ivory" | "modern";

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

function styleValues(style: QuickDetailStyle) {
  if (style === "ivory") return { page: "#F5F0E8", card: "#FFFDFC", gap: 30, inset: 34 };
  if (style === "modern") return { page: "#ECEFF1", card: "#FFFFFF", gap: 24, inset: 28 };
  return { page: "#FFFFFF", card: "#FFFFFF", gap: 18, inset: 20 };
}

export async function rebuildDetailPage(
  sourceUrl: string,
  headerUrl: string,
  style: QuickDetailStyle,
): Promise<QuickDetailResult> {
  const [source, header] = await Promise.all([loadImage(sourceUrl), loadImage(headerUrl)]);
  const targetWidth = 780;
  const sourceScale = targetWidth / source.naturalWidth;

  // 기존 상세페이지에 같은 비율의 NOID-B 상단 이미지가 있으면 그 부분은 제외합니다.
  const expectedHeaderHeight = Math.round(source.naturalWidth * (header.naturalHeight / header.naturalWidth));
  const hasOldHeader = source.naturalHeight > source.naturalWidth * 2 && expectedHeaderHeight < source.naturalHeight * 0.25;
  const contentStart = hasOldHeader ? Math.min(expectedHeaderHeight, source.naturalHeight) : 0;
  const sections: Array<{ y: number; height: number }> = [];
  for (let y = contentStart; y < source.naturalHeight; y += source.naturalWidth) {
    sections.push({ y, height: Math.min(source.naturalWidth, source.naturalHeight - y) });
  }
  if (!sections.length) sections.push({ y: 0, height: source.naturalHeight });

  const values = styleValues(style);
  const headerHeight = Math.round(header.naturalHeight * (targetWidth / header.naturalWidth));
  const sectionHeights = sections.map((section, index) => {
    const base = Math.round(section.height * sourceScale);
    return index % 3 === 1 ? Math.round(base * 0.94) : base;
  });
  const totalHeight = headerHeight + values.gap + sectionHeights.reduce((sum, height) => sum + height + values.gap, 0);
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("새 상세페이지를 만들지 못했습니다.");
  ctx.fillStyle = values.page;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(header, 0, 0, targetWidth, headerHeight);

  let outputY = headerHeight + values.gap;
  sections.forEach((section, index) => {
    const cardInset = index % 3 === 1 ? values.inset : index % 3 === 2 ? Math.round(values.inset / 2) : 0;
    const cardX = cardInset;
    const cardWidth = targetWidth - cardInset * 2;
    const cardHeight = sectionHeights[index];
    ctx.fillStyle = values.card;
    ctx.fillRect(cardX, outputY, cardWidth, cardHeight);

    const sourceRatio = source.naturalWidth / section.height;
    const targetRatio = cardWidth / cardHeight;
    let sx = 0;
    let sy = section.y;
    let sw = source.naturalWidth;
    let sh = section.height;
    if (sourceRatio > targetRatio) {
      sw = sh * targetRatio;
      sx = (source.naturalWidth - sw) / 2;
    } else if (sourceRatio < targetRatio) {
      sh = sw / targetRatio;
      sy = section.y + (section.height - sh) / 2;
    }
    ctx.drawImage(source, sx, sy, sw, sh, cardX, outputY, cardWidth, cardHeight);
    outputY += cardHeight + values.gap;
  });

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.91),
    sectionCount: sections.length,
    width: targetWidth,
    height: canvas.height,
  };
}
