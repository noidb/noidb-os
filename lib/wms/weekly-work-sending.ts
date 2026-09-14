import { mutateWeeklyWorkspace, readWeeklyWorkspace } from "./weekly-work-store";
import { requireWeeklyRun, assertWeeklyReviewEligibility, weeklyReviewToken, weeklyVendorLines } from "./weekly-work-state";
import { mutatePickingWaveStore, readPickingWaveStore } from "./picking-wave/server-store";

/** Reserve immutable reviewed lines before adding a sent order to receiving.
 * If a write response is lost, a retry uses the same IDs/payload and never resets received quantities. */
export async function recordWeeklyVendorSent(runId: string, revision: number, vendorName: string,
  deps={readWeeklyWorkspace,mutateWeeklyWorkspace,readPickingWaveStore,mutatePickingWaveStore}, now=new Date().toISOString()) {
  const reserved=await deps.mutateWeeklyWorkspace(workspace=>{
    const run=requireWeeklyRun(workspace,runId,revision);
    if(run.sentVendors[vendorName])return run;
    if(!run.pendingVendorSends?.[vendorName] && (!run.generated?.vendors.includes(vendorName)||run.generated.reviewToken!==weeklyReviewToken(run)))throw new Error("현재 검토 내용으로 발주 파일을 먼저 생성해 주세요.");
    if(!run.pendingVendorSends?.[vendorName]) {
      assertWeeklyReviewEligibility(workspace,run);
      run.pendingVendorSends={...run.pendingVendorSends,[vendorName]:{at:now,reviewToken:weeklyReviewToken(run),lines:weeklyVendorLines(run,vendorName)}};
      run.revision++;run.updatedAt=now;
    }
    return run;
  });
  if(reserved.sentVendors[vendorName])return reserved;
  const pending=reserved.pendingVendorSends![vendorName];
  const draftId=`WEEKLY-${reserved.id}::${vendorName}`;
  const existing=await deps.readPickingWaveStore();
  if(existing.deletedVendorDraftIds[draftId])throw new Error("연결된 거래처 발주가 삭제되었습니다. 거래처 발주관리에서 확인해 주세요.");
  if(!existing.vendorOrderDrafts.some(d=>d.id===draftId)) {
    const saved=await deps.mutatePickingWaveStore({action:"migrate",snapshot:{vendorOrderDrafts:[{id:draftId,waveId:`WEEKLY-${reserved.id}`,vendorName,status:"sent",createdAt:reserved.snapshot.createdAt,updatedAt:reserved.snapshot.createdAt,sentAt:pending.at}],vendorOrderLines:pending.lines}});
    if(!saved.vendorOrderDrafts.some(d=>d.id===draftId)||pending.lines.some(l=>!saved.vendorOrderLines.some(s=>s.id===l.id)))throw new Error("거래처 발주 연결 결과를 확인하지 못했습니다. 같은 발송완료 버튼으로 연결을 다시 확인할 수 있습니다.");
  } else if(pending.lines.some(l=>!existing.vendorOrderLines.some(s=>s.id===l.id)))throw new Error("연결된 거래처 발주의 상품 일부가 변경되었습니다. 입고관리 목록을 확인해 주세요.");
  return deps.mutateWeeklyWorkspace(workspace=>{
    const run=requireWeeklyRun(workspace,runId);
    if(run.sentVendors[vendorName])return run;
    if(run.pendingVendorSends?.[vendorName]?.reviewToken!==pending.reviewToken)throw new Error("발송 연결 내용을 확인해 주세요.");
    run.sentVendors[vendorName]=pending.at;
    delete run.pendingVendorSends[vendorName];
    run.revision++;run.updatedAt=now;return run;
  });
}
