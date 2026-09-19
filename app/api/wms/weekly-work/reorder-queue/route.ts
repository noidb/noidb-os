import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { readWeeklyWorkspace, mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { savedWeeklyMaterial } from "@/lib/wms/saved-weekly-material";
import { readWeeklyFile, saveWeeklyFile } from "@/lib/wms/weekly-work-files";
import { buildWeeklyReorderWorkbook, nextWeeklyReorderFriday, type WeeklyReorderRow } from "@/lib/wms/weekly-reorder-files";
import { pendingReorderQueue, currentReorderRows, reorderPair, reorderDigest } from "@/lib/wms/weekly-reorder-queue";
import { logisticsReorderLines } from "@/lib/wms/logistics-reorder-material";
import { completeVendorReceiptOrigins } from "@/lib/wms/logistics-follow-up";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store" };
const failure = (error: unknown) => NextResponse.json({ success: false, error: error instanceof Error ? error.message : "재발주 목록을 확인하지 못했습니다." }, { status: 409, headers });
export async function GET() {
  try {
    const workspace = await readWeeklyWorkspace();
    const queue = pendingReorderQueue(workspace);
    const rows = await refresh(queue);
    const date = nextWeeklyReorderFriday();
    const outputKey = reorderDigest([queue.token, rows, date]);
    const saved = await readWeeklyFile(`output-${outputKey}.json`);
    return NextResponse.json({ success: true, ...queue, outputKey: saved ? outputKey : "" }, { headers });
  }
  catch (error) { return failure(error); }
}
async function refresh(queue: ReturnType<typeof pendingReorderQueue>) {
  const workspace = await readWeeklyWorkspace();
  const current = pendingReorderQueue(workspace);
  if (current.token !== queue.token) throw new Error("수집 자료 또는 재발주 대기 목록이 바뀌었습니다. 목록을 새로고침해 주세요.");
  const logisticsPairs = new Set(current.logisticsPairs);
  return queue.rows.map(row => {
    if (logisticsPairs.has(reorderPair(row))) return row;
    const { snapshot, item } = savedWeeklyMaterial(workspace, row.skuId, [row.purchaseOrderNumber]);
    return currentReorderRows([row], { ...snapshot, vendorItems: [item] })[0];
  });
}
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ success: false, error: "재발주 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json();
    if (!["generate", "complete", "discardIssue"].includes(body.action)) throw new Error("처리할 작업을 확인해 주세요.");
    const queue = pendingReorderQueue(await readWeeklyWorkspace());
    if (body.token !== queue.token) throw new Error("다른 화면에서 대기 목록이 바뀌었습니다. 목록을 새로고침해 주세요.");
    if (body.action === "discardIssue") {
      const issue = queue.issues.find(row => row.skuId === String(body.skuId) && JSON.stringify([...row.purchaseOrderNumbers].sort()) === JSON.stringify([...(body.purchaseOrderNumbers || [])].map(String).sort()));
      if (!issue) throw new Error("삭제할 수량 확인 항목이 현재 목록에 없습니다. 목록을 새로고침해 주세요.");
      await mutateWeeklyWorkspace(current => {
        const at = new Date().toISOString();
        for (const run of current.runs) {
          const match = run.reviews[issue.skuId]?.decision === "reorder" && (run.snapshot.vendorItems.find(item => item.skuId === issue.skuId)?.relatedPurchaseOrderNumbers || []).some(po => issue.purchaseOrderNumbers.includes(po));
          if (match) { run.reorderDiscardedIssues = [...(run.reorderDiscardedIssues || []), { skuId: issue.skuId, purchaseOrderNumbers: issue.purchaseOrderNumbers }]; run.updatedAt = at; run.revision++; }
        }
      });
      return NextResponse.json({ success: true }, { headers });
    }
    if (!queue.rows.length) throw new Error("재발주 요청 대기 항목이 없습니다.");
    const rows = await refresh(queue);
    const date = nextWeeklyReorderFriday();
    const outputKey = reorderDigest([queue.token, rows, date]);
    if (body.action === "generate") {
      const buffer = await buildWeeklyReorderWorkbook(rows);
      const checked = await refresh(queue);
      if (reorderDigest(rows) !== reorderDigest(checked) || nextWeeklyReorderFriday() !== date) throw new Error("파일 생성 중 미납수량 또는 요청일이 바뀌었습니다. 다시 받아 주세요.");
      if (pendingReorderQueue(await readWeeklyWorkspace()).token !== queue.token) throw new Error("파일 생성 중 대기 목록이 바뀌었습니다. 목록을 새로고침해 주세요.");
      await saveWeeklyFile(`output-${outputKey}.json`, Buffer.from(JSON.stringify({ rows, token: queue.token, date })));
      return NextResponse.json({ success: true, rows, token: queue.token, outputKey, fileName: `재발주요청_${date}.xlsx`, base64: buffer.toString("base64") }, { headers });
    }
    if (body.outputKey !== outputKey) throw new Error("미납수량 또는 요청일이 변경됐습니다. 현재 파일을 다시 받아 요청한 뒤 완료해 주세요.");
    const saved = await readWeeklyFile(`output-${outputKey}.json`);
    if (!saved || reorderDigest(JSON.parse(saved.toString())) !== reorderDigest({ rows, token: queue.token, date })) throw new Error("전체 재발주 파일을 먼저 받아 주세요.");
    await mutateWeeklyWorkspace(workspace => {
      const current = pendingReorderQueue(workspace);
      if (current.token !== queue.token) throw new Error("다른 화면에서 목록이 변경됐습니다. 완료 상태를 다시 확인해 주세요.");
      const at = new Date().toISOString();
      for (const source of queue.sources) {
        const run = workspace.runs.find(run => run.id === source.id)!;
        const pairs = new Set(source.pairs);
        const requested = new Map((run.reorderRequestedLines || []).map(row=>[reorderPair(row),row]));
        const sourceRows = source.kind === "logistics" ? source.rows! : rows.filter(row=>pairs.has(reorderPair(row)));
        for (const { purchaseOrderNumber, skuId, shortageQuantity } of sourceRows) {
          const pair = reorderPair({purchaseOrderNumber,skuId});
          requested.set(pair, { purchaseOrderNumber, skuId, shortageQuantity: shortageQuantity + (source.kind === "logistics" ? requested.get(pair)?.shortageQuantity || 0 : 0) });
        }
        run.reorderRequestedLines = [...requested.values()];
        if (source.kind === "logistics" && source.lineKey) run.reorderRequestedShipmentLineKeys = [...new Set([...(run.reorderRequestedShipmentLineKeys || []), source.lineKey])];
        if (source.hasIssues || logisticsReorderLines(run).some(line => !run.reorderRequestedShipmentLineKeys?.includes(line.lineKey))) run.reorderQueuePartialRequestedAt = at;
        else { run.reorderRequestedAt = at; run.reorderQueuePartialRequestedAt = undefined; }
        run.updatedAt = at; run.revision++;
      }
      completeVendorReceiptOrigins(workspace, queue.sources.flatMap(source => source.kind === "logistics" && source.lineKey ? [source.lineKey] : []), at);
    });
    return NextResponse.json({ success: true }, { headers });
  } catch (error) { return failure(error); }
}
