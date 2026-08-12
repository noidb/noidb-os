export type QuickDetailStyle = "clean" | "ivory" | "modern";

export type QuickDetailSection = {
  id: string;
  dataUrl: string;
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
  const [source, header] = await Promise.all([loadImage(sourceUrl), loadImage(headerUrl)]);
  const expectedHeaderHeight = Math.round(source.naturalWidth * (header.naturalHeight / header.naturalWidth));
  const hasOldHeader = source.naturalHeight > source.naturalWidth * 2 && expectedHeaderHeight < source.naturalHeight * 0.25;
  const contentStart = hasOldHeader ? Math.min(expectedHeaderHeight, source.naturalHeight) : 0;
  const sections: QuickDetailSection[] = [];

  for (let y = contentStart, index = 0; y < source.naturalHeight; y += source.naturalWidth, index += 1) {
    const height = Math.min(source.naturalWidth, source.naturalHeight - y);
    // 끝에 남은 아주 짧은 조각은 불완전한 사진일 가능성이 높아 제외합니다.
    if (height < source.naturalWidth * 0.45) break;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("상세페이지 사진을 구분하지 못했습니다.");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const outputHeight = Math.round(1024 * (height / source.naturalWidth));
    ctx.drawImage(source, 0, y, source.naturalWidth, height, 0, Math.round((1024 - outputHeight) / 2), 1024, outputHeight);
    sections.push({ id: `quick-${index + 1}`, dataUrl: canvas.toDataURL("image/jpeg", 0.92) });
  }
  if (!sections.length) throw new Error("상세페이지 안에서 변형할 사진을 찾지 못했습니다.");
  return sections;
}

export async function composeQuickDetailPage(headerUrl: string, sections: QuickDetailSection[]): Promise<QuickDetailResult> {
  const [header, ...images] = await Promise.all([loadImage(headerUrl), ...sections.map(section => loadImage(section.dataUrl))]);
  const targetWidth = 780;
  const headerHeight = Math.round(header.naturalHeight * (targetWidth / header.naturalWidth));
  const sectionHeight = targetWidth;
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = headerHeight + images.length * sectionHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("새 상세페이지를 연결하지 못했습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(header, 0, 0, targetWidth, headerHeight);
  images.forEach((image, index) => ctx.drawImage(image, 0, headerHeight + index * sectionHeight, targetWidth, sectionHeight));
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.92),
    sectionCount: sections.length,
    width: targetWidth,
    height: canvas.height,
  };
}
