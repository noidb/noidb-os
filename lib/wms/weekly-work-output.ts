import { weeklyReviewCompletion } from "./weekly-work-progress";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildCouponWorkbook } from "./inbound-output-files";
import { buildDiscontinueWorkbook, loadDiscontinueTemplate, loadDiscontinueLetterTemplate, koreaDateParts } from "./discontinue-files";
import { buildDiscontinueLetterFromTemplate } from "./discontinue-letter";
import { assertWeeklyCurrentRules, assertWeeklyOrdersReady, weeklyReorderRows, weeklyReviewToken, weeklySelectedCoupons, weeklySelectedOrders, weeklyVendorLines } from "./weekly-work-state";
import { buildWeeklyReorderWorkbook, nextWeeklyReorderFriday } from "./weekly-reorder-files";
import { buildWeeklyAdvertisingFiles } from "./weekly-advertising-files";
import { assertWeeklyAdvertisingSelection, type WeeklyAdvertisingSelection } from "./weekly-advertising";
import type { WeeklyRun } from "./weekly-work-types";

export type WeeklyOutputKind = "all" | "coupon" | "vendors" | "discontinue" | "reorder" | "marketing";
export interface WeeklyOutput { fileName: string; base64: string; generated: NonNullable<WeeklyRun["generated"]> }
export function weeklyOutputKey(run: WeeklyRun, kind: WeeklyOutputKind, now = new Date(), advertisingToken?: string): string {
  const suffix = kind === "reorder" || kind === "all" ? `|${koreaDateParts(now).iso}|v2` : "|v1";
  const advertising = (kind === "marketing" || kind === "all") && weeklySelectedCoupons(run).length ? `|ads-v1:${advertisingToken || "unresolved"}` : "";
  const completed = run.couponUploadedAt || run.reorderRequestedAt || run.discontinueSubmittedAt || run.discontinueSubmittedSkuIds?.length || Object.keys(run.sentVendors).length ? "|completed-v1:" + JSON.stringify([run.couponUploadedAt, run.reorderRequestedAt, [...(run.discontinueSubmittedSkuIds || [])].sort(), run.discontinueSubmittedAt, Object.keys(run.sentVendors).sort()]) : "";
  return createHash("sha256").update(`${run.id}|${weeklyReviewToken(run)}|${kind}${suffix}${advertising}${completed}`).digest("hex");
}
export function safeWeeklyFileStem(value: string): string {
  const base = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0,80) || "거래처";
  return `${base}_${createHash("sha256").update(value).digest("hex").slice(0,6)}`;
}
async function buildVendorWorkbook(run: WeeklyRun, vendorName: string): Promise<Buffer> {
  const book=new ExcelJS.Workbook();
  book.creator="NOID-B";
  const sheet=book.addWorksheet("거래처 발주서");
  sheet.columns=[
    {header:"SKU ID",key:"skuId",width:17},{header:"상품명",key:"productName",width:52},
    {header:"옵션",key:"optionLabel",width:25},{header:"발주수량",key:"quantity",width:12},
    {header:"사진링크",key:"imageUrl",width:26},{header:"관련 쿠팡 발주번호",key:"po",width:28},
  ];
  sheet.insertRow(1,[`${vendorName} 발주서 · ${run.snapshot.period.startDate} ~ ${run.snapshot.period.endDate}`]);
  sheet.mergeCells("A1:F1"); sheet.getRow(1).height=30; sheet.getRow(1).font={bold:true,size:15};
  sheet.getRow(2).font={bold:true,color:{argb:"FFFFFFFF"}};
  sheet.getRow(2).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF526E78"}};
  sheet.views=[{state:"frozen",ySplit:2}];
  for(const line of weeklyVendorLines(run,vendorName)) {
    const imageUrl=line.imageUrl.startsWith("/") ? `https://noidb-os.vercel.app${line.imageUrl}` : line.imageUrl;
    const row=sheet.addRow({skuId:line.skuId,productName:line.productName,optionLabel:line.optionLabel,quantity:line.shortageQuantity,imageUrl,po:line.relatedPurchaseOrderNumbers.join(", ")});
    row.height=40; row.alignment={vertical:"middle",wrapText:true};
    row.getCell(1).numFmt="@"; row.getCell(4).numFmt="#,##0";
    if(imageUrl)row.getCell(5).value={text:"상품 사진 보기",hyperlink:imageUrl};
  }
  sheet.autoFilter={from:{row:2,column:1},to:{row:sheet.rowCount,column:6}};
  sheet.pageSetup={paperSize:9,orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0};
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function buildWeeklyOutput(run: WeeklyRun, kind: WeeklyOutputKind, now=new Date(), advertising?: WeeklyAdvertisingSelection): Promise<WeeklyOutput> {
  assertWeeklyCurrentRules(run);
  if(!["all","coupon","vendors","discontinue","reorder","marketing"].includes(kind))throw new Error("파일 종류를 확인해 주세요.");
  if(run.snapshot.blockers.length)throw new Error(run.snapshot.blockers.join(" "));
  const includeCoupons=kind==="all"||kind==="coupon"||kind==="marketing";
  const includeVendors=kind==="all"||kind==="vendors";
  const includeDiscontinue=kind==="all"||kind==="discontinue";
  const reorders=kind==="all"||kind==="reorder"?weeklyReorderRows(run):[];
  if(includeVendors)assertWeeklyOrdersReady(run);
  const vendors=includeVendors ? [...new Set(weeklySelectedOrders(run).map(r=>r.vendorName))].sort() : [];
  const discontinued=includeDiscontinue ? Object.values(run.reviews).filter(r=>r.decision==="discontinue" && !run.routedElsewhereSkuIds?.includes(r.skuId) && !weeklyReviewCompletion(run,r)).map(r=>({skuId:r.skuId,productName:run.snapshot.vendorItems.find(i=>i.skuId===r.skuId)!.productName})) : [];
  const coupons=includeCoupons?weeklySelectedCoupons(run):[];
  if((kind==="coupon"||kind==="marketing")&&!coupons.length)throw new Error("쿠폰을 적용할 SKU를 선택해 주세요.");
  const includeAdvertising=(kind==="all"||kind==="marketing")&&coupons.length>0;
  if(includeAdvertising)assertWeeklyAdvertisingSelection(run,advertising);
  if(!coupons.length&&!vendors.length&&!discontinued.length&&!reorders.length)throw new Error("선택한 종류에 생성할 파일이 없습니다.");
  const zip=new JSZip();
  const range=`${run.snapshot.period.startDate.replace(/-/g,"")}_${run.snapshot.period.endDate.replace(/-/g,"")}`;
  if(coupons.length)zip.file(`쿠폰발행_30퍼센트_${range}.xlsx`,await buildCouponWorkbook(coupons,30));
  const advertisingFiles=includeAdvertising?await buildWeeklyAdvertisingFiles(advertising!.optionIds):[];
  for(const file of advertisingFiles)zip.file(file.fileName,file.buffer);
  if(reorders.length)zip.file(`재발주요청/재발주요청_${koreaDateParts(now).compact}.xlsx`,await buildWeeklyReorderWorkbook(reorders,now));
  const vendorImages=[];
  for(const vendorName of vendors) {
    const baseName=`${safeWeeklyFileStem(vendorName)}_발주_${range}`;
    zip.file(`거래처발주/${baseName}.xlsx`,await buildVendorWorkbook(run,vendorName));
    vendorImages.push({vendorName,baseName,lines:weeklyVendorLines(run,vendorName)});
  }
  if(vendorImages.length)zip.file("내부자료/거래처이미지.json",JSON.stringify({runId:run.id,vendors:vendorImages}));
  if(discontinued.length) {
    const date=koreaDateParts(now);
    const [xlsx,pdf]=await Promise.all([
      loadDiscontinueTemplate().then(t=>buildDiscontinueWorkbook(t,discontinued,date.iso)),
      loadDiscontinueLetterTemplate().then(t=>buildDiscontinueLetterFromTemplate(t,discontinued,date.iso)),
    ]);
    zip.file(`단종신청/단종_SKU_${date.compact}.xlsx`,xlsx.buffer);
    zip.file(`단종신청/단종요청_공문_${date.compact}.pdf`,pdf);
  }
  const generated={at:now.toISOString(),reviewToken:weeklyReviewToken(run),couponCount:coupons.length,vendors,discontinueCount:discontinued.length,discontinueSkuIds:discontinued.map(item=>item.skuId),reorderCount:reorders.length,reorderRequestDate:reorders.length?nextWeeklyReorderFriday(now):undefined,advertisingCount:includeAdvertising?advertising!.optionIds.length:0,advertisingFiles:advertisingFiles.map(file=>file.fileName),advertisingToken:includeAdvertising?advertising!.token:undefined};
  const fileName=`주간업무_${range}_${kind==="all"?"전체":kind==="coupon"?"쿠폰":kind==="marketing"?"쿠폰광고":kind==="vendors"?"거래처발주":kind==="reorder"?"재발주요청":"단종신청"}.zip`;
  return {fileName,base64:await zip.generateAsync({type:"base64",compression:"DEFLATE"}),generated};
}
