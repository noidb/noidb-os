import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, writeStatus } from "./common.mjs";

const automationDir = path.dirname(fileURLToPath(import.meta.url));

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(automationDir, script), ...args], {
      cwd: path.resolve(automationDir, "../.."),
      stdio: "inherit",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${script} 종료 코드 ${code}`)));
  });
}

try {
  log("쿠팡 신규 발주 다운로드를 시작합니다.");
  await run("portal.mjs", ["download"]);
  log("다운로드 파일을 노이드비 자동화에 반영합니다.");
  await run("collector.mjs", ["--once"]);
  await writeStatus({ ok: true, phase: "complete" });
  log("쿠팡 발주 자동수집이 완료되었습니다.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await writeStatus({ ok: false, phase: "complete", error: message });
  log(`자동수집 실패: ${message}`);
  process.exitCode = 1;
}
