import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { batchWaveCreationRequestBudget, legacyWaveCreationRequestBudget } from "../lib/wms/picking-wave/request-budget";
import type { BasketAssignment, PickingWave, PickingWaveItem } from "../lib/wms/picking-wave/types";

const storePath = path.join(os.tmpdir(), `noidb-wave-batch-${process.pid}.json`);
process.env.WMS_PICKING_WAVE_STORE_FILE = storePath;
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;

function fixtures(id: string, poCount: number, skuCount: number, updatedAt: string) {
  const poNumbers = Array.from({ length: poCount }, (_, index) => `${id}-PO-${index + 1}`);
  const wave: PickingWave = { id, displayName: id, status: "in_progress", sourcePurchaseOrderNumbers: poNumbers, completedGroupIds: [], productDbConfigured: true, createdAt: updatedAt, updatedAt };
  const items: PickingWaveItem[] = Array.from({ length: skuCount }, (_, index) => {
    const po = poNumbers[index % poNumbers.length];
    const basket = String((index % poNumbers.length) + 1);
    return { id: `${id}-SKU-${index + 1}`, waveId: id, productCode: `${id}-SKU-${index + 1}`, productName: "fixture", barcode: "", totalQuantity: 1, sources: [{ purchaseOrderNumber: po, basketNumber: basket, requestedQuantity: 1 }], locationStatus: "unlocated", modelSortKey: `${index}`, locationSortKey: "", status: "pending", pickedQuantity: 0, shortageQuantity: 0, allocations: [], createdAt: updatedAt, updatedAt };
  });
  const baskets: BasketAssignment[] = poNumbers.map((po, index) => ({ basketNumber: String(index + 1), purchaseOrderNumber: po, fulfillmentCenter: "테스트센터", waveId: id, status: "pending", createdAt: updatedAt, updatedAt }));
  return { wave, items, baskets };
}

async function main() {
  const { mutatePickingWaveStore, readPickingWaveStore, isBlobWriteConflict, isRateLimit, normalizeEtag, retryAfterMs } = await import("../lib/wms/picking-wave/server-store");
  assert.equal(normalizeEtag('  "abc123"  '), "abc123", "quoted ETag 정규화");
  assert.equal(normalizeEtag("abc123"), "abc123", "unquoted ETag 유지");
  assert.equal(normalizeEtag('W/"abc123"'), "abc123", "weak quoted ETag 정규화");
  assert.equal(isBlobWriteConflict(new Error("The conditional request cannot succeed due to a conflicting operation against this resource.")), true, "운영 412 문구 분류");
  assert.equal(isRateLimit(new Error("Too many requests - try again in 60 seconds.")), true, "운영 429 문구 분류");
  assert.equal(retryAfterMs(new Error("Too many requests - try again in 60 seconds.")), 60_000, "Retry-After 60초 존중");
  const cases = [
    { po: 1, sku: 1 }, { po: 10, sku: 10 }, { po: 30, sku: 30 },
    { po: 10, sku: 100 }, { po: 30, sku: 500 }, { po: 31, sku: 1000 },
  ];
  const results = [];
  for (const [index, test] of cases.entries()) {
    const data = fixtures(`WAVE-BATCH-${index}`, test.po, test.sku, new Date(Date.UTC(2026, 8, 1, 1, index)).toISOString());
    const started = performance.now();
    await mutatePickingWaveStore({ action: "createWaveBatch", operationId: `OP-${index}`, ...data });
    const durationMs = performance.now() - started;
    const snapshot = await readPickingWaveStore();
    assert.equal(snapshot.items.filter(item => item.waveId === data.wave.id).length, test.sku);
    assert.equal(snapshot.baskets.filter(item => item.waveId === data.wave.id).length, test.po);
    results.push({ ...test, old: legacyWaveCreationRequestBudget(test.po, test.sku), next: batchWaveCreationRequestBudget(), durationMs: Number(durationMs.toFixed(2)) });
  }

  const retryData = fixtures("WAVE-IDEMPOTENT", 10, 100, "2026-09-01T02:00:00.000Z");
  await mutatePickingWaveStore({ action: "createWaveBatch", operationId: "OP-IDEMPOTENT", ...retryData });
  await mutatePickingWaveStore({ action: "createWaveBatch", operationId: "OP-IDEMPOTENT", ...retryData });
  let snapshot = await readPickingWaveStore();
  assert.equal(snapshot.waves.filter(wave => wave.id === retryData.wave.id).length, 1, "동일 operation 재시도는 웨이브 1개");
  assert.equal(snapshot.items.filter(item => item.waveId === retryData.wave.id).length, 100);

  const existing = fixtures("WAVE-EXISTING-PROGRESS", 1, 1, "2026-09-01T03:00:00.000Z");
  await mutatePickingWaveStore({ action: "createWaveBatch", operationId: "OP-EXISTING", ...existing });
  const progressedItem = { ...existing.items[0], status: "full" as const, pickedQuantity: 1, updatedAt: "2026-09-01T03:01:00.000Z" };
  const progressedWave = { ...existing.wave, updatedAt: "2026-09-01T03:01:00.000Z" };
  const concurrent = fixtures("WAVE-CONCURRENT-CREATE", 30, 500, "2026-09-01T03:01:00.000Z");
  await Promise.all([
    mutatePickingWaveStore({ action: "createWaveBatch", operationId: "OP-CONCURRENT", ...concurrent }),
    mutatePickingWaveStore({ action: "saveProgress", items: [progressedItem], wave: progressedWave }),
  ]);
  snapshot = await readPickingWaveStore();
  assert.equal(snapshot.items.find(item => item.id === progressedItem.id)?.pickedQuantity, 1, "동시 background progress 보존");
  assert.equal(snapshot.items.filter(item => item.waveId === concurrent.wave.id).length, 500, "동시 신규 웨이브 보존");

  await mutatePickingWaveStore({ action: "deleteWave", waveId: concurrent.wave.id, deletedAt: "2026-09-01T04:00:00.000Z" });
  await mutatePickingWaveStore({ action: "migrate", snapshot: { waves: [concurrent.wave], items: concurrent.items, baskets: concurrent.baskets } });
  snapshot = await readPickingWaveStore();
  assert.equal(snapshot.waves.some(wave => wave.id === concurrent.wave.id), false, "tombstone 이후 부활 차단");
  assert.equal(snapshot.items.some(item => item.waveId === concurrent.wave.id), false);

  const parsed = JSON.parse(await readFile(storePath, "utf8"));
  assert.ok(parsed.revision > 0);
  console.log(JSON.stringify({ ok: true, cases: results, concurrent: "PASS", idempotency: "PASS", tombstone: "PASS" }, null, 2));
  await unlink(storePath).catch(() => undefined);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
