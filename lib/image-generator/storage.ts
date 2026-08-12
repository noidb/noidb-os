import { dataUrlToBlob } from "./canvas";
import type { GeneratorSession, PhotoRole } from "./types";

const ROLE_FOLDER: Record<PhotoRole, string> = {
  front: "정면", back: "뒷면", side: "측면", clasp: "잠금장치", pair: "한쌍전체",
  "wear-reference": "착용참고", "size-reference": "크기참고", "detail-reference": "상세참고", other: "기타",
};

async function dir(parent: FileSystemDirectoryHandle, name: string) {
  return parent.getDirectoryHandle(name, { create: true });
}

async function write(parent: FileSystemDirectoryHandle, filename: string, body: Blob | string) {
  const handle = await parent.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(body);
  await writable.close();
}

function extension(name: string) {
  const found = name.match(/\.[a-zA-Z0-9]+$/);
  return found?.[0] || ".jpg";
}

export async function saveGeneratorResults(root: FileSystemDirectoryHandle, session: GeneratorSession) {
  const category = session.product.category.trim();
  const model = session.product.model.trim();
  if (!category || !model) throw new Error("카테고리와 모델명을 입력해주세요.");
  const modelDir = await dir(await dir(root, category), model);
  const originals = await dir(modelDir, "원본");
  const thumbnails = await dir(modelDir, "SKU썸네일");
  const extras = await dir(modelDir, "추가이미지");
  const details = await dir(modelDir, "상세페이지");
  const saved: string[] = [];

  for (const [index, photo] of session.photos.entries()) {
    const roleDir = await dir(originals, ROLE_FOLDER[photo.role]);
    const filename = `${String(index + 1).padStart(2, "0")}-${photo.name.replace(/[\\/:*?"<>|]/g, "-") || `photo${extension(photo.name)}`}`;
    await write(roleDir, filename, dataUrlToBlob(photo.dataUrl));
    saved.push(`${category}/${model}/원본/${ROLE_FOLDER[photo.role]}/${filename}`);
  }

  for (const asset of session.assets.filter(item => item.approved)) {
    if (asset.kind === "baseline" || asset.kind === "model-template") continue;
    const target = asset.kind === "color" ? thumbnails : extras;
    await write(target, asset.filename, dataUrlToBlob(asset.dataUrl));
    saved.push(`${category}/${model}/${asset.kind === "color" ? "SKU썸네일" : "추가이미지"}/${asset.filename}`);
  }
  if (!session.detailPage) throw new Error("상세페이지를 먼저 만들어주세요.");
  await write(details, `${model}.jpg`, dataUrlToBlob(session.detailPage));
  saved.push(`${category}/${model}/상세페이지/${model}.jpg`);

  const info = {
    모델명: model, 카테고리: category, 실제촬영색상: session.product.photographedColor,
    생성색상: session.product.colors, 대표착용색상: session.product.wearColor,
    제품크기: { 가로mm: session.product.widthMm, 세로mm: session.product.heightMm, 두께mm: session.product.thicknessMm },
    사용한원본사진: session.photos.map(photo => ({ 파일명: photo.name, 역할: ROLE_FOLDER[photo.role] })),
    생성된파일: saved, 이미지생성상태: "저장완료", 사용자승인여부: true,
    생성일시: new Date().toISOString(), 재생성횟수: session.assets.reduce((sum, asset) => sum + asset.regenerationCount, 0),
  };
  await write(modelDir, "생성정보.json", JSON.stringify(info, null, 2));
  saved.push(`${category}/${model}/생성정보.json`);
  return saved;
}
