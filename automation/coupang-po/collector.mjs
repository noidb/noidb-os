import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { loadConfig, log, stateDir, writeStatus } from "./common.mjs";

const processedPath = path.join(stateDir, "processed.json");

async function loadProcessed() {
  try {
    return JSON.parse(await fs.readFile(processedPath, "utf8"));
  } catch {
    return {};
  }
}

async function saveProcessed(processed) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(processedPath, JSON.stringify(processed, null, 2), "utf8");
}

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function isStable(filePath) {
  const first = await fs.stat(filePath);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const second = await fs.stat(filePath);
  return first.size > 0 && first.size === second.size && first.mtimeMs === second.mtimeMs;
}

async function walkFiles(directory) {
  const results = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await walkFiles(entryPath));
    else if (entry.isFile()) results.push(entryPath);
  }
  return results;
}

export async function candidateFiles(config) {
  await fs.mkdir(config.downloadDir, { recursive: true });
  const filePatterns = config.filePatterns.map((pattern) => new RegExp(pattern, "i"));
  const archivePatterns = (config.archivePatterns || ["^발주서리스트.*\\.zip$"]).map((pattern) => new RegExp(pattern, "i"));
  const cutoff = Date.now() - Number(config.lookbackHours || 72) * 60 * 60 * 1000;
  const results = [];
  for (const filePath of await walkFiles(config.downloadDir)) {
    const name = path.basename(filePath);
    const isOrderFile = filePatterns.some((pattern) => pattern.test(name));
    const isArchive = archivePatterns.some((pattern) => pattern.test(name));
    if (!isOrderFile && !isArchive) continue;
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs >= cutoff) results.push({ filePath, stat, isArchive });
  }
  return results.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
}

export async function expandCandidate(candidate, config) {
  const bytes = await fs.readFile(candidate.filePath);
  if (!candidate.isArchive) {
    return [{ bytes, name: path.basename(candidate.filePath), source: candidate.filePath }];
  }

  const filePatterns = config.filePatterns.map((pattern) => new RegExp(pattern, "i"));
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && filePatterns.some((pattern) => pattern.test(path.basename(entry.name))))
    .sort((a, b) => a.name.localeCompare(b.name));
  const expanded = [];
  for (const entry of entries) {
    expanded.push({
      bytes: Buffer.from(await entry.async("uint8array")),
      name: path.basename(entry.name),
      source: `${candidate.filePath}::${entry.name}`,
    });
  }
  return expanded;
}

async function upload(files, config) {
  const form = new FormData();
  form.append("mode", "poList");
  files.forEach((file) => form.append("files", new Blob([file.bytes]), file.name));
  const response = await fetch(config.importUrl, { method: "POST", body: form });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`노이드비 서버가 JSON이 아닌 응답을 반환했습니다. (${response.status})`);
  }
  if (!response.ok || result.ok === false) throw new Error(result.error || `업로드 실패 (${response.status})`);
  return result;
}

export async function collectOnce(config, { dryRun = false } = {}) {
  const processed = await loadProcessed();
  const candidates = await candidateFiles(config);
  const pending = [];
  let skipped = 0;

  for (const candidate of candidates) {
    if (!(await isStable(candidate.filePath))) {
      log(`다운로드 중인 파일은 다음 검사로 미룹니다: ${path.basename(candidate.filePath)}`);
      continue;
    }
    const expanded = await expandCandidate(candidate, config);
    if (candidate.isArchive && !expanded.length) log(`ZIP 내부에서 발주서 엑셀을 찾지 못했습니다: ${path.basename(candidate.filePath)}`);
    for (const file of expanded) {
      const hash = hashBytes(file.bytes);
      if (processed[hash]) {
        skipped += 1;
        continue;
      }
      pending.push({ ...file, hash });
    }
  }

  if (dryRun) {
    pending.forEach((file) => log(`[시험 모드] 업로드 대상: ${file.source}`));
    await writeStatus({ ok: true, phase: "collect", uploaded: 0, skipped, pending: pending.length, downloadDir: config.downloadDir });
    return { uploaded: 0, skipped, found: pending.length + skipped, pending: pending.length };
  }

  let result = {};
  if (pending.length) {
    log(`신규 발주 파일 ${pending.length.toLocaleString()}개 일괄 업로드`);
    result = await upload(pending, config);
    const processedAt = new Date().toISOString();
    pending.forEach((file) => {
      processed[file.hash] = {
        file: file.source,
        processedAt,
        parsed: result.parsed || 0,
        inserted: result.inserted || 0,
        updated: result.updated || 0,
      };
    });
    await saveProcessed(processed);
    log(`반영 완료 · ${Number(result.parsed || 0).toLocaleString()}행 · 신규 ${Number(result.inserted || 0).toLocaleString()}행 · 날짜/정보 갱신 ${Number(result.updated || 0).toLocaleString()}행`);
  }

  await writeStatus({
    ok: true,
    phase: "collect",
    uploaded: pending.length,
    skipped,
    downloadDir: config.downloadDir,
    inserted: result.inserted || 0,
    updated: result.updated || 0,
  });
  return { uploaded: pending.length, skipped, found: pending.length + skipped };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const watchMode = args.has("--watch");
  const dryRun = args.has("--dry-run");
  const config = await loadConfig();
  do {
    try {
      const summary = await collectOnce(config, { dryRun });
      log(`검사 완료 · 발견 ${summary.found}개 · 신규 반영 ${summary.uploaded}개 · 기존 처리 ${summary.skipped}개`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`오류: ${message}`);
      await writeStatus({ ok: false, phase: "collect", error: message });
      if (!watchMode) process.exitCode = 1;
    }
    if (watchMode) await new Promise((resolve) => setTimeout(resolve, Number(config.scanIntervalSeconds || 30) * 1000));
  } while (watchMode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
