import { promises as fs } from "node:fs";
import path from "node:path";
import { get, put } from "@vercel/blob";

/**
 * 신규 발주서 화면의 "마지막으로 불러온 목록" 공유 저장소 (2026-10-02 신규 — 사용자 요청).
 *
 * 회사 PC·집 PC·모바일이 같은 화면을 이어 보도록, 사용자가 "발주서리스트 파일 불러오기"를 눌러
 * 받은 결과를 서버에 그대로 저장해 둔다. 다른 기기는 들어올 때 이 저장본만 가볍게 읽는다
 * (발주서 파일 가져오기·조회는 다시 하지 않는다). 발주묶음 저장소(invoice-group/server-store)와
 * 같은 이중화 방식(로컬 개발: JSON 파일 / 배포: Vercel Blob)이지만, 화면 표시용 캐시라 마지막에
 * 저장한 것이 이기는 단순 덮어쓰기로 충분하다(작업 기록이 아니므로 etag 동시성 검사 불필요).
 */

const BLOB_PATH = "noidb-wms/new-orders-last-view/v1/view.json";
const LOCAL_PATH = process.env.WMS_NEW_ORDERS_LAST_VIEW_FILE || path.join(process.cwd(), ".secrets", "new-orders-last-view.json");

export interface NewOrdersLastView {
  savedAt: string;
  orders: unknown[];
  importResult: unknown | null;
}

function useBlobStore(): boolean {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

function normalize(value: unknown): NewOrdersLastView | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<NewOrdersLastView>;
  if (typeof raw.savedAt !== "string" || !Array.isArray(raw.orders)) return null;
  return { savedAt: raw.savedAt, orders: raw.orders, importResult: raw.importResult ?? null };
}

export async function readNewOrdersLastView(): Promise<NewOrdersLastView | null> {
  if (useBlobStore()) {
    let result;
    try {
      result = await get(BLOB_PATH, { access: "private", useCache: false });
    } catch {
      result = await get(BLOB_PATH, { access: "private" }).catch(() => null);
    }
    if (!result || result.statusCode !== 200) return null;
    return normalize(JSON.parse(await new Response(result.stream).text()));
  }
  try {
    return normalize(JSON.parse(await fs.readFile(LOCAL_PATH, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeNewOrdersLastView(view: NewOrdersLastView): Promise<void> {
  const body = JSON.stringify(view);
  if (useBlobStore()) {
    await put(BLOB_PATH, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
    return;
  }
  await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  const temporaryPath = `${LOCAL_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, body, "utf8");
  await fs.rename(temporaryPath, LOCAL_PATH);
}
