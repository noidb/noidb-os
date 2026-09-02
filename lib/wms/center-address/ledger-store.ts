import { promises as fs } from "node:fs";
import path from "node:path";
import { BlobPreconditionFailedError, get, head, put } from "@vercel/blob";
import type { CenterAddressLedger, CenterAddressLedgerEntry } from "./types";

const BLOB_PATH = "noidb-wms/fulfillment-centers/v1/address-ledger.json";
const LOCAL_PATH = process.env.WMS_CENTER_ADDRESS_LEDGER_FILE || path.join(process.cwd(), ".secrets", "center-address-ledger.json");
const MAX_RETRIES = 4;
let localQueue: Promise<unknown> = Promise.resolve();

function emptyLedger(): CenterAddressLedger {
  return { schemaVersion: 1, updatedAt: new Date(0).toISOString(), entries: [] };
}

function normalizeLedger(value: unknown): CenterAddressLedger {
  const raw = value && typeof value === "object" ? value as Partial<CenterAddressLedger> : {};
  return { schemaVersion: 1, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(), entries: Array.isArray(raw.entries) ? raw.entries : [] };
}

function useBlob(): boolean {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//i, "").replace(/^\"|\"$/g, "");
}

async function readLedger(): Promise<{ ledger: CenterAddressLedger; etag?: string }> {
  if (!useBlob()) {
    try { return { ledger: normalizeLedger(JSON.parse(await fs.readFile(LOCAL_PATH, "utf8"))) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ledger: emptyLedger() }; throw error; }
  }
  const result = await get(BLOB_PATH, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return { ledger: emptyLedger() };
  const body = await new Response(result.stream).text();
  const metadata = await head(BLOB_PATH);
  if (normalizeEtag(result.blob.etag) !== normalizeEtag(metadata.etag)) return readLedger();
  return { ledger: normalizeLedger(JSON.parse(body)), etag: metadata.etag };
}

function mergeEntries(current: readonly CenterAddressLedgerEntry[], incoming: readonly CenterAddressLedgerEntry[]): CenterAddressLedgerEntry[] {
  const merged = new Map(current.map(entry => [entry.key, entry]));
  for (const entry of incoming) {
    const existing = merged.get(entry.key);
    if (!existing || entry.updatedAt.localeCompare(existing.updatedAt) >= 0) merged.set(entry.key, entry);
  }
  return [...merged.values()];
}

function isConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("etag mismatch") || message.includes("precondition failed");
}

async function saveEntriesNow(entries: readonly CenterAddressLedgerEntry[]): Promise<void> {
  if (!entries.length) return;
  if (!useBlob()) {
    const { ledger } = await readLedger();
    const next = { schemaVersion: 1 as const, updatedAt: new Date().toISOString(), entries: mergeEntries(ledger.entries, entries) };
    await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
    const temporary = `${LOCAL_PATH}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(temporary, LOCAL_PATH);
    return;
  }
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const { ledger, etag } = await readLedger();
    const next = { schemaVersion: 1 as const, updatedAt: new Date().toISOString(), entries: mergeEntries(ledger.entries, entries) };
    try {
      await put(BLOB_PATH, JSON.stringify(next), { access: "private", addRandomSuffix: false, contentType: "application/json", ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }) });
      return;
    } catch (error) {
      if (!isConflict(error) || attempt === MAX_RETRIES - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 80 * 2 ** attempt + Math.random() * 60));
    }
  }
}

export async function loadCenterAddressLedger(): Promise<CenterAddressLedger> {
  return (await readLedger()).ledger;
}

export async function saveCenterAddressLedgerEntries(entries: readonly CenterAddressLedgerEntry[]): Promise<void> {
  const task = localQueue.then(() => saveEntriesNow(entries));
  localQueue = task.catch(() => undefined);
  return task;
}
