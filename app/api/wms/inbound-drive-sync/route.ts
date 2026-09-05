import { NextRequest, NextResponse } from "next/server";
import { downloadOAuthDriveFile, listOAuthDriveFolderFiles, resolveDriveFolderPath } from "@/lib/wms/google-drive-oauth-reader";
import { DriveOAuthNotConfiguredError, DriveOAuthNotConnectedError, DriveOAuthTokenInvalidError } from "@/lib/wms/google-drive-oauth";
import { WmsGoogleNotConfiguredError } from "@/lib/wms/google-service-account";
import { hasNoidbActionSession, isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { readInboundWorkbook, loadInboundImportContext, inboundPreviewSummary } from "@/lib/wms/inbound-import-context";
import { applyInboundTransaction, InboundCommitUncertainError } from "@/lib/wms/inbound-import-transaction";
import { createInboundTransactionStore } from "@/lib/wms/inbound-import-store";
import type { InboundImportDataset } from "@/lib/wms/inbound-import-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
const FOLDER_PATH = ["쿠팡데이터", "입고상세내역 다운로드"];
// Performance cache only, never an import ledger. Files are read fresh before apply.
const parsedCache = new Map<string, InboundImportDataset>();

async function loadContext(fresh: boolean) {
  const folder = await resolveDriveFolderPath(FOLDER_PATH);
  const files = (await listOAuthDriveFolderFiles(folder)).filter(file => /\.xlsx$/i.test(file.name)).sort((a, b) => a.id.localeCompare(b.id));
  const datasets: InboundImportDataset[] = [];
  for (const file of files) {
    const key = JSON.stringify([file.id, file.name, file.modifiedTime, file.size]);
    let dataset = fresh ? undefined : parsedCache.get(key);
    if (!dataset) {
      dataset = await readInboundWorkbook(await downloadOAuthDriveFile(file.id), file.name);
      if (parsedCache.size >= 50) parsedCache.delete(parsedCache.keys().next().value!);
      parsedCache.set(key, dataset);
    }
    datasets.push(dataset);
  }
  const descriptors = files.map(({ id, name, modifiedTime, size }) => ({ id, name, modifiedTime, size }));
  return { context: await loadInboundImportContext(datasets, JSON.stringify(descriptors)), files: descriptors };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || !["preview", "apply"].includes(body.action)) return NextResponse.json({ success: false, error: "입고 확인 화면에서 다시 시도해 주세요." }, { status: 400 });
  if (body.action === "apply") {
    if (!isSameOriginActionRequest(request) || !hasNoidbActionSession(request)) return NextResponse.json({ success: false, error: "관리자 잠금 해제가 필요합니다." }, { status: 401 });
    if (body.confirmed !== true || typeof body.expectedPreviewToken !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedPreviewToken)) return NextResponse.json({ success: false, error: "변경 내용을 확인한 뒤 저장해 주세요." }, { status: 400 });
  }
  try {
    if (body.action === "apply") {
      const result = await applyInboundTransaction(body.expectedPreviewToken, async () => (await loadContext(true)).context, createInboundTransactionStore());
      return NextResponse.json({ success: true, backupCreated: true, ...result });
    }
    const { context, files } = await loadContext(false);
    return NextResponse.json({ success: true, canApply: context.incoming.length > 0 && !context.cellPreview.blockers.length,
      applied: false, backupCreated: false, newFiles: files, modifiedFiles: [], result: inboundPreviewSummary(context),
      message: context.incoming.length ? "변경할 셀을 확인한 뒤 저장해 주세요." : "모두 반영된 입고입니다. 추가로 저장할 내용이 없습니다." });
  } catch (error) {
    if (error instanceof DriveOAuthNotConfiguredError || error instanceof WmsGoogleNotConfiguredError) return NextResponse.json({ success: false, error: "입고파일과 제품DB 연결을 확인해 주세요." }, { status: 503 });
    if (error instanceof DriveOAuthNotConnectedError || error instanceof DriveOAuthTokenInvalidError) return NextResponse.json({ success: false, code: "DRIVE_RECONNECT_REQUIRED", error: "Google Drive를 다시 연결해 주세요." }, { status: 401 });
    if (error instanceof InboundCommitUncertainError) return NextResponse.json({ success: false, code: "INBOUND_RESULT_CHECK_REQUIRED", error: error.message }, { status: 409 });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "입고 확인에 실패했습니다." }, { status: 409 });
  }
}
