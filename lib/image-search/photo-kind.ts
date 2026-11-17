export type PhotoKind = "detail" | "edited-1000" | "edited" | "editing-original" | "unspecified";

export type PhotoIdentity = {
  kind: PhotoKind;
  label: string;
  folder: string;
  width: number;
  height: number;
  duplicateName: string;
};

function jpegDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) { at += 1; continue; }
    while (bytes[at] === 0xff) at += 1;
    const marker = bytes[at++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = (bytes[at] << 8) | bytes[at + 1];
    if (length < 2 || at + length > bytes.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return [(bytes[at + 5] << 8) | bytes[at + 6], (bytes[at + 3] << 8) | bytes[at + 4]];
    }
    at += length;
  }
  return null;
}

async function dimensions(file: File): Promise<[number, number]> {
  const bytes = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes.length >= 24) {
    const view = new DataView(bytes.buffer);
    return [view.getUint32(16), view.getUint32(20)];
  }
  return jpegDimensions(bytes) || [0, 0];
}

export async function identifyPhoto(id: string, file: File): Promise<PhotoIdentity> {
  const normalized = id.replace(/\\/g, "/").toLowerCase();
  const folder = id.split("/").slice(-2, -1)[0] || "";
  const [width, height] = await dimensions(file).catch(() => [0, 0]);
  const detail = /상세|detail/i.test(id) || (width > 0 && height >= 1200 && height / width >= 3);
  // 1000 폴더: 보정원본을 1000×1000으로 편집해 둔 사진. 상세페이지 다음으로 우선한다.
  const in1000Folder = /(^|\/)1000(x1000|px)?\//.test(normalized);
  const evoto = normalized.includes("evoto");
  const kind: PhotoKind = detail ? "detail"
    : in1000Folder ? "edited-1000"
    : normalized.includes("/보정/보정원본/") ? "editing-original"
    : normalized.includes("/보정/") || evoto ? "edited"
    : "unspecified";
  const label = kind === "detail" ? "기존 상세페이지 후보"
    : kind === "edited-1000" ? "1000 폴더 편집본"
    : kind === "edited" ? "보정본 폴더"
    : kind === "editing-original" ? "보정 전 원본 폴더"
    : "일반 폴더 · 보정 여부 미확인";
  const duplicateName = file.name.toLowerCase().replace(/[_ ]?\(\d+\)(?=\.[^.]+$)/i, "");
  return { kind, label, folder, width, height, duplicateName };
}

export function photoPriority(kind: PhotoKind): number {
  return kind === "detail" ? 0 : kind === "edited-1000" ? 1 : kind === "edited" ? 2 : kind === "unspecified" ? 3 : 4;
}

/**
 * 2026-11-17 사진 경로(id)에서 '모델명 폴더'(예: .../큐빅 묶음 폴더/we00486/보정원본/2.jpg 의 we00486)를 찾는다.
 * 폴더 이름이 모델명 그대로이거나 "we00486 귀걸이"처럼 모델명 뒤에 글자·숫자가 붙지 않고 이어지면 모델명 폴더로 본다.
 * 여러 모델이 한 폴더 이름에 들어 있는 묶음 폴더("… wn00486 we00486 ws00486")는 모델명 폴더가 아니다.
 * 찾으면 그 폴더의 경로(folderId)와 그 아래 하위 폴더 이름들(relative)을 돌려준다. 없으면 null.
 */
export function modelFolderOf(id: string, modelName: string): { folderId: string; relative: string[] } | null {
  const key = modelName.trim().toLowerCase();
  if (!key) return null;
  const folders = id.replace(/\\/g, "/").split("/").slice(0, -1);
  // 하위 폴더 이름에 같은 모델명이 또 있어도 가장 위쪽(바깥) 모델명 폴더를 기준으로 삼는다.
  const at = folders.findIndex((name, index) => index > 0 && name.toLowerCase().startsWith(key) && !/[a-z0-9]/.test(name.toLowerCase()[key.length] || ""));
  if (at < 0) return null;
  return { folderId: folders.slice(0, at + 1).join("/"), relative: folders.slice(at + 1) };
}

/** 화면 묶음: 바로 보여줄 사진(상세페이지·1000 폴더 편집본) / 보정본 폴더 / 원본 폴더(폴더 바깥 사진 포함). */
export type PhotoTier = "primary" | "edited" | "original";
export function photoTier(kind: PhotoKind): PhotoTier {
  return kind === "detail" || kind === "edited-1000" ? "primary" : kind === "edited" ? "edited" : "original";
}
