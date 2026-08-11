import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { automationDir, loadConfig, log, writeStatus } from "./common.mjs";

const mode = process.argv[2] || "download";
const config = await loadConfig();
const profileDir = path.join(automationDir, ".profile");
await fs.mkdir(config.downloadDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  channel: "msedge",
  headless: false,
  acceptDownloads: true,
  downloadsPath: config.downloadDir,
  viewport: null,
  args: ["--start-maximized"],
});
const page = context.pages()[0] || await context.newPage();

function isLoginUrl(url) {
  return /xauth\.coupang\.com|\/auth\//i.test(url);
}

async function visibleNavigationSummary() {
  return page.evaluate(() => [...document.querySelectorAll("button,a,[role=button],[role=menuitem]")]
    .filter((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    })
    .map((node) => ({
      tag: node.tagName,
      text: String(node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
      aria: node.getAttribute("aria-label") || "",
      href: node instanceof HTMLAnchorElement ? node.href : "",
    }))
    .filter((item) => item.text || item.aria)
    .slice(0, 150));
}

async function clickFirstText(texts) {
  for (const text of texts) {
    const matcher = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const candidates = [
      page.getByRole("button", { name: matcher }),
      page.getByRole("link", { name: matcher }),
      page.getByText(matcher, { exact: false }),
    ];
    for (const candidate of candidates) {
      const count = await candidate.count();
      for (let index = 0; index < Math.min(count, 5); index += 1) {
        const item = candidate.nth(index);
        if (await item.isVisible().catch(() => false)) {
          await item.click();
          await page.waitForTimeout(1200);
          return text;
        }
      }
    }
  }
  return "";
}

async function ensureLoggedIn(waitForUser) {
  await page.goto(config.portalUrl, { waitUntil: "domcontentloaded" });
  if (!isLoginUrl(page.url())) return true;
  await writeStatus({ ok: false, phase: "portal", loginRequired: true });
  if (!waitForUser) return false;
  log("쿠팡 로그인 후 대시보드가 열릴 때까지 기다립니다. 창에서 직접 로그인해주세요.");
  await page.waitForURL((url) => url.hostname === "supplier.coupang.com" && !/\/auth\//i.test(url.pathname), { timeout: 10 * 60 * 1000 });
  await writeStatus({ ok: true, phase: "portal", loginRequired: false });
  return true;
}

try {
  if (mode === "login") {
    await ensureLoggedIn(true);
    log("로그인 상태가 저장되었습니다. 이 창은 닫아도 됩니다.");
    await page.waitForTimeout(3000);
  } else if (mode === "inspect") {
    if (!(await ensureLoggedIn(false))) throw new Error("LOGIN_REQUIRED");
    const summary = await visibleNavigationSummary();
    await fs.mkdir(path.join(automationDir, ".state"), { recursive: true });
    await fs.writeFile(path.join(automationDir, ".state", "portal-controls.json"), JSON.stringify({ url: page.url(), title: await page.title(), controls: summary }, null, 2), "utf8");
    log(`화면의 버튼과 메뉴 ${summary.length}개를 검사했습니다.`);
  } else if (mode === "download") {
    if (!(await ensureLoggedIn(false))) throw new Error("LOGIN_REQUIRED");
    await clickFirstText(config.navigationTexts || []);
    const downloadPromise = page.waitForEvent("download", { timeout: Number(config.downloadTimeoutSeconds || 90) * 1000 });
    const clicked = await clickFirstText(config.downloadButtonTexts || []);
    if (!clicked) throw new Error("발주 다운로드 버튼을 찾지 못했습니다. npm run coupang:inspect를 실행해 화면을 다시 확인해주세요.");
    const download = await downloadPromise;
    const destination = path.join(config.downloadDir, download.suggestedFilename());
    await download.saveAs(destination);
    await writeStatus({ ok: true, phase: "portal", downloaded: destination });
    log(`다운로드 완료: ${destination}`);
  } else {
    throw new Error(`지원하지 않는 실행 모드: ${mode}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await writeStatus({ ok: false, phase: "portal", loginRequired: message === "LOGIN_REQUIRED", error: message });
  if (message === "LOGIN_REQUIRED") log("쿠팡 로그인이 필요합니다. npm run coupang:login을 한 번 실행해주세요.");
  else log(`오류: ${message}`);
  process.exitCode = 1;
} finally {
  await context.close();
}
