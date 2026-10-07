import { promises as fs } from "node:fs";
import path from "node:path";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

/**
 * 로켓 미등록 상품(data/rocket-pending.json)에 사용자가 직접 넣거나 고친 모델명·카테고리·성별.
 * SKU ID 기준으로 저장하고, 목록을 읽을 때 원래 값 위에 덮어쓴다(회사·집·모바일 공통 — Vercel Blob).
 * 목록 파일을 새 다운로드로 다시 만들어도 이 수정값은 그대로 남는다.
 */
export type RocketPendingOverride = { modelName?: string; category?: string; gender?: string; deleted?: boolean; updatedAt: string };
type Store = { entries: Record<string, RocketPendingOverride> };

const BLOB_PATH = "noidb-wms/product-registration/v1/rocket-pending-overrides.json";
const LOCAL_PATH = path.join(process.cwd(), ".secrets", "rocket-pending-overrides.json");
let localQueue: Promise<unknown> = Promise.resolve();

function useBlob(): boolean {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

async function readStore(): Promise<{ store: Store; etag?: string }> {
  if (!useBlob()) {
    try { return { store: JSON.parse(await fs.readFile(LOCAL_PATH, "utf8")) as Store }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { store: { entries: {} } }; throw error; }
  }
  const result = await get(BLOB_PATH, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return { store: { entries: {} } };
  return { store: JSON.parse(await new Response(result.stream).text()) as Store, etag: result.blob.etag };
}

export async function readRocketPendingOverrides(): Promise<Record<string, RocketPendingOverride>> {
  return (await readStore()).store.entries;
}

/**
 * value가 null이면 그 SKU들의 모델명·카테고리·성별 수정값을 지우고 원래(Wing에서 이은) 값으로 되돌린다(삭제 표시는 유지).
 * value는 기존 값 위에 합친다 — 예: { deleted: true }는 직접 넣은 모델명을 지우지 않는다.
 */
export async function changeRocketPendingOverrides(skuIds: string[], value: Omit<RocketPendingOverride, "updatedAt"> | null) {
  const work = localQueue.then(async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { store, etag } = await readStore();
      const entries = { ...store.entries };
      for (const skuId of skuIds) {
        const previous = entries[skuId];
        if (value === null) {
          if (previous?.deleted) entries[skuId] = { deleted: true, updatedAt: new Date().toISOString() };
          else delete entries[skuId];
        } else {
          const next: RocketPendingOverride = { ...previous, ...value, updatedAt: new Date().toISOString() };
          if (!next.deleted) delete next.deleted;
          // 되살린 뒤 남은 수정값이 없으면 항목 자체를 지운다.
          if (next.modelName === undefined && next.category === undefined && next.gender === undefined && !next.deleted) delete entries[skuId];
          else entries[skuId] = next;
        }
      }
      if (!useBlob()) {
        await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
        const temporary = `${LOCAL_PATH}.${process.pid}.tmp`;
        await fs.writeFile(temporary, JSON.stringify({ entries }), "utf8");
        await fs.rename(temporary, LOCAL_PATH);
        return entries;
      }
      try {
        await put(BLOB_PATH, JSON.stringify({ entries }), { access: "private", addRandomSuffix: false, contentType: "application/json", ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }) });
        return entries;
      } catch (error) {
        if (!(error instanceof BlobPreconditionFailedError) || attempt === 3) throw error;
      }
    }
    throw new Error("로켓 미등록 모델명을 저장하지 못했습니다.");
  });
  localQueue = work.catch(() => undefined);
  return work;
}
