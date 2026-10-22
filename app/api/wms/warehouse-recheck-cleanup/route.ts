import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { appendSheetRowsKeepingFormulas, backupSheetWithinSpreadsheet, deleteSheetRows, fetchSheetRows, fetchSpreadsheetTabs, updateSheetCells } from "@/lib/wms/google-sheets";
import { PRODUCT_DB_SHEET_NAME } from "@/lib/wms/product-catalog";
import { pickStorageTabTitle, planWarehouseRecheckCleanup, RECHECK_TAB, STORAGE_TAB } from "@/lib/wms/warehouse-recheck-cleanup";
import { mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const REREGISTRATION_TAB = "재등록SKU";

async function load() {
  const tabs = await fetchSpreadsheetTabs();
  const recheckTab = tabs.find(tab => tab.title === RECHECK_TAB);
  const storageTitle = pickStorageTabTitle(tabs.map(tab => tab.title));
  const storageTab = storageTitle ? tabs.find(tab => tab.title === storageTitle) : undefined;
  if (!recheckTab && !storageTab) throw new Error(`'${RECHECK_TAB}'·'${STORAGE_TAB}' 탭을 찾지 못했습니다.`);
  const reregTab = tabs.find(tab => tab.title === REREGISTRATION_TAB);
  const [recheck, productDb, storage, rereg] = await Promise.all([
    recheckTab ? fetchSheetRows(RECHECK_TAB, { valueRenderOption: "FORMULA" }) : Promise.resolve([] as string[][]),
    fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" }),
    storageTab ? fetchSheetRows(storageTab.title, { valueRenderOption: "FORMULA" }) : Promise.resolve(null),
    reregTab ? fetchSheetRows(REREGISTRATION_TAB) : Promise.resolve([] as string[][]),
  ]);
  // 재등록SKU 탭의 옛 SKU → 제품DB에서 보관으로(2026-10-22)
  const reregSkuCol = (rereg[0] || []).findIndex(header => String(header ?? "").replace(/\s+/g, "") === "SKUID");
  const reregisteredSkuIds = new Set(reregSkuCol < 0 ? [] : rereg.slice(1).map(row => String(row[reregSkuCol] ?? "").trim()).filter(id => /^\d{1,20}$/.test(id)));
  const productDbTab = tabs.find(tab => tab.title === PRODUCT_DB_SHEET_NAME);
  return { recheckTab, storageTab, productDbTab, plan: planWarehouseRecheckCleanup(recheck, productDb, storage, reregisteredSkuIds, (rereg[0] || []).map(value => String(value ?? "")),
    new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)), reregTab };
}
const summary = (plan: Awaited<ReturnType<typeof load>>["plan"]) => ({ token: plan.token, pending: plan.pending, moves: plan.moves, unknown: plan.unknown, problems: plan.problems });

/** 미리보기: 시트는 바꾸지 않는다. */
export async function GET() {
  try { return NextResponse.json({ ok: true, ...summary((await load()).plan) }, { headers }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "구글시트를 읽지 못했습니다." }, { status: 400, headers }); }
}

/** 실행: 미리보기 뒤에 탭이 바뀌지 않았을 때만, 백업을 남기고 옮긴다. */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "사이트 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as { token?: unknown };
    const { recheckTab, storageTab, productDbTab, plan, reregTab } = await load();
    if (plan.problems.length) throw new Error(plan.problems.join(" "));
    if (body.token !== plan.token) throw new Error("미리보기 뒤에 구글시트가 바뀌었습니다. 다시 미리보기 후 실행해 주세요.");
    if (!plan.moves.length) throw new Error("옮길 행이 없습니다.");
    // 1) 백업
    const backups = plan.deleteRows.length && recheckTab ? [await backupSheetWithinSpreadsheet(RECHECK_TAB)] : [];
    if (plan.appendStorage.length || plan.deleteStorageRows.length) backups.push(await backupSheetWithinSpreadsheet(storageTab!.title));
    if (plan.appendProductDb.length || plan.clearStatusRows.length || plan.deleteProductDbRows.length) backups.push(await backupSheetWithinSpreadsheet(PRODUCT_DB_SHEET_NAME));
    if (plan.appendRereg.length && !reregTab) throw new Error("'재등록SKU' 탭을 찾지 못했습니다.");
    if (plan.appendRereg.length) backups.push(await backupSheetWithinSpreadsheet(REREGISTRATION_TAB));
    if (plan.deleteProductDbRows.length && !productDbTab) throw new Error("제품DB 탭을 찾지 못했습니다.");
    // 2) 제품DB 기존 행 현재상태 비우기(행 번호가 바뀌기 전에) → 3) 보관·제품DB에서 옮겨 갈 행 지우기 → 4) 붙이기 → 5) 창고재확인에서 지우기
    if (plan.clearStatusRows.length) {
      const pdHeaders = (await fetchSheetRows(PRODUCT_DB_SHEET_NAME)).at(0) || [];
      const statusCol = pdHeaders.findIndex(header => String(header).replace(/\s+/g, "") === "현재상태") + 1;
      await updateSheetCells(PRODUCT_DB_SHEET_NAME, plan.clearStatusRows.map(row => ({ row, col: statusCol, value: "" })));
    }
    if (plan.deleteStorageRows.length && storageTab) await deleteSheetRows(storageTab.sheetId, plan.deleteStorageRows);
    if (plan.deleteProductDbRows.length && productDbTab) await deleteSheetRows(productDbTab.sheetId, plan.deleteProductDbRows);
    if (plan.appendStorage.length && storageTab) await appendSheetRowsKeepingFormulas(storageTab.title, plan.appendStorage);
    // 현재상태에 '재등록'이 들어간 제품DB 행 → 재등록SKU 탭에도 한 줄(2026-10-22)
    if (plan.appendRereg.length) await appendSheetRowsKeepingFormulas(REREGISTRATION_TAB, plan.appendRereg);
    await appendSheetRowsKeepingFormulas(PRODUCT_DB_SHEET_NAME, plan.appendProductDb);
    if (recheckTab) await deleteSheetRows(recheckTab.sheetId, plan.deleteRows);
    // 5) 발주가능상태가 정상이 아닌 제품DB 이동 SKU → 단종해제 대상
    const release = plan.moves.filter(move => move.release && /^\d{1,20}$/.test(move.skuId));
    if (release.length) await mutateWeeklyWorkspace(workspace => {
      const checks = { ...(workspace.supplyStatusChecks || {}) };
      const at = new Date().toISOString();
      for (const move of release) checks[move.skuId] = { decision: "release", productName: move.productName, at };
      workspace.supplyStatusChecks = checks;
    });
    return NextResponse.json({ ok: true, moved: plan.moves.length, toRereg: plan.appendRereg.length, toStorage: plan.appendStorage.length, fromStorage: plan.deleteStorageRows.length, fromProductDb: plan.deleteProductDbRows.length, toProductDb: plan.appendProductDb.length + plan.clearStatusRows.length,
      release: release.length, unknown: plan.unknown.length, pending: plan.pending, backups: backups.map(item => item.sheetName) }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "구글시트 정리를 하지 못했습니다." }, { status: 400, headers });
  }
}
