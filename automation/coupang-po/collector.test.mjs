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
  modePatterns: {
    skuMaster: ["^상품공급상태관리.*\\.xlsx$", "^noidb.*_sku_download_.*\\.xlsx$"],
    inboundHistory: ["^Coupang_Stocked_Data_List.*\\.xlsx$"],
    poList: ["^발주서(?:리스트)?.*\\.xlsx$"],
  },
  archivePatterns: ["^발주서리스트.*\\.zip$"],
});

test("통합 버튼은 세 종류를 구분하고 중복 PO_SKU_LIST는 제외한다", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noidb-all-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await Promise.all([
    fs.writeFile(path.join(root, "상품공급상태관리 SKU 다운로드.xlsx"), "sku"),
    fs.writeFile(path.join(root, "Coupang_Stocked_Data_List_20260812.xlsx"), "inbound"),
    fs.writeFile(path.join(root, "발주서리스트_139142928.xlsx"), "po"),
    fs.writeFile(path.join(root, "PO_SKU_LIST_20260812.xlsx"), "duplicate"),
  ]);

  const candidates = await candidateFiles(configFor(root));
  assert.deepEqual(candidates.map((candidate) => candidate.mode).sort(), ["inboundHistory", "poList", "skuMaster"]);
  assert.equal(candidates.some((candidate) => path.basename(candidate.filePath).startsWith("PO_SKU_LIST")), false);
});

test("종류별 다운로드 폴더를 각각 검사한다", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noidb-folders-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const dirs = {
    skuMaster: path.join(root, "상품공급상태관리 다운로드"),
    inboundHistory: path.join(root, "입고상세내역 다운로드"),
    poList: path.join(root, "발주서리스트다운"),
  };
  await Promise.all(Object.values(dirs).map((directory) => fs.mkdir(directory)));
  await Promise.all([
    fs.writeFile(path.join(dirs.skuMaster, "noidb2017_sku_download_20260812040716.xlsx"), "sku"),
    fs.writeFile(path.join(dirs.inboundHistory, "Coupang_Stocked_Data_List.xlsx"), "inbound"),
    fs.writeFile(path.join(dirs.poList, "발주서리스트_139142928.xlsx"), "po"),
  ]);
  const config = { ...configFor(root), inputDirs: dirs };
  const candidates = await candidateFiles(config);
  assert.deepEqual(candidates.map((candidate) => candidate.mode).sort(), ["inboundHistory", "poList", "skuMaster"]);
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
