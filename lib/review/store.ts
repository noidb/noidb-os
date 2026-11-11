import { promises as fs } from "node:fs";
import path from "node:path";
import { del, list, put } from "@vercel/blob";
import { getFreshPrivateBlob } from "@/lib/wms/fresh-blob-get";
import type { ReviewListItem, ReviewRecord } from "./types";

const ROOT = "noidb-wms/review/v1";
const LOCAL_DIR = path.join(process.cwd(), ".secrets", "review");

export const MODEL_PATTERN = /^[A-Za-z0-9_-]{2,40}$/;
export const REF_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;

function useBlob(): boolean {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

const recordPath = (model: string) => `${ROOT}/${model}/record.json`;
const imagePath = (model: string, ref: string) => `${ROOT}/${model}/img/${ref}`;

function imageType(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}

/** 올라온 사진 한 장 저장. 같은 사진(같은 이름표)은 덮어쓴다. */
export async function saveReviewImage(model: string, ref: string, bytes: Buffer): Promise<void> {
  const contentType = imageType(bytes);
  if (!contentType) throw new Error("사진 파일 형식(JPG·PNG·WEBP)이 아닙니다.");
  if (!useBlob()) {
    const dir = path.join(LOCAL_DIR, model, "img");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, ref), bytes);
    return;
  }
  await put(imagePath(model, ref), bytes, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType });
}

export async function readReviewImage(model: string, ref: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!useBlob()) {
    try {
      const bytes = await fs.readFile(path.join(LOCAL_DIR, model, "img", ref));
      return { bytes, contentType: imageType(bytes) || "image/jpeg" };
    } catch { return null; }
  }
  const result = await getFreshPrivateBlob(imagePath(model, ref));
  if (!result || result.statusCode !== 200) return null;
  const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
  return { bytes, contentType: imageType(bytes) || "image/jpeg" };
}

export async function saveReviewRecord(record: ReviewRecord): Promise<void> {
  const body = JSON.stringify(record);
  if (!useBlob()) {
    await fs.mkdir(path.join(LOCAL_DIR, record.model), { recursive: true });
    await fs.writeFile(path.join(LOCAL_DIR, record.model, "record.json"), body, "utf8");
    return;
  }
  await put(recordPath(record.model), body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
}

export async function readReviewRecord(model: string): Promise<ReviewRecord | null> {
  try {
    if (!useBlob()) return JSON.parse(await fs.readFile(path.join(LOCAL_DIR, model, "record.json"), "utf8")) as ReviewRecord;
    const result = await getFreshPrivateBlob(recordPath(model));
    if (!result || result.statusCode !== 200) return null;
    return JSON.parse(await new Response(result.stream).text()) as ReviewRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function listModels(): Promise<string[]> {
  if (!useBlob()) {
    try { return (await fs.readdir(LOCAL_DIR, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name); }
    catch { return []; }
  }
  const models: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${ROOT}/`, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const match = blob.pathname.slice(ROOT.length + 1).match(/^([^/]+)\/record\.json$/);
      if (match) models.push(match[1]);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return models;
}

export async function listReviewRecords(): Promise<ReviewRecord[]> {
  const models = await listModels();
  const records = await Promise.all(models.map(model => readReviewRecord(model).catch(() => null)));
  return records.filter((record): record is ReviewRecord => Boolean(record))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export function toListItem(record: ReviewRecord): ReviewListItem {
  return {
    model: record.model, submittedAt: record.submittedAt, status: record.status, memo: record.memo,
    reviewedAt: record.reviewedAt, summary: record.summary,
    failCount: record.checks.filter(check => check.level === "fail").length,
    warnCount: record.checks.filter(check => check.level === "warn").length,
  };
}

/** 검수 요청 하나(기록과 사진 전부)를 지운다. */
export async function deleteReviewRecord(model: string): Promise<void> {
  if (!useBlob()) {
    await fs.rm(path.join(LOCAL_DIR, model), { recursive: true, force: true });
    return;
  }
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${ROOT}/${model}/`, cursor, limit: 1000 });
    if (page.blobs.length) await del(page.blobs.map(blob => blob.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
