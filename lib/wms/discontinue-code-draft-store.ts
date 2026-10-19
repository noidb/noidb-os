import { promises as fs } from "node:fs";
import path from "node:path";
import { get, put } from "@vercel/blob";

/**
 * "바코드·SKU로 단종서류 만들기" 입력칸 누적 저장소 (2026-10-19 사용자 요청).
 *
 * 단종할 바코드·SKU가 생길 때마다 입력칸에 붙여넣어 두고, 모이면 한 번에 단종서류를 만든다.
 * 회사 PC·집 PC·모바일 어디서 넣어도 같은 목록이 이어지도록 서버에 입력 내용을 그대로 저장한다.
 * 화면 입력 초안이라 마지막 저장이 이기는 단순 덮어쓰기로 충분하다.
 */

const BLOB_PATH = "noidb-wms/discontinue-code-draft/v1/draft.json";
const LOCAL_PATH = path.join(process.cwd(), ".secrets", "discontinue-code-draft.json");

export interface DiscontinueCodeDraft { text: string; savedAt: string }

function useBlobStore(): boolean {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

function normalize(value: unknown): DiscontinueCodeDraft {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<DiscontinueCodeDraft>;
  return { text: typeof raw.text === "string" ? raw.text : "", savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "" };
}

export async function readDiscontinueCodeDraft(): Promise<DiscontinueCodeDraft> {
  if (useBlobStore()) {
    const result = await get(BLOB_PATH, { access: "private", useCache: false }).catch(() => null);
    if (!result || result.statusCode !== 200) return normalize(null);
    return normalize(JSON.parse(await new Response(result.stream).text()));
  }
  try {
    return normalize(JSON.parse(await fs.readFile(LOCAL_PATH, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return normalize(null);
    throw error;
  }
}

export async function writeDiscontinueCodeDraft(text: string): Promise<DiscontinueCodeDraft> {
  const draft = { text, savedAt: new Date().toISOString() };
  const body = JSON.stringify(draft);
  if (useBlobStore()) {
    await put(BLOB_PATH, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
    return draft;
  }
  await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  const temporaryPath = `${LOCAL_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, body, "utf8");
  await fs.rename(temporaryPath, LOCAL_PATH);
  return draft;
}
