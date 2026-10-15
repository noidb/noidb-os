import { promises as fs } from "node:fs";
import path from "node:path";
import { get, put } from "@vercel/blob";

/**
 * AI상품등록 9번 "WIMS 검수상태" 마지막 가져온 결과 공유 저장소 (2026-10-15 사용자 요청).
 * 새로 가져오기 전까지 회사 PC·집 PC·모바일 어디서 열어도 마지막 결과가 그대로 보이게 한다.
 * 화면 표시용 캐시라 마지막 저장이 이기는 단순 덮어쓰기(new-orders-last-view-store와 같은 방식).
 */
const BLOB_PATH = "noidb-wms/wims-registration-last/v1/snapshot.json";
const LOCAL_PATH = process.env.WMS_WIMS_LAST_SNAPSHOT_FILE || path.join(process.cwd(), ".secrets", "wims-last-snapshot.json");

export interface WimsLastSnapshot {
  capturedAt: string;
  snapshot: { rows: unknown[] } & Record<string, unknown>;
  capture: unknown | null;
}

function useBlobStore(): boolean {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

export function normalizeWimsLastSnapshot(value: unknown): WimsLastSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<WimsLastSnapshot>;
  if (typeof raw.capturedAt !== "string" || !raw.snapshot || typeof raw.snapshot !== "object" || !Array.isArray((raw.snapshot as { rows?: unknown }).rows)) return null;
  return { capturedAt: raw.capturedAt, snapshot: raw.snapshot as WimsLastSnapshot["snapshot"], capture: raw.capture ?? null };
}

export async function readWimsLastSnapshot(): Promise<WimsLastSnapshot | null> {
  if (useBlobStore()) {
    let result;
    try {
      result = await get(BLOB_PATH, { access: "private", useCache: false });
    } catch {
      result = await get(BLOB_PATH, { access: "private" }).catch(() => null);
    }
    if (!result || result.statusCode !== 200) return null;
    return normalizeWimsLastSnapshot(JSON.parse(await new Response(result.stream).text()));
  }
  try {
    return normalizeWimsLastSnapshot(JSON.parse(await fs.readFile(LOCAL_PATH, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeWimsLastSnapshot(value: WimsLastSnapshot): Promise<void> {
  const body = JSON.stringify(value);
  if (useBlobStore()) {
    await put(BLOB_PATH, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
    return;
  }
  await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  const temporaryPath = `${LOCAL_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, body, "utf8");
  await fs.rename(temporaryPath, LOCAL_PATH);
}
