"use client";

import { saveProductDraft } from "@/lib/drafts/idb";
import { IMAGE_MARK, type ReviewListItem, type ReviewRecord, type ReviewSummary, type ReviewImageInfo } from "./types";

/** 한 장당 서버로 보낼 수 있는 크기(요청 한 번이 4.5MB 이하여야 함). 넘으면 화질을 낮춰 줄인다. */
const MAX_DATA_URL = 3_000_000;
const MAX_UNIQUE_IMAGES = 120;
const UPLOAD_PARALLEL = 3;

const isImageData = (value: unknown): value is string => typeof value === "string" && value.startsWith("data:image/") && value.length > 500;

function walk(value: unknown, visit: (text: string) => void) {
  if (typeof value === "string") { visit(value); return; }
  if (Array.isArray(value)) { value.forEach(item => walk(item, visit)); return; }
  if (value && typeof value === "object") Object.values(value).forEach(item => walk(item, visit));
}

function mapStrings(value: unknown, convert: (text: string) => string): unknown {
  if (typeof value === "string") return convert(value);
  if (Array.isArray(value)) return value.map(item => mapStrings(item, convert));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, convert)]));
  return value;
}

async function hashRef(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let binary = "";
  new Uint8Array(digest).slice(0, 18).forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
    image.src = dataUrl;
  });
}

async function prepareImage(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const image = await loadImage(dataUrl);
  const width = image.naturalWidth, height = image.naturalHeight;
  if (dataUrl.length <= MAX_DATA_URL) return { dataUrl, width, height };
  // 너무 큰 사진은 JPG로 다시 저장해 크기를 줄인다(투명한 부분은 흰색).
  let scale = 1;
  for (let attempt = 0; attempt < 12; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("사진을 줄이지 못했습니다.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", 0.88);
    if (out.length <= MAX_DATA_URL) return { dataUrl: out, width: canvas.width, height: canvas.height };
    scale *= 0.85;
  }
  throw new Error("사진이 너무 커서 줄이지 못했습니다.");
}

async function postJson(body: unknown): Promise<Record<string, any>> {
  const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || "서버에 저장하지 못했습니다.");
  return data;
}

export type LabeledImage = { group: "thumbs" | "slots" | "details"; label: string; dataUrl?: string | null };

export type SubmitReviewArgs = {
  model: string;
  summary: ReviewSummary;
  payload: unknown;
  labeled: LabeledImage[];
  detailPreview: string;
  /** 임시저장 내용 전체(사진 포함). 서버에는 사진을 뺀 내용과 사진 파일을 따로 올린다. */
  data: unknown;
  onProgress?: (text: string) => void;
};

/** 검수 요청: 사진을 서버에 올린 뒤 입력 내용을 보낸다. 서버가 빠진 칸·사진을 자동으로 검사한다. */
export async function submitReview(args: SubmitReviewArgs): Promise<ReviewListItem> {
  const unique = new Set<string>();
  const collect = (text: string) => { if (isImageData(text)) unique.add(text); };
  walk(args.data, collect);
  args.labeled.forEach(item => collect(item.dataUrl || ""));
  collect(args.detailPreview);
  const all = [...unique];
  if (all.length > MAX_UNIQUE_IMAGES) throw new Error(`사진이 ${all.length}장이라 너무 많습니다(최대 ${MAX_UNIQUE_IMAGES}장). 업로드 풀의 안 쓰는 사진을 지운 뒤 다시 눌러주세요.`);

  const refs = new Map<string, string>();
  const images: Record<string, ReviewImageInfo> = {};
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < all.length) {
      const text = all[next++];
      const ref = await hashRef(text);
      const prepared = await prepareImage(text);
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await postJson({ action: "image", model: args.model, ref, dataUrl: prepared.dataUrl }); lastError = null; break; }
        catch (error) { lastError = error; }
      }
      if (lastError) throw lastError;
      refs.set(text, ref);
      images[ref] = { width: prepared.width, height: prepared.height, bytes: Math.round(prepared.dataUrl.length * 0.75) };
      done += 1;
      args.onProgress?.(`사진 올리는 중 ${done}/${all.length}`);
    }
  };
  args.onProgress?.(`사진 올리는 중 0/${all.length}`);
  await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL, all.length) }, worker));

  const refOf = (text?: string | null) => (text && refs.get(text)) || "";
  const pick = (group: LabeledImage["group"]) => args.labeled.filter(item => item.group === group).map(item => ({ label: item.label, ref: refOf(item.dataUrl) }));
  const data = mapStrings(args.data, text => (isImageData(text) && refs.has(text) ? `${IMAGE_MARK}${refs.get(text)}` : text));
  args.onProgress?.("입력 내용을 보내고 검사하는 중...");
  const result = await postJson({
    action: "submit", model: args.model,
    record: {
      model: args.model, summary: args.summary, payload: args.payload,
      thumbs: pick("thumbs"), slots: pick("slots"), details: pick("details"),
      detailPreviewRef: refOf(args.detailPreview), images, data,
    },
  });
  return result.item as ReviewListItem;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

/** 검수 요청 내용을 이 컴퓨터로 내려받아 임시저장 목록에 넣는다(사진 포함). 메인 화면에서 바로 이어서 작업할 수 있다. */
export async function openReviewOnThisComputer(record: ReviewRecord, onProgress?: (text: string) => void): Promise<void> {
  const refs = new Set<string>();
  walk(record.data, text => { if (text.startsWith(IMAGE_MARK)) refs.add(text.slice(IMAGE_MARK.length)); });
  const urls = new Map<string, string>();
  const list = [...refs];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < list.length) {
      const ref = list[next++];
      const response = await fetch(`/api/review?image=${encodeURIComponent(`${record.model}/${ref}`)}`);
      if (!response.ok) throw new Error("서버에서 사진을 가져오지 못했습니다.");
      urls.set(ref, await blobToDataUrl(await response.blob()));
      done += 1;
      onProgress?.(`사진 내려받는 중 ${done}/${list.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL, list.length) }, worker));
  const data = mapStrings(record.data, text => (text.startsWith(IMAGE_MARK) ? urls.get(text.slice(IMAGE_MARK.length)) || "" : text));
  await saveProductDraft({ model: record.model, savedAt: Date.now(), data });
}
