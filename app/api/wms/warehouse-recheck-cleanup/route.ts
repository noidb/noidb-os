import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { appendSheetRowsKeepingFormulas, backupSheetWithinSpreadsheet, deleteSheetRows, fetchSheetRows, fetchSpreadsheetTabs, updateSheetCells } from "@/lib/wms/google-sheets";
import { PRODUCT_DB_SHEET_NAME } from "@/lib/wms/product-catalog";
import { planWarehouseRecheckCleanup, RECHECK_TAB, STORAGE_TAB } from "@/lib/wms/warehouse-recheck-cleanup";
import { mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

async function load() {
  const tabs = await fetchSpreadsheetTabs();
  const recheckTab = tabs.find(tab => tab.title === RECHECK_TAB);
  if (!recheckTab) throw new Error(`'${RECHECK_TAB}' 탭을 찾지 못했습니다.`);
  const storageTab = tabs.find(tab => tab.title === STORAGE_TAB);
  const [recheck, productDb, storage] = await Promise.all([
    fetchSheetRows(RECHECK_TAB, { valueRenderOption: "FORMULA" }),
    fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" }),
    storageTab ? fetchSheetRows(STORAGE_TAB, { valueRenderOption: "FORMULA" }) : Promise.resolve(null),
  ]);
  return { recheckTab, plan: planWarehouseRecheckCleanup(recheck, productDb, storage) };
}
const summary = (plan: Awaited<ReturnType<typeof load>>["plan"]) => ({ token: plan.token, pending: plan.pending, moves: plan.moves, unknown: plan.unknown, problems: plan.problems });

/** 미리보기: 시트는 바꾸지 않는다. */
export async function GET() {
  try { return NextResponse.json({ ok: true, ...summary((await load()).plan) }, { headers }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "창고재확인 탭을 읽지 못했습니다." }, { status: 400, headers }); }
}

/** 실행: 미리보기 뒤에 탭이 바뀌지 않았을 때만, 백업을 남기고 옮긴다. */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "사이트 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as { token?: unknown };
    const { recheckTab, plan } = await load();
    if (plan.problems.length) throw new Error(plan.problems.join(" "));
    if (body.token !== plan.token) throw new Error("미리보기 뒤에 창고재확인 탭이 바뀌었습니다. 다시 미리보기 후 실행해 주세요.");
    if (!plan.moves.length) throw new Error("옮길 행이 없습니다.");
    // 1) 백업
    const backups = [await backupSheetWithinSpreadsheet(RECHECK_TAB)];
    if (plan.appendStorage.length) backups.push(await backupSheetWithinSpreadsheet(STORAGE_TAB));
    if (plan.appendProductDb.length || plan.clearStatusRows.length) backups.push(await backupSheetWithinSpreadsheet(PRODUCT_DB_SHEET_NAME));
    // 2) 옮기기 → 3) 제품DB 기존 행 현재상태 비우기 → 4) 창고재확인에서 지우기
    await appendSheetRowsKeepingFormulas(STORAGE_TAB, plan.appendStorage);
    await appendSheetRowsKeepingFormulas(PRODUCT_DB_SHEET_NAME, plan.appendProductDb);
    if (plan.clearStatusRows.length) {
      const pdHeaders = (await fetchSheetRows(PRODUCT_DB_SHEET_NAME)).at(0) || [];
      const statusCol = pdHeaders.findIndex(header => String(header).replace(/\s+/g, "") === "현재상태") + 1;
      await updateSheetCells(PRODUCT_DB_SHEET_NAME, plan.clearStatusRows.map(row => ({ row, col: statusCol, value: "" })));
    }
    await deleteSheetRows(recheckTab.sheetId, plan.deleteRows);
    // 5) 발주가능상태가 정상이 아닌 제품DB 이동 SKU → 단종해제 대상
    const release = plan.moves.filter(move => move.release && /^\d{1,20}$/.test(move.skuId));
    if (release.length) await mutateWeeklyWorkspace(workspace => {
      const checks = { ...(workspace.supplyStatusChecks || {}) };
      const at = new Date().toISOString();
      for (const move of release) checks[move.skuId] = { decision: "release", productName: move.productName, at };
      workspace.supplyStatusChecks = checks;
    });
    return NextResponse.json({ ok: true, moved: plan.moves.length, toStorage: plan.appendStorage.length, toProductDb: plan.appendProductDb.length + plan.clearStatusRows.length,
      release: release.length, unknown: plan.unknown.length, pending: plan.pending, backups: backups.map(item => item.sheetName) }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "창고재확인 정리를 하지 못했습니다." }, { status: 400, headers });
  }
}
