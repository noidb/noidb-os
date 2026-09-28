import { promises as fs } from "node:fs";
import path from "node:path";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

export type ReregistrationExclusion = { modelName: string; reason: string; excludedAt: string };
type Store = { entries: Record<string, ReregistrationExclusion> };

const BLOB_PATH = "noidb-wms/product-registration/v1/reregistration-exclusions.json";
const LOCAL_PATH = path.join(process.cwd(), ".secrets", "reregistration-exclusions.json");
let localQueue: Promise<unknown> = Promise.resolve();

function initialStore(): Store {
  return { entries: { mn000003: { modelName: "mn000003", reason: "가품 위험 · 크롬 유사 디자인", excludedAt: "2026-09-28T00:00:00.000Z" } } };
}

export function exclusionKey(modelName: string): string {
  return modelName.trim().toLowerCase();
}

function useBlob(): boolean {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

async function readStore(): Promise<{ store: Store; etag?: string }> {
  if (!useBlob()) {
    try { return { store: JSON.parse(await fs.readFile(LOCAL_PATH, "utf8")) as Store }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { store: initialStore() }; throw error; }
  }
  const result = await get(BLOB_PATH, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return { store: initialStore() };
  return { store: JSON.parse(await new Response(result.stream).text()) as Store, etag: result.blob.etag };
}

export async function readReregistrationExclusions(): Promise<Record<string, ReregistrationExclusion>> {
  return (await readStore()).store.entries;
}

export async function changeReregistrationExclusion(modelName: string, reason: string | null): Promise<Record<string, ReregistrationExclusion>> {
  const work = localQueue.then(async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { store, etag } = await readStore();
      const entries = { ...store.entries };
      const key = exclusionKey(modelName);
      if (reason === null) delete entries[key];
      else entries[key] = { modelName: modelName.trim(), reason, excludedAt: new Date().toISOString() };
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
    throw new Error("재등록 제외 상태를 저장하지 못했습니다.");
  });
  localQueue = work.catch(() => undefined);
  return work;
}
