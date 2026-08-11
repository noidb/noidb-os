import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const automationDir = path.dirname(fileURLToPath(import.meta.url));
export const stateDir = path.join(automationDir, ".state");

export async function loadConfig() {
  const examplePath = path.join(automationDir, "config.example.json");
  const configPath = path.join(automationDir, "config.json");
  const sourcePath = await fs.access(configPath).then(() => configPath).catch(() => examplePath);
  const config = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  config.downloadDir = process.env.NOIDB_COUPANG_DOWNLOAD_DIR || String(config.downloadDir || "").trim() || path.join(os.homedir(), "Downloads");
  config.importUrl = process.env.NOIDB_COUPANG_IMPORT_URL || config.importUrl;
  config.hanjinOutputDir = process.env.NOIDB_HANJIN_OUTPUT_DIR || String(config.hanjinOutputDir || "").trim() || path.join(config.downloadDir, "한진택배업로드");
  config.hanjinTemplatePath = process.env.NOIDB_HANJIN_TEMPLATE_PATH || String(config.hanjinTemplatePath || "").trim() || path.join(automationDir, "templates", "서식_쿠팡 (고정형).xlsx");
  return config;
}

export async function writeStatus(status) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(stateDir, "status.json"),
    JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

export function log(message) {
  const time = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date());
  process.stdout.write(`[${time}] ${message}\n`);
}
