import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { appendSheetRowsKeepingFormulas, backupSheetWithinSpreadsheet, deleteSheetRows, ensureSheetColumns, fetchSheetRows, fetchSpreadsheetTabs, updateSheetCells } from "@/lib/wms/google-sheets";
import { PRODUCT_DB_SHEET_NAME } from "@/lib/wms/product-catalog";
import { pickStorageTabTitle, planWarehouseRecheckCleanup, RECHECK_TAB, STORAGE_TAB } from "@/lib/wms/warehouse-recheck-cleanup";
import { mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { collectRetiredSkuIds } from "@/lib/wms/sku-retirement";
import { LEGACY_REREGISTRATION_TAB, OTHER_REREGISTRATION_TAB, STOPPED_TAB, pickLowPerformanceTab } from "@/lib/wms/retired-sku-tabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

async function load() {
  const tabs = await fetchSpreadsheetTabs();
  const recheckTab = tabs.find(tab => tab.title === RECHECK_TAB);
  const storageTitle = pickStorageTabTitle(tabs.map(tab => tab.title));
  const storageTab = storageTitle ? tabs.find(tab => tab.title === storageTitle) : undefined;
  if (!recheckTab && !storageTab) throw new Error(`'${RECHECK_TAB}'·'${STORAGE_TAB}' 탭을 찾지 못했습니다.`);
  // 실적저조SKU(예전 이름 재등록SKU)·그 외 재등록SKU·판매중지SKU(2026-10-22 탭 나눔)
  const REREGISTRATION_TAB = pickLowPerformanceTab(tabs.map(tab => tab.title)) || LEGACY_REREGISTRATION_TAB;
  const reregTab = tabs.find(tab => tab.title === REREGISTRATION_TAB);
  const otherTab = tabs.find(tab => tab.title === OTHER_REREGISTRATION_TAB);
  const stoppedTab = tabs.find(tab => tab.title === STOPPED_TAB);
  const [recheck, productDb, storage, rereg, history, otherRows, stoppedRows] = await Promise.all([
    recheckTab ? fetchSheetRows(RECHECK_TAB, { valueRenderOption: "FORMULA" }) : Promise.resolve([] as string[][]),
    fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" }),
    storageTab ? fetchSheetRows(storageTab.title, { valueRenderOption: "FORMULA" }) : Promise.resolve(null),
    reregTab ? fetchSheetRows(REREGISTRATION_TAB, { valueRenderOption: "FORMULA" }) : Promise.resolve([] as string[][]),
    tabs.some(tab => tab.title === "_SKU교체이력") ? fetchSheetRows("_SKU교체이력") : Promise.resolve([] as string[][]),
    otherTab ? fetchSheetRows(OTHER_REREGISTRATION_TAB, { valueRenderOption: "FORMULA" }) : Promise.resolve(null),
    stoppedTab ? fetchSheetRows(STOPPED_TAB, { valueRenderOption: "FORMULA" }) : Promise.resolve(null),
  ]);
  // 재등록으로 교체된 옛 SKU(_SKU교체이력): 재고가 있어도 제품DB로 되돌리지 않는다(2026-10-22 사용자 확정).
  const retiredSkuIds = collectRetiredSkuIds(history);
  // 재등록SKU 탭의 옛 SKU → 제품DB에서 보관으로(2026-10-22)
  const reregSkuCol = (rereg[0] || []).findIndex(header => String(header ?? "").replace(/\s+/g, "") === "SKUID");
  const reregisteredSkuIds = new Set(reregSkuCol < 0 ? [] : rereg.slice(1).map(row => String(row[reregSkuCol] ?? "").trim()).filter(id => /^\d{1,20}$/.test(id)));
  const productDbTab = tabs.find(tab => tab.title === PRODUCT_DB_SHEET_NAME);
  return { recheckTab, storageTab, productDbTab, plan: planWarehouseRecheckCleanup(recheck, productDb, storage, reregisteredSkuIds, (rereg[0] || []).map(value => String(value ?? "")),
    new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10), reregTab ? rereg : undefined, retiredSkuIds, { other: otherRows, stopped: stoppedRows }), reregTab, REREGISTRATION_TAB };
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
    const { recheckTab, storageTab, productDbTab, plan, reregTab, REREGISTRATION_TAB } = await load();
    if (plan.problems.length) throw new Error(plan.problems.join(" "));
    if (body.token !== plan.token) throw new Error("미리보기 뒤에 구글시트가 바뀌었습니다. 다시 미리보기 후 실행해 주세요.");
    if (!plan.moves.length) throw new Error("옮길 행이 없습니다.");
    // 0) 재등록SKU 탭 형식 맞추기(이번 실행은 이것만): 백업 → 기존 줄 지우기 → 제목줄 → 전체 정보 줄 붙이기
    if (plan.reregRebuild && reregTab) {
      const rb = plan.reregRebuild;
      const backup = await backupSheetWithinSpreadsheet(REREGISTRATION_TAB);
      const current = await fetchSheetRows(REREGISTRATION_TAB);
      await deleteSheetRows(reregTab.sheetId, current.slice(1).map((_, index) => index + 2));
      await ensureSheetColumns(reregTab.sheetId, reregTab.gridColumnCount || 0, rb.headers.length);
      await updateSheetCells(REREGISTRATION_TAB, [...rb.headers.map((value, index) => ({ row: 1, col: index + 1, value })),
        ...Array.from({ length: Math.max(0, (current[0] || []).length - rb.headers.length) }, (_, index) => ({ row: 1, col: rb.headers.length + index + 1, value: "" }))]);
      await appendSheetRowsKeepingFormulas(REREGISTRATION_TAB, rb.rows);
      return NextResponse.json({ ok: true, reregRebuilt: rb.rows.length, reregFilled: rb.filled, moved: 0, toRereg: 0, toStorage: 0, fromStorage: 0, fromProductDb: 0, toProductDb: 0, release: 0, unknown: 0, pending: 0, backups: [backup.sheetName] }, { headers });
    }
    // 1) 백업
    const backups = plan.deleteRows.length && recheckTab ? [await backupSheetWithinSpreadsheet(RECHECK_TAB)] : [];
    if (plan.appendStorage.length || plan.deleteStorageRows.length) backups.push(await backupSheetWithinSpreadsheet(storageTab!.title));
    if (plan.appendProductDb.length || plan.clearStatusRows.length || plan.deleteProductDbRows.length) backups.push(await backupSheetWithinSpreadsheet(PRODUCT_DB_SHEET_NAME));
    if (plan.appendRereg.length && !reregTab) throw new Error("'실적저조SKU' 탭을 찾지 못했습니다.");
    if (plan.appendOtherRereg.length) backups.push(await backupSheetWithinSpreadsheet(OTHER_REREGISTRATION_TAB));
    if (plan.appendStopped.length) backups.push(await backupSheetWithinSpreadsheet(STOPPED_TAB));
    if (plan.appendRereg.length || plan.deleteReregRows.length) backups.push(await backupSheetWithinSpreadsheet(REREGISTRATION_TAB));
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
    // 재등록SKU에서 비관리SKU로 옮긴 줄(단종·중복등록)은 재등록SKU 탭에서 지운다 — 비관리SKU에 붙인 뒤에.
    if (plan.deleteReregRows.length && reregTab) await deleteSheetRows(reregTab.sheetId, plan.deleteReregRows);
    // 현재상태에 '재등록'이 들어간 제품DB 행 → 재등록SKU 탭에도 한 줄(2026-10-22)
    if (plan.appendRereg.length) await appendSheetRowsKeepingFormulas(REREGISTRATION_TAB, plan.appendRereg);
    if (plan.appendOtherRereg.length) await appendSheetRowsKeepingFormulas(OTHER_REREGISTRATION_TAB, plan.appendOtherRereg);
    if (plan.appendStopped.length) await appendSheetRowsKeepingFormulas(STOPPED_TAB, plan.appendStopped);
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
    return NextResponse.json({ ok: true, moved: plan.moves.length, toRereg: plan.appendRereg.length, toOtherRereg: plan.appendOtherRereg.length, toStopped: plan.appendStopped.length, fromRereg: plan.deleteReregRows.length, toStorage: plan.appendStorage.length, fromStorage: plan.deleteStorageRows.length, fromProductDb: plan.deleteProductDbRows.length, toProductDb: plan.appendProductDb.length + plan.clearStatusRows.length,
      release: release.length, unknown: plan.unknown.length, pending: plan.pending, backups: backups.map(item => item.sheetName) }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "구글시트 정리를 하지 못했습니다." }, { status: 400, headers });
  }
}
