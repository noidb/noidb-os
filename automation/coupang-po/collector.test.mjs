import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { candidateFiles, expandCandidate } from "./collector.mjs";

const configFor = (downloadDir) => ({
  downloadDir,
  lookbackHours: 72,
  filePatterns: ["^PO_SKU_LIST.*\\.(csv|xlsx)$", "^발주서.*\\.xlsx$"],
  archivePatterns: ["^발주서리스트.*\\.zip$"],
});

test("날짜별 하위 폴더의 발주서 엑셀을 찾는다", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noidb-po-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const dated = path.join(root, "발주서리스트_20260812");
  await fs.mkdir(dated);
  await fs.writeFile(path.join(dated, "발주서리스트_139142928.xlsx"), "xlsx-bytes");

  const candidates = await candidateFiles(configFor(root));
  assert.equal(candidates.length, 1);
  assert.equal(path.basename(candidates[0].filePath), "발주서리스트_139142928.xlsx");
  assert.equal(candidates[0].isArchive, false);
});

test("날짜별 ZIP에서 발주서 엑셀만 꺼낸다", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noidb-po-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const zip = new JSZip();
  zip.file("발주서리스트_20260812/발주서리스트_139142928.xlsx", "first");
  zip.file("발주서리스트_20260812/발주서리스트_139142652.xlsx", "second");
  zip.file("발주서리스트_20260812/안내.txt", "ignore");
  await fs.writeFile(path.join(root, "발주서리스트_20260812.zip"), await zip.generateAsync({ type: "nodebuffer" }));

  const config = configFor(root);
  const candidates = await candidateFiles(config);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].isArchive, true);
  const expanded = await expandCandidate(candidates[0], config);
  assert.deepEqual(expanded.map((entry) => entry.name), [
    "발주서리스트_139142652.xlsx",
    "발주서리스트_139142928.xlsx",
  ]);
});
