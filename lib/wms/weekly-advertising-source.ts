import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchSheetRows } from "./google-sheets";
import { resolveWeeklyAdvertising, type VerifiedWeeklyAdvertisingOption, type WeeklyAdvertisingSelection } from "./weekly-advertising";
import { weeklySelectedCoupons } from "./weekly-work-state";
import type { WeeklyRun } from "./weekly-work-types";

/** Current Sheet cells are read fresh for preview, output and acknowledgment. */
export async function loadWeeklyAdvertisingSelection(run: WeeklyRun): Promise<WeeklyAdvertisingSelection> {
  const skuIds = weeklySelectedCoupons(run).map(item => item.skuId);
  if (!skuIds.length) return resolveWeeklyAdvertising([], []);
  const [rows, fallback] = await Promise.all([
    fetchSheetRows("제품DB", { valueRenderOption: "FORMULA" }),
    readFile(path.join(process.cwd(), "lib", "wms", "data", "weekly-advertising-option-ids.json"), "utf8").then(text => JSON.parse(text) as VerifiedWeeklyAdvertisingOption[])
      .catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }),
  ]);
  if (!Array.isArray(fallback)) throw new Error("광고 옵션 ID 연결 자료를 확인해 주세요.");
  return resolveWeeklyAdvertising(skuIds, rows, fallback);
}
