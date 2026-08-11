import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, log, stateDir, writeStatus } from "./common.mjs";

const args = new Set(process.argv.slice(2));
const watchMode = args.has("--watch");
const dryRun = args.has("--dry-run");
const config = await loadConfig();
const processedPath = path.join(stateDir, "processed.json");
const patterns = config.filePatterns.map((pattern) => new RegExp(pattern, "i"));

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

async function hashFile(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function isStable(filePath) {
  const first = await fs.stat(filePath);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const second = await fs.stat(filePath);
  return first.size > 0 && first.size === second.size && first.mtimeMs === second.mtimeMs;
}

async function candidateFiles() {
  await fs.mkdir(config.downloadDir, { recursive: true });
  const cutoff = Date.now() - Number(config.lookbackHours || 72) * 60 * 60 * 1000;
  const entries = await fs.readdir(config.downloadDir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (!entry.isFile() || !patterns.some((pattern) => pattern.test(entry.name))) continue;
    const filePath = path.join(config.downloadDir, entry.name);
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs >= cutoff) results.push({ filePath, stat });
  }
  return results.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
}

async function upload(filePath) {
  const form = new FormData();
  form.append("mode", "poList");
  form.append("files", new Blob([await fs.readFile(filePath)]), path.basename(filePath));
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

async function collectOnce() {
  const processed = await loadProcessed();
  const files = await candidateFiles();
  let uploaded = 0;
  let skipped = 0;
  for (const { filePath } of files) {
    if (!(await isStable(filePath))) {
      log(`다운로드 중인 파일은 다음 검사로 미룹니다: ${path.basename(filePath)}`);
      continue;
    }
    const hash = await hashFile(filePath);
    if (processed[hash]) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      log(`[시험 모드] 업로드 대상: ${filePath}`);
      continue;
    }
    log(`신규 발주 파일 업로드: ${path.basename(filePath)}`);
    const result = await upload(filePath);
    processed[hash] = {
      file: filePath,
      processedAt: new Date().toISOString(),
      parsed: result.parsed || 0,
      inserted: result.inserted || 0,
      updated: result.updated || 0,
    };
    await saveProcessed(processed);
    uploaded += 1;
    log(`반영 완료 · ${Number(result.parsed || 0).toLocaleString()}행 · 발주서 출력 ${Number(result.pickingRows || 0).toLocaleString()}행`);
  }
  await writeStatus({ ok: true, phase: "collect", uploaded, skipped, downloadDir: config.downloadDir });
  return { uploaded, skipped, found: files.length };
}

do {
  try {
    const summary = await collectOnce();
    log(`검사 완료 · 발견 ${summary.found}개 · 신규 반영 ${summary.uploaded}개 · 기존 처리 ${summary.skipped}개`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`오류: ${message}`);
    await writeStatus({ ok: false, phase: "collect", error: message });
    if (!watchMode) process.exitCode = 1;
  }
  if (watchMode) await new Promise((resolve) => setTimeout(resolve, Number(config.scanIntervalSeconds || 30) * 1000));
} while (watchMode);
