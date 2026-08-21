import type { GeneratorSession, PhotoRole } from "./types";

const ROLE_FOLDER: Record<PhotoRole, string> = {
  front: "정면", back: "뒷면", side: "측면", clasp: "잠금장치", pair: "한쌍전체",
  "wear-reference": "착용참고", "size-reference": "크기참고", "detail-reference": "상세참고", other: "기타",
};

function safeName(value: string) { return value.replace(/[\\/:*?"<>|]/g, "-"); }

async function upload(folders: string[], filename: string, input: { dataUrl?: string; text?: string; mimeType?: string }) {
  const response = await fetch("/api/image-generator/drive-save", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folders, filename, ...input }),
  });
  const result = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
  if (!response.ok || !result.success) throw new Error(result.error || "Google Drive에 저장하지 못했습니다.");
}

export async function saveGeneratorResultsToDrive(session: GeneratorSession, onProgress?: (done: number, total: number) => void) {
  const category = session.product.category.trim();
  const model = session.product.model.trim();
  if (!category || !model) throw new Error("카테고리와 모델명을 입력해주세요.");
  if (!session.detailPage) throw new Error("상세페이지를 먼저 만들어주세요.");
  const approved = session.assets.filter(item => item.approved && item.kind !== "baseline" && item.kind !== "model-template");
  const total = session.photos.length + approved.length + 2;
  const saved: string[] = [];
  let done = 0;
  for (const [index, photo] of session.photos.entries()) {
    const filename = `${String(index + 1).padStart(2, "0")}-${safeName(photo.name) || "photo.jpg"}`;
    const folders = [category, model, "원본", ROLE_FOLDER[photo.role]];
    await upload(folders, filename, { dataUrl: photo.dataUrl });
    saved.push(`${folders.join("/")}/${filename}`); onProgress?.(++done, total);
  }
  for (const asset of approved) {
    const folder = asset.kind === "color" ? "SKU썸네일" : "추가이미지";
    await upload([category, model, folder], asset.filename, { dataUrl: asset.dataUrl });
    saved.push(`${category}/${model}/${folder}/${asset.filename}`); onProgress?.(++done, total);
  }
  await upload([category, model, "상세페이지"], `${safeName(model)}.jpg`, { dataUrl: session.detailPage });
  saved.push(`${category}/${model}/상세페이지/${safeName(model)}.jpg`); onProgress?.(++done, total);
  const info = { 모델명: model, 카테고리: category, 실제촬영색상: session.product.photographedColor, 생성색상: session.product.colors, 대표착용색상: session.product.wearColor, 제품크기: { 가로mm: session.product.widthMm, 세로mm: session.product.heightMm, 두께mm: session.product.thicknessMm }, 사용한원본사진: session.photos.map(photo => ({ 파일명: photo.name, 역할: ROLE_FOLDER[photo.role] })), 생성된파일: saved, 이미지생성상태: "Google Drive 저장완료", 사용자승인여부: true, 생성일시: new Date().toISOString(), 재생성횟수: session.assets.reduce((sum, asset) => sum + asset.regenerationCount, 0) };
  await upload([category, model], "생성정보.json", { text: JSON.stringify(info, null, 2), mimeType: "application/json" });
  saved.push(`${category}/${model}/생성정보.json`); onProgress?.(++done, total);
  return saved;
}
