import { createHash, timingSafeEqual } from "node:crypto";
import { del } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT_PREFIX = "quick-detail-drafts/v1/";
const MAX_ASSET_BYTES = 20 * 1024 * 1024;

type ClientCredentials = { code: string; id: string };

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

function isSafeDraftId(id: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id);
}

function isSafeAssetPath(id: string, pathname: string) {
  const prefix = `${ROOT_PREFIX}${id}/assets/`;
  if (!pathname.startsWith(prefix)) return false;
  const filename = pathname.slice(prefix.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(filename) && !filename.includes("..");
}

function readClientCredentials(clientPayload: string | null, pathname: string, request: NextRequest): ClientCredentials {
  let payload: Record<string, unknown> = {};
  if (clientPayload) {
    try {
      const parsed = JSON.parse(clientPayload) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
      else payload = { code: clientPayload };
    } catch {
      payload = { code: clientPayload };
    }
  }
  const inferredId = pathname.startsWith(ROOT_PREFIX) ? pathname.slice(ROOT_PREFIX.length).split("/")[0] : "";
  return {
    code: String(payload.code || request.headers.get("x-quick-draft-code") || ""),
    id: String(payload.id || payload.draftId || inferredId),
  };
}

function authenticated(code: string) {
  const expected = process.env.QUICK_DRAFT_SYNC_CODE || "";
  return Boolean(expected && code && safeEqual(code, expected));
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.QUICK_DRAFT_SYNC_CODE || !process.env.BLOB_READ_WRITE_TOKEN) {
      return jsonError("클라우드 임시저장이 아직 설정되지 않았습니다.", 503);
    }
    const body = await request.json() as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const credentials = readClientCredentials(clientPayload, pathname, request);
        if (!authenticated(credentials.code)) throw new Error("클라우드 연동 코드가 맞지 않습니다.");
        if (!isSafeDraftId(credentials.id) || !isSafeAssetPath(credentials.id, pathname)) {
          throw new Error("이미지 저장 경로가 올바르지 않습니다.");
        }
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
          maximumSizeInBytes: MAX_ASSET_BYTES,
          validUntil: Date.now() + 10 * 60 * 1000,
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          tokenPayload: JSON.stringify({ id: credentials.id, pathname }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        try {
          const token = JSON.parse(tokenPayload || "{}") as { id?: string; pathname?: string };
          if (!token.id || !isSafeDraftId(token.id) || token.pathname !== blob.pathname || !isSafeAssetPath(token.id, blob.pathname)) {
            await del(blob.pathname);
          }
        } catch {
          await del(blob.pathname);
        }
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "이미지를 클라우드에 올리지 못했습니다.";
    const status = message.includes("연동 코드") ? 401 : message.includes("경로") ? 400 : 500;
    return jsonError(message, status);
  }
}
