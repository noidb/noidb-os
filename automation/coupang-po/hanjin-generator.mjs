import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { automationDir, loadConfig, log, stateDir } from "./common.mjs";

const statePath = path.join(stateDir, "hanjin-output.json");
const cacheDir = path.join(stateDir, "hanjin-xlsx-cache");
const orderFilePattern = /^발주서(?:리스트)?_?\d+\.xlsx$/i;

const defaultPostcodes = {
  "양산1": "50615",
  "창원4": "51599",
  "인천36": "22853",
  "인천30": "22793",
  "인천4": "22849",
  "안산3": "15657",
  "대구2": "39868",
  "대구3": "43008",
};

async function findArtifactNodeModules() {
  const candidates = [];
  if (process.env.NOIDB_ARTIFACT_NODE_MODULES) candidates.push(process.env.NOIDB_ARTIFACT_NODE_MODULES);
  const runtimeRoot = path.join(os.homedir(), ".cache", "codex-runtimes");
  try {
    for (const entry of await fs.readdir(runtimeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(path.join(runtimeRoot, entry.name, "dependencies", "node", "node_modules"));
    }
  } catch {
    // Codex runtime may not be installed on this PC yet.
  }
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, "@oai", "artifact-tool"));
      return candidate;
    } catch {
      // Try the next runtime.
    }
  }
  throw new Error("한진 엑셀 생성 모듈을 찾지 못했습니다. 이 PC에서 Codex를 한 번 실행한 뒤 다시 시도해 주세요.");
}

async function loadArtifactTool() {
  const nodeModules = await findArtifactNodeModules();
  const runtimeRequire = createRequire(path.join(nodeModules, "noidb-artifact-loader.cjs"));
  const entryPath = runtimeRequire.resolve("@oai/artifact-tool");
  return import(pathToFileURL(entryPath).href);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeDate(value) {
  const match = text(value).match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) throw new Error(`입고예정일 형식을 확인할 수 없습니다: ${text(value)}`);
  return `${match[1]}${match[2].padStart(2, "0")}${match[3].padStart(2, "0")}`;
}

function normalizePhone(value) {
  const digits = text(value).replace(/\D/g, "");
  if (!digits) throw new Error("택배수령담당자 연락처가 비어 있습니다.");
  return digits.startsWith("82") ? `0${digits.slice(2)}` : digits;
}

function cleanAddress(value) {
  return text(value)
    .replace(/\s*\(\s*택배수령담당자\s*:\s*\+?\d+\s*\)\s*$/, "")
    .trim();
}

async function parseOrderFile(file, artifact) {
  await fs.mkdir(cacheDir, { recursive: true });
  const hash = crypto.createHash("sha256").update(file.bytes).digest("hex");
  const cachedPath = path.join(cacheDir, `${hash}.xlsx`);
  await fs.writeFile(cachedPath, file.bytes);
  const blob = await artifact.FileBlob.load(cachedPath);
  const workbook = await artifact.SpreadsheetFile.importXlsx(blob);
  const sheet = workbook.worksheets.items[0];
  if (!sheet) throw new Error(`발주서 시트를 찾지 못했습니다: ${file.name}`);
  const po = text(sheet.getRange("C10").values?.[0]?.[0]);
  const center = text(sheet.getRange("C13").values?.[0]?.[0]);
  const address = cleanAddress(sheet.getRange("D13").values?.[0]?.[0]);
  const expectedDate = normalizeDate(sheet.getRange("F13").values?.[0]?.[0]);
  const phone = normalizePhone(sheet.getRange("I13").values?.[0]?.[0]);
  if (!po || !center || !address) throw new Error(`발주서 필수값이 비어 있습니다: ${file.name}`);
  return { po, center, address, expectedDate, phone, mtimeMs: Number(file.mtimeMs || 0), source: file.source };
}

function outputRows(records, postcodes) {
  const grouped = new Map();
  for (const record of records) {
    const postcode = text(postcodes[record.center]);
    if (!postcode) throw new Error(`우편번호가 등록되지 않은 물류센터입니다: ${record.center}`);
    const key = `${record.expectedDate}||${record.center}`;
    if (!grouped.has(key)) grouped.set(key, { ...record, postcode, poNumbers: [] });
    grouped.get(key).poNumbers.push(record.po);
  }
  const byDate = new Map();
  for (const group of grouped.values()) {
    group.poNumbers = [...new Set(group.poNumbers)].sort();
    if (!byDate.has(group.expectedDate)) byDate.set(group.expectedDate, []);
    byDate.get(group.expectedDate).push(group);
  }
  for (const groups of byDate.values()) groups.sort((a, b) => a.center.localeCompare(b.center, "ko"));
  return byDate;
}

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch {
    return {};
  }
}

export async function generateHanjinFiles(files, config, { force = false } = {}) {
  const orderFiles = files.filter((file) => orderFilePattern.test(file.name));
  if (!orderFiles.length) return { generated: 0, rows: 0, files: [] };

  const artifact = await loadArtifactTool();
  const recordsByPo = new Map();
  for (const file of orderFiles) {
    const record = await parseOrderFile(file, artifact);
    const previous = recordsByPo.get(record.po);
    if (!previous || record.mtimeMs >= previous.mtimeMs) recordsByPo.set(record.po, record);
  }
  const records = [...recordsByPo.values()].sort((a, b) => a.po.localeCompare(b.po));
  const postcodes = { ...defaultPostcodes, ...(config.centerPostcodes || {}) };
  const byDate = outputRows(records, postcodes);
  const outputDir = config.hanjinOutputDir || path.join(config.downloadDir, "한진택배업로드");
  const templatePath = config.hanjinTemplatePath || path.join(automationDir, "templates", "서식_쿠팡 (고정형).xlsx");
  const signature = crypto.createHash("sha256").update(JSON.stringify(records.map(({ source, mtimeMs, ...row }) => row))).digest("hex");
  const expectedPaths = [...byDate.keys()].sort().map((date) => path.join(outputDir, `한진택배 서식_쿠팡(고정형)_${date}.xlsx`));
  const state = await loadState();
  const outputsExist = (await Promise.all(expectedPaths.map((filePath) => fs.access(filePath).then(() => true).catch(() => false)))).every(Boolean);
  if (!force && state.signature === signature && outputsExist) return { generated: 0, rows: records.length, files: expectedPaths };

  await fs.mkdir(outputDir, { recursive: true });
  const templateBlob = await artifact.FileBlob.load(templatePath);
  const generated = [];
  for (const [date, groups] of [...byDate.entries()].sort()) {
    const workbook = await artifact.SpreadsheetFile.importXlsx(templateBlob);
    const sheet = workbook.worksheets.getItem("Sheet1") || workbook.worksheets.items[0];
    const lastRow = groups.length + 1;
    sheet.getRange(`K2:K${lastRow}`).format.numberFormat = "@";
    sheet.getRange(`AB2:AF${lastRow}`).format.numberFormat = "@";
    const values = groups.map((group) => {
      const row = Array(32).fill(null);
      row[10] = `로켓입고*${group.poNumbers.join("/")}`;
      row[27] = `로켓배송*${group.center}`;
      row[28] = group.phone;
      row[29] = group.postcode;
      row[30] = group.address;
      row[31] = "던지지마세요";
      return row;
    });
    sheet.getRange(`A2:AF${lastRow}`).values = values;
    const body = sheet.getRange(`A2:AF${lastRow}`);
    body.format.font = { name: "맑은 고딕", size: 10, color: "#000000" };
    body.format.verticalAlignment = "center";
    body.format.wrapText = false;
    const outputPath = path.join(outputDir, `한진택배 서식_쿠팡(고정형)_${date}.xlsx`);
    const exported = await artifact.SpreadsheetFile.exportXlsx(workbook);
    await fs.writeFile(outputPath, exported.data);
    generated.push(outputPath);
  }
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify({ signature, generated, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  log(`한진택배 업로드 파일 ${generated.length}개를 생성했습니다: ${outputDir}`);
  return { generated: generated.length, rows: records.length, files: generated };
}

async function main() {
  const config = await loadConfig();
  const { candidateFiles, expandCandidate } = await import("./collector.mjs");
  const expanded = [];
  for (const candidate of await candidateFiles(config)) {
    expanded.push(...await expandCandidate(candidate, config));
  }
  const result = await generateHanjinFiles(expanded, config, { force: process.argv.includes("--force") });
  log(`한진 파일 생성 완료 · 발주서 ${result.rows}개 · 출력 파일 ${result.files.length}개`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
