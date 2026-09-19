import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import asideBaseline from "@/lib/wms/logistics-aside-baseline.json";
import { readInvoiceGroupStore } from "@/lib/wms/invoice-group/server-store";
import { buildLogisticsReceiptBoard, collectDispatchReceiptTargets, mergeLogisticsReceiptTargets, type LogisticsAsideBaseline } from "@/lib/wms/logistics-receipts";
import { activeMarketingExclusionKeys, completeLogisticsFollowUp, completeVendorReceiptOrigins, generateLogisticsFollowUp, logisticsFollowUpResponse, logisticsFollowUpToken, queueMarketing, setMarketingExclusion } from "@/lib/wms/logistics-follow-up";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { mutateWeeklyWorkspace, readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { readWeeklyFile, saveWeeklyFile } from "@/lib/wms/weekly-work-files";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { readWeeklyDiscontinueQueue, syncWeeklyDiscontinueQueue } from "@/lib/wms/weekly-discontinue-queue";
import { collectFollowUpDiscontinue, completeFollowUpDiscontinue, previewFollowUpDiscontinue, LOGISTICS_DISCONTINUE_STATUS_RUN_ID } from "@/lib/wms/logistics-discontinue-adapter";
import { completeStatusRequests, listStatusRequests } from "@/lib/wms/vendor-order-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };
function baseline(): LogisticsAsideBaseline {
  const raw = asideBaseline as typeof asideBaseline & { source?: unknown; sources?: unknown };
  return { closedShipmentNumbers: raw.closedShipmentNumbers, pendingTargets: raw.pendingTargets as LogisticsAsideBaseline["pendingTargets"], completedMarketingSkuIds: raw.completedMarketingSkuIds as string[], excludedMarketingSkuIds: raw.excludedMarketingSkuIds as string[], handledLines: raw.handledLines as LogisticsAsideBaseline["handledLines"], source: raw.source ?? raw.sources ?? {} };
}
async function current() {
  const [workspace, invoices] = await Promise.all([readWeeklyWorkspace(), readInvoiceGroupStore()]);
  const base = baseline(); const targets = mergeLogisticsReceiptTargets(collectDispatchReceiptTargets(invoices.groups), base.pendingTargets).filter(target => !base.closedShipmentNumbers.includes(target.shipmentNumber));
  return { workspace, targets, board: buildLogisticsReceiptBoard({ targets, snapshot: workspace.logisticsReceipts, baseline: base, routes: workspace.logisticsReceiptRoutes, excludedMarketingLineKeys: [...activeMarketingExclusionKeys(workspace)] }) };
}
export async function GET(request: Request) {
  try {
    const value = await current();
    const outputKey = new URL(request.url).searchParams.get("outputKey");
    if (!outputKey) {
      const source = await readWeeklyDiscontinueQueue();
      const response = logisticsFollowUpResponse(value.workspace, value.board);
      response.queues.discontinue.push(...previewFollowUpDiscontinue(source).map(row => ({ lineKey: `status::${row.requestId}`, sourceLineKey: row.requestId, shipmentNumber: "", boxId: "", purchaseOrderNumber: row.purchaseOrderNumber, skuId: row.skuId, productName: row.productName, barcode: "", kind: "shortage" as const, sourceFingerprint: row.requestId, state: "ready" as const })));
      return NextResponse.json(response, { headers });
    }
    if (!/^[a-f0-9]{64}$/.test(outputKey)) return NextResponse.json({ ok: false, error: "파일 주소를 확인해 주세요." }, { status: 400, headers });
    const proof = value.workspace.logisticsFollowUp?.proofs?.find(item => item.outputKey === outputKey);
    const saved = proof && await readWeeklyFile(`output-${outputKey}.json`);
    if (!proof || !saved) return NextResponse.json({ ok: false, error: "저장된 생성 파일을 찾지 못했습니다." }, { status: 404, headers });
    const parsed = JSON.parse(saved.toString("utf8")) as { proof?: unknown; digest?: unknown; output?: { fileName?: unknown; base64?: unknown; generated?: unknown } };
    const { completedAt: _completedAt, ...immutableProof } = proof;
    if (JSON.stringify(parsed.proof) !== JSON.stringify(immutableProof)) throw new Error("저장된 생성 파일 증빙이 변경되었습니다.");
    const digest = createHash("sha256").update(JSON.stringify([parsed.output?.fileName, parsed.output?.base64, parsed.output?.generated, parsed.proof])).digest("hex");
    if (parsed.digest !== digest || typeof parsed.output?.fileName !== "string" || typeof parsed.output?.base64 !== "string") throw new Error("저장된 생성 파일 근거를 확인하지 못했습니다.");
    return NextResponse.json({ ok: true, fileName: parsed.output.fileName, base64: parsed.output.base64, outputKey, proof }, { headers });
  }
  catch { return NextResponse.json({ ok: false, error: "후속 처리 목록을 불러오지 못했습니다." }, { status: 500, headers }); }
}
export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "허용되지 않은 요청입니다." }, { status: 403, headers });
    const body = await request.json() as Record<string, unknown>;
    const value = await current(); let response: unknown;
    let completedStatusRun: typeof value.workspace.runs[number] | undefined;
    let completedVendorLineKeys: string[] = [];
    if (body.action === "generate") {
      if (body.token !== logisticsFollowUpToken(value.workspace, value.board) || body.expectedCollectedAt !== value.board.collectedAt) throw new Error("목록이 변경됐습니다. 새로고침 후 다시 확인해 주세요.");
      const prepared = structuredClone(value.workspace);
      if (body.kind === "discontinue") {
        const source = await readWeeklyDiscontinueQueue();
        const pending = previewFollowUpDiscontinue(source);
        if (pending.length) collectFollowUpDiscontinue(prepared, source);
        else {
          const run = prepared.runs.find(run => run.id === LOGISTICS_DISCONTINUE_STATUS_RUN_ID);
          if (run) { syncWeeklyDiscontinueQueue(run, source); run.discontinueQueueRequestIds = {}; }
        }
          const skuIds = new Set(pending.map(row => row.skuId));
          const exclusions = [...(prepared.logisticsFollowUp?.exclusions || [])];
          for (const run of prepared.runs.filter(run => run.snapshot.couponItems.length && run.logisticsReceiptLine && skuIds.has(run.logisticsReceiptLine.skuId) && !run.couponUploadedAt && !run.completedAt)) {
            const lineKey = run.logisticsReceiptLine!.lineKey;
            if (!exclusions.some(item => item.lineKey === lineKey && !item.restoredAt)) exclusions.push({ lineKey, sourceFingerprint: prepared.logisticsReceiptRoutes?.[lineKey]?.sourceFingerprint || "", skuId: run.logisticsReceiptLine!.skuId, at: new Date().toISOString() });
          }
          prepared.logisticsFollowUp = { ...prepared.logisticsFollowUp, exclusions, blockedMarketingSkuIds: [...new Set([...(prepared.logisticsFollowUp?.blockedMarketingSkuIds || []), ...skuIds])].sort() };
      }
      // Prepare status links in memory; persist them together with the complete, immutable file proof.
      const generated = await generateLogisticsFollowUp(prepared, value.board, { ...body, token: logisticsFollowUpToken(prepared, value.board) } as any);
      await saveWeeklyFile(`output-${generated.outputKey}.json`, Buffer.from(JSON.stringify(generated.saved)));
      response = await mutateWeeklyWorkspace(workspace => {
        if (logisticsFollowUpToken(workspace, value.board) !== body.token) throw new Error("파일 생성 중 목록이 변경됐습니다. 새로고침 후 다시 생성해 주세요.");
        if (body.kind === "discontinue") {
          const statusRun = prepared.runs.find(run => run.id === LOGISTICS_DISCONTINUE_STATUS_RUN_ID);
          if (statusRun) {
            const existing = workspace.runs.findIndex(run => run.id === statusRun.id);
            if (existing < 0) workspace.runs.push(statusRun); else workspace.runs[existing] = statusRun;
          }
          workspace.logisticsFollowUp = prepared.logisticsFollowUp;
        }
        workspace.logisticsFollowUp = { ...workspace.logisticsFollowUp, proofs: [...(workspace.logisticsFollowUp?.proofs || []).filter(item => item.outputKey !== generated.outputKey), generated.proof] };
        return { fileName: generated.fileName, base64: generated.base64, outputKey: generated.outputKey, proof: generated.proof, followUp: logisticsFollowUpResponse(workspace, value.board) };
      });
    } else {
      if (body.action === "complete") {
        if (typeof body.outputKey !== "string" || !/^[a-f0-9]{64}$/.test(body.outputKey)) throw new Error("완료할 생성 파일을 확인해 주세요.");
        const saved = await readWeeklyFile(`output-${body.outputKey}.json`);
        if (!saved) throw new Error("생성한 파일 근거를 찾지 못했습니다. 파일을 다시 생성해 주세요.");
        try {
          const parsed = JSON.parse(saved.toString("utf8")) as { proof?: unknown; digest?: unknown; output?: { fileName?: unknown; base64?: unknown; generated?: unknown } };
          const currentProof = value.workspace.logisticsFollowUp?.proofs?.find(item => item.outputKey === body.outputKey && item.kind === body.kind);
          const { completedAt: _completedAt, ...immutableProof } = currentProof || {};
          if (!currentProof || JSON.stringify(parsed.proof) !== JSON.stringify(immutableProof)) throw new Error("생성 파일 증빙이 현재 완료 대상과 일치하지 않습니다.");
          const digest = createHash("sha256").update(JSON.stringify([parsed.output?.fileName, parsed.output?.base64, parsed.output?.generated, parsed.proof])).digest("hex");
          if (parsed.digest !== digest) throw new Error("생성 파일 근거가 변경되었습니다. 파일을 다시 생성해 주세요.");
          body.validatedSavedProof = currentProof;
          if (currentProof.kind === "discontinue" && currentProof.requestIds?.length && !currentProof.completedAt) {
            // Validate the user action and every receipt source before changing external status records.
            completeLogisticsFollowUp(structuredClone(value.workspace), value.board, body as any);
            const cloned = structuredClone(value.workspace);
            const picking = await readPickingWaveStore();
            completedVendorLineKeys = picking.vendorOrderLines.filter(line => line.sentResolution?.kind === "discontinue" && currentProof.requestIds!.includes(line.sentResolution.destinationId))
              .flatMap(line => line.shipmentReceiptDetails?.map(detail => detail.lineKey) || []);
            await completeFollowUpDiscontinue(cloned, { requestIds: currentProof.requestIds, skuIds: currentProof.requestSkuIds || [], reviewToken: currentProof.discontinueReviewToken || "" }, { completeStatusRequests, listStatusRequests });
            completedStatusRun = cloned.runs.find(run => run.id === LOGISTICS_DISCONTINUE_STATUS_RUN_ID);
          }
        } catch (error) { if (error instanceof Error) throw error; throw new Error("생성한 파일 근거를 확인하지 못했습니다. 파일을 다시 생성해 주세요."); }
      }
      response = await mutateWeeklyWorkspace(workspace => {
        if (body.action === "queueMarketing") return queueMarketing(workspace, value.targets, value.board, body as any);
        if (body.action === "excludeMarketing") return setMarketingExclusion(workspace, value.board, body as any, false);
        if (body.action === "restoreMarketing") return setMarketingExclusion(workspace, value.board, body as any, true);
        if (body.action === "complete") {
          const proof = completeLogisticsFollowUp(workspace, value.board, body as any);
          const statusRun = completedStatusRun;
          if (statusRun) { const target = workspace.runs.find(run => run.id === statusRun.id); if (!target) throw new Error("단종 대기 업무를 찾지 못했습니다."); Object.assign(target, statusRun); }
          completeVendorReceiptOrigins(workspace, completedVendorLineKeys);
          return { proof, followUp: logisticsFollowUpResponse(workspace, value.board) };
        }
        throw new Error("후속 처리 동작을 확인해 주세요.");
      });
    }
    return NextResponse.json({ ok: true, ...response as object }, { headers });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "후속 처리를 저장하지 못했습니다." }, { status: 400, headers }); }
}
