import { createHash, timingSafeEqual } from "node:crypto";
import { del, get, list, put, type ListBlobResultBlob } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT_PREFIX = "quick-detail-drafts/v1/";
const MANIFEST_NAME = "manifest.json";
const MAX_DRAFTS = 10;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;

type StoredManifest = {
  version: number;
  summary: JsonRecord & { id: string };
  draft: unknown;
  assetPathnames: string[];
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function blobConfigured() {
  // Client upload tokens are signed from this read-write token by handleUpload.
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

function authenticate(request: NextRequest) {
  const expected = process.env.QUICK_DRAFT_SYNC_CODE || "";
  const supplied = request.headers.get("x-quick-draft-code") || "";
  return Boolean(expected && supplied && safeEqual(supplied, expected));
}

function isSafeDraftId(id: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id);
}

function draftPrefix(id: string) {
  return `${ROOT_PREFIX}${id}/`;
}

function manifestPath(id: string) {
  return `${draftPrefix(id)}${MANIFEST_NAME}`;
}

function isSafeAssetPath(id: string, pathname: string) {
  const prefix = `${draftPrefix(id)}assets/`;
  if (!pathname.startsWith(prefix)) return false;
  const filename = pathname.slice(prefix.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(filename) && !filename.includes("..");
}

function readId(value: unknown) {
  const id = typeof value === "string" ? value : "";
  if (!isSafeDraftId(id)) throw new Error("올바르지 않은 임시저장 번호입니다.");
  return id;
}

function readAssetPathnames(id: string, value: unknown) {
  if (!Array.isArray(value)) throw new Error("이미지 파일 목록이 올바르지 않습니다.");
  const paths = [...new Set(value.map(item => String(item || "")))];
  if (paths.length > 300 || paths.some(pathname => !isSafeAssetPath(id, pathname))) {
    throw new Error("이미지 저장 경로가 올바르지 않습니다.");
  }
  return paths;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function normalizeManifest(id: string, value: unknown): StoredManifest {
  const raw = asRecord(value);
  const summary = asRecord(raw.summary);
  const assetPathnames = readAssetPathnames(id, raw.assetPathnames);
  return {
    version: 1,
    summary: { ...summary, id },
    draft: raw.draft ?? null,
    assetPathnames,
  };
}

async function listAll(prefix: string) {
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function readManifest(pathname: string): Promise<StoredManifest | null> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  const id = pathname.slice(ROOT_PREFIX.length, -(`/${MANIFEST_NAME}`.length));
  if (!isSafeDraftId(id)) return null;
  return normalizeManifest(id, JSON.parse(text));
}

async function listManifests() {
  const blobs = await listAll(ROOT_PREFIX);
  const manifestBlobs = blobs.filter(blob => blob.pathname.endsWith(`/${MANIFEST_NAME}`));
  const manifests = await Promise.all(manifestBlobs.map(async blob => {
    try {
      const manifest = await readManifest(blob.pathname);
      return manifest ? { manifest, uploadedAt: blob.uploadedAt } : null;
    } catch {
      return null;
    }
  }));
  return manifests.filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function savedTime(item: { manifest: StoredManifest; uploadedAt: Date }) {
  const value = item.manifest.summary.savedAt;
  const parsed = typeof value === "number" ? value : Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : item.uploadedAt.getTime();
}

async function deletePaths(pathnames: string[]) {
  for (let index = 0; index < pathnames.length; index += 100) {
    const batch = pathnames.slice(index, index + 100);
    if (batch.length) await del(batch);
  }
}

async function deleteDraft(id: string) {
  const blobs = await listAll(draftPrefix(id));
  await deletePaths(blobs.map(blob => blob.pathname));
  return blobs.length;
}

async function pruneOldDrafts() {
  const manifests = (await listManifests()).sort((a, b) => savedTime(b) - savedTime(a));
  for (const item of manifests.slice(MAX_DRAFTS)) {
    await deleteDraft(item.manifest.summary.id);
  }
  return manifests.slice(0, MAX_DRAFTS).map(item => item.manifest.summary);
}

function checkConfiguration(request: NextRequest) {
  if (!process.env.QUICK_DRAFT_SYNC_CODE || !blobConfigured()) {
    return jsonError("클라우드 임시저장이 아직 설정되지 않았습니다.", 503);
  }
  if (!authenticate(request)) return jsonError("클라우드 연동 코드가 맞지 않습니다.", 401);
  return null;
}

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /올바르지|저장 경로|파일 목록/.test(message) ? 400 : 500;
}

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") || "list";
    const configurationError = checkConfiguration(request);
    if (configurationError) return configurationError;

    if (action === "status") return NextResponse.json({ ok: true, configured: true });

    if (action === "list") {
      const manifests = (await listManifests()).sort((a, b) => savedTime(b) - savedTime(a));
      return NextResponse.json({
        ok: true,
        drafts: manifests.slice(0, MAX_DRAFTS).map(item => item.manifest.summary),
      });
    }

    const id = readId(request.nextUrl.searchParams.get("id"));
    if (action === "get") {
      const manifest = await readManifest(manifestPath(id));
      if (!manifest) return jsonError("임시저장 작업을 찾지 못했습니다.", 404);
      return NextResponse.json({ ok: true, manifest });
    }

    if (action === "asset") {
      const pathname = request.nextUrl.searchParams.get("path") || "";
      if (!isSafeAssetPath(id, pathname)) return jsonError("이미지 저장 경로가 올바르지 않습니다.", 400);
      const result = await get(pathname, { access: "private", useCache: false });
      if (!result || result.statusCode !== 200) return jsonError("저장된 이미지를 찾지 못했습니다.", 404);
      return new Response(result.stream, {
        status: 200,
        headers: {
          "Content-Type": result.blob.contentType || "application/octet-stream",
          "Content-Length": String(result.blob.size),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return jsonError("지원하지 않는 요청입니다.", 400);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "임시저장 정보를 불러오지 못했습니다.", errorStatus(error));
  }
}

export async function POST(request: NextRequest) {
  try {
    const configurationError = checkConfiguration(request);
    if (configurationError) return configurationError;
    const body = await request.json() as JsonRecord;
    const action = String(body.action || "");
    const id = readId(body.id);

    if (action === "prepare") {
      const assetPathnames = readAssetPathnames(id, body.assetPathnames);
      const existing = new Set((await listAll(draftPrefix(id))).map(blob => blob.pathname));
      return NextResponse.json({
        ok: true,
        missingPathnames: assetPathnames.filter(pathname => !existing.has(pathname)),
      });
    }

    if (action === "save") {
      const manifest = normalizeManifest(id, body.manifest);
      const existing = await listAll(draftPrefix(id));
      const existingPaths = new Set(existing.map(blob => blob.pathname));
      const missingPathnames = manifest.assetPathnames.filter(pathname => !existingPaths.has(pathname));
      if (missingPathnames.length) {
        return NextResponse.json({ ok: false, error: "아직 업로드되지 않은 이미지가 있습니다.", missingPathnames }, { status: 409 });
      }

      const serialized = JSON.stringify(manifest);
      if (Buffer.byteLength(serialized, "utf8") > MAX_MANIFEST_BYTES) {
        return jsonError("임시저장 정보가 너무 큽니다. 이미지가 작업정보에 직접 포함되지 않았는지 확인해주세요.", 413);
      }
      await put(manifestPath(id), serialized, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json; charset=utf-8",
        cacheControlMaxAge: 60,
      });

      const referenced = new Set([manifestPath(id), ...manifest.assetPathnames]);
      await deletePaths(existing.map(blob => blob.pathname).filter(pathname => !referenced.has(pathname)));
      const drafts = await pruneOldDrafts();
      return NextResponse.json({ ok: true, summary: manifest.summary, drafts });
    }

    return jsonError("지원하지 않는 저장 요청입니다.", 400);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "클라우드 임시저장에 실패했습니다.", errorStatus(error));
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const configurationError = checkConfiguration(request);
    if (configurationError) return configurationError;
    const id = readId(request.nextUrl.searchParams.get("id"));
    const deleted = await deleteDraft(id);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "임시저장 작업을 삭제하지 못했습니다.", errorStatus(error));
  }
}
