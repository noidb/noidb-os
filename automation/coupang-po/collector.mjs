import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { loadConfig, log, stateDir, writeStatus } from "./common.mjs";
import { generateHanjinFiles } from "./hanjin-generator.mjs";

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
  const modePatterns = Object.entries(config.modePatterns || {
    poList: config.filePatterns || ["^발주서(?:리스트)?.*\\.xlsx$"],
  }).flatMap(([mode, patterns]) => patterns.map((pattern) => ({ mode, pattern: new RegExp(pattern, "i") })));
  const archivePatterns = (config.archivePatterns || ["^발주서리스트.*\\.zip$"]).map((pattern) => new RegExp(pattern, "i"));
  const cutoff = Date.now() - Number(config.lookbackHours || 72) * 60 * 60 * 1000;
  const results = [];
  for (const filePath of await walkFiles(config.downloadDir)) {
    const name = path.basename(filePath);
    const matchedMode = modePatterns.find(({ pattern }) => pattern.test(name));
    const isArchive = archivePatterns.some((pattern) => pattern.test(name));
    if (!matchedMode && !isArchive) continue;
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs >= cutoff) results.push({ filePath, stat, isArchive, mode: isArchive ? "poList" : matchedMode.mode });
  }
  return results.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
}

export async function expandCandidate(candidate, config) {
  const bytes = await fs.readFile(candidate.filePath);
  if (!candidate.isArchive) {
    return [{ bytes, name: path.basename(candidate.filePath), source: candidate.filePath, mtimeMs: candidate.stat.mtimeMs, mode: candidate.mode }];
  }
  const filePatterns = (config.modePatterns?.poList || config.filePatterns || ["^발주서(?:리스트)?.*\\.xlsx$"])
    .map((pattern) => new RegExp(pattern, "i"));
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
      mtimeMs: candidate.stat.mtimeMs,
      mode: "poList",
    });
  }
  return expanded;
}

async function upload(files, config, mode) {
  const form = new FormData();
  form.append("mode", mode);
  files.forEach((file) => form.append("files", new Blob([file.bytes]), file.name));
  const response = await fetch(config.importUrl, { method: "POST", body: form });
  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
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
  const allOrderFiles = [];
  let skipped = 0;

  for (const candidate of candidates) {
    if (!(await isStable(candidate.filePath))) {
      log(`다운로드 중인 파일은 다음 검사로 미룹니다: ${path.basename(candidate.filePath)}`);
      continue;
    }
    const expanded = await expandCandidate(candidate, config);
    if (candidate.isArchive && !expanded.length) log(`ZIP 안에서 발주서 파일을 찾지 못했습니다: ${path.basename(candidate.filePath)}`);
    allOrderFiles.push(...expanded.filter((file) => file.mode === "poList"));
    for (const file of expanded) {
      const hash = hashBytes(file.bytes);
      if (processed[`${file.mode}:${hash}`] || processed[hash]) {
        skipped += 1;
        continue;
      }
      pending.push({ ...file, hash });
    }
  }

  if (dryRun) {
    pending.forEach((file) => log(`[시험 모드 · ${file.mode}] 업로드 예정: ${file.source}`));
    await writeStatus({ ok: true, phase: "collect", uploaded: 0, skipped, pending: pending.length, downloadDir: config.downloadDir });
    return { uploaded: 0, skipped, found: pending.length + skipped, pending: pending.length, hanjinGenerated: 0 };
  }

  const totals = { parsed: 0, inserted: 0, updated: 0 };
  if (pending.length) {
    const byMode = pending.reduce((groups, file) => {
      (groups[file.mode] ||= []).push(file);
      return groups;
    }, {});
    const processedAt = new Date().toISOString();
    for (const [mode, files] of Object.entries(byMode)) {
      if (!files?.length) continue;
      log(`${mode} 신규 파일 ${files.length.toLocaleString()}개를 업로드합니다.`);
      const result = await upload(files, config, mode);
      totals.parsed += Number(result.parsed || 0);
      totals.inserted += Number(result.inserted || 0);
      totals.updated += Number(result.updated || 0);
      files.forEach((file) => {
        processed[`${mode}:${file.hash}`] = {
          file: file.source, mode, processedAt,
          parsed: result.parsed || 0, inserted: result.inserted || 0, updated: result.updated || 0,
        };
      });
    }
    await saveProcessed(processed);
    log(`통합 반영 완료 · 처리 ${totals.parsed.toLocaleString()}행 · 신규 ${totals.inserted.toLocaleString()}행 · 갱신 ${totals.updated.toLocaleString()}행`);
  }

  const hanjin = await generateHanjinFiles(allOrderFiles, config);
  await writeStatus({
    ok: true,
    phase: "collect",
    uploaded: pending.length,
    skipped,
    downloadDir: config.downloadDir,
    inserted: totals.inserted,
    updated: totals.updated,
    hanjinGenerated: hanjin.generated,
    hanjinFiles: hanjin.files,
  });
  return { uploaded: pending.length, skipped, found: pending.length + skipped, hanjinGenerated: hanjin.generated };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const watchMode = args.has("--watch");
  const dryRun = args.has("--dry-run");
  const config = await loadConfig();
  do {
    try {
      const summary = await collectOnce(config, { dryRun });
      log(`검사 완료 · 발견 ${summary.found}개 · 신규 반영 ${summary.uploaded}개 · 기존 처리 ${summary.skipped}개 · 한진 파일 생성 ${summary.hanjinGenerated}개`);
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
