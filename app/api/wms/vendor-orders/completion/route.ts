import { assertVendorOrderCandidatesFresh, assertVendorQueueExport, assertVendorDraftsFresh } from "@/lib/wms/vendor-order/queue-write-guard";
import { NextRequest, NextResponse } from "next/server";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { loadVendorOrderCompletionScope } from "@/lib/wms/vendor-order-completion";
import { vendorOrderCompletionExclusions, partialVendorOrderCompletions } from "@/lib/wms/vendor-order/completion";
import type { VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function check(waveId: string, candidates?: VendorOrderDraftLine[], expectedUpdatedAtByLineId?: Record<string, string | null>, expectedDraftUpdatedAtById?: Record<string, string | null>) {
  const [store, scope] = await Promise.all([readPickingWaveStore(), loadVendorOrderCompletionScope()]);
  assertVendorDraftsFresh(store, expectedDraftUpdatedAtById);
  if (candidates) assertVendorOrderCandidatesFresh(store, candidates, expectedUpdatedAtByLineId);
  const saved = store.vendorOrderLines.filter(line => !waveId || line.waveId === waveId);
  const lines = candidates ? candidates.map(line => { const prior = saved.find(item => item.id === line.id); return prior?.orderExclusion ? { ...line, orderExclusion: prior.orderExclusion } : line; }) : saved;
  const exclusions = vendorOrderCompletionExclusions(lines, store.vendorOrderDrafts, scope);
  const partialCompletions = partialVendorOrderCompletions(lines, store.vendorOrderDrafts, scope);
  const excludedLineIds = exclusions.map(row => row.lineId), excluded = new Set(excludedLineIds);
  assertVendorQueueExport(store, waveId, lines.filter(line => !excluded.has(line.id)));
  return NextResponse.json({ success: true, scope, checkedAt: scope.checkedAt, excludedLineIds, exclusions, partialCompletions, lines: lines.filter(line => !excluded.has(line.id)) }, { headers });
}
export async function GET(request: NextRequest) { try { return await check(request.nextUrl.searchParams.get("waveId") || ""); } catch (e) { return failure(e); } }
/** Read-only preflight for edited, not-yet-saved lines. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.lines) || body.lines.length > 10000 || body.lines.some((line: VendorOrderDraftLine) => !line || typeof line.id !== "string" || typeof line.skuId !== "string" || !Array.isArray(line.relatedPurchaseOrderNumbers))) throw new Error("발주할 상품을 다시 확인해 주세요.");
    const expected = body.expectedUpdatedAtByLineId;
    if (expected !== undefined && (!expected || typeof expected !== "object" || Array.isArray(expected) || Object.values(expected).some(value => value !== null && typeof value !== "string"))) throw new Error("발주 목록의 저장 시각을 다시 확인해 주세요.");
    const expectedDrafts = body.expectedDraftUpdatedAtById;
    if (expectedDrafts !== undefined && (!expectedDrafts || typeof expectedDrafts !== "object" || Array.isArray(expectedDrafts) || Object.values(expectedDrafts).some(value => value !== null && typeof value !== "string"))) throw new Error("발주서의 저장 시각을 다시 확인해 주세요.");
    return await check(String(body.waveId || ""), body.lines, expected, expectedDrafts);
  } catch (e) { return failure(e); }
}
function failure(e: unknown) { return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "완료된 상품을 확인하지 못했습니다. 다시 확인 후 발주해 주세요." }, { status: 409, headers }); }
