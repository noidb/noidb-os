import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildInboundDateResults } from "../lib/wms/inbound-results";
import { buildCouponWorkbook, buildMissingWorkbook } from "../lib/wms/inbound-output-files";

const inboundRows = [
  ["데이터세트", "발주번호", "입고예정일", "SKU ID", "상품명", "입고수량", "반출", "순입고", "최근입고일"],
  ["hash-a", "PO-A", "2026-09-04", "SKU-1", "상품 하나, 실버, 17호", "8", "0", "8", "2026/09/05"],
  ["hash-a", "PO-A", "2026-09-04", "SKU-2", "상품 둘, 골드", "1", "0", "1", "2026/09/05"],
];
const purchaseRows = [
  ["고유키", "발주번호", "SKU ID", "물류센터", "발주현황", "상품명", "바코드", "입고예정일", "발주일", "발주수량", "확정수량", "입고수량"],
  ["A-1", "PO-A", "SKU-1", "동탄1", "발주확정", "상품 하나, 실버, 17호", "R1", "2026-09-04", "2026-09-01", "12", "12", "0"],
  ["A-2", "PO-A", "SKU-2", "동탄1", "발주확정", "상품 둘, 골드", "R2", "2026-09-04", "2026-09-01", "1", "1", "0"],
];

async function run() {
  const results = buildInboundDateResults(inboundRows, purchaseRows, [{
    skuId: "SKU-1", productName: "제품DB 상품명", barcode: "R1", modelSku: "MODEL-1", modelName: "MODEL", imageUrl: "",
    category: "", gender: "", optionLabel: "", warehouseNumber: "", boxNumber: "", currentStock: "", currentStatus: "",
    costVatIncluded: "", vendorName: "", countryOfOrigin: "", productLink: "https://example.com/products/sku-1",
  }]);
  if (results.length !== 1) throw new Error("실제 입고일 그룹 수 불일치");
  const result = results[0];
  if (result.actualDate !== "2026-09-05" || result.purchaseOrderCount !== 1) throw new Error("실제 입고일/발주 집계 실패");
  if (result.receivedSkuCount !== 2 || result.missingSkuCount !== 1 || result.partialSkuCount !== 1) throw new Error("쿠폰·부분입고·미입고 집계 실패");
  if (!result.couponItems.some(item => item.skuId === "SKU-1") || !result.missingItems.some(item => item.skuId === "SKU-1")) throw new Error("부분입고 SKU 동시 포함 실패");

  const coupon = await buildCouponWorkbook(result.couponItems, 30);
  const couponZip = await JSZip.loadAsync(coupon);
  const couponXml = await couponZip.file("xl/worksheets/sheet1.xml")?.async("string") || "";
  if ((couponXml.match(/<x:row\b/g) || []).length !== 5 || !couponXml.includes(">정률<") || !couponXml.includes(">30<")) throw new Error("쿠폰 파일 행/할인율 검증 실패");

  const missing = await buildMissingWorkbook(result.missingItems);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(missing as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.columnCount !== 3 || sheet.rowCount !== 2 || sheet.getCell("A2").text !== "SKU-1" || sheet.getCell("C2").hyperlink !== "https://example.com/products/sku-1") throw new Error("미입고 파일 A/B/C열 및 제품링크 검증 실패");

  const original = await readFile("G:\\내 드라이브\\쿠팡데이터\\마케팅\\쿠폰관리\\쿠팡_프로모션쿠폰_30퍼센트_20260823.xlsx");
  const bundled = await readFile(path.join(process.cwd(), "lib", "wms", "data", "coupon-templates", "쿠팡_프로모션쿠폰_양식.xlsx"));
  const hash = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
  if (hash(original) !== hash(bundled)) throw new Error("쿠폰 양식 복사본이 G: 원본과 다름");
  const templateZip = await JSZip.loadAsync(bundled);
  const generatedEntries = Object.keys(couponZip.files).sort();
  const templateEntries = Object.keys(templateZip.files).sort();
  if (JSON.stringify(generatedEntries) !== JSON.stringify(templateEntries)) throw new Error("쿠폰 양식 패키지 구성 보존 실패");
  for (const entry of templateEntries.filter(name => name !== "xl/worksheets/sheet1.xml" && !templateZip.files[name].dir)) {
    const [before, after] = await Promise.all([
      templateZip.file(entry)!.async("nodebuffer"),
      couponZip.file(entry)!.async("nodebuffer"),
    ]);
    if (hash(before) !== hash(after)) throw new Error(`쿠폰 양식 비입력영역 변경: ${entry}`);
  }
  const templateSheetXml = await templateZip.file("xl/worksheets/sheet1.xml")?.async("string") || "";
  const withoutRows = (xml: string) => xml.replace(/<x:sheetData>[\s\S]*?<\/x:sheetData>/, "<x:sheetData></x:sheetData>");
  if (withoutRows(templateSheetXml) !== withoutRows(couponXml)) throw new Error("쿠폰 양식 시트의 입력행 밖 구조가 변경됨");
  const blankLinkWorkbook = new ExcelJS.Workbook();
  await blankLinkWorkbook.xlsx.load(await buildMissingWorkbook([
    { skuId: "SKU-NO-LINK", productName: "링크 없음", productLink: "" },
  ]) as unknown as ExcelJS.Buffer);
  const blankLinkSheet = blankLinkWorkbook.worksheets[0];
  assert.equal(blankLinkSheet?.getCell("A2").text, "SKU-NO-LINK", "링크가 없어도 미입고 SKU를 누락하지 않음");
  assert.equal(blankLinkSheet?.getCell("C2").text, "", "제품링크를 추측하지 않고 C열 빈칸 유지");
  const importRoute = await readFile(path.join(process.cwd(), "app", "api", "coupang-data", "route.ts"), "utf8");
  const syncRoute = await readFile(path.join(process.cwd(), "app", "api", "wms", "inbound-drive-sync", "route.ts"), "utf8");
  if (!/mode === "inboundHistory"/.test(importRoute) || !/analyzeInboundImportSafety/.test(importRoute)) throw new Error("입고 이벤트 안전 대조 또는 운영 dry-run 보호 없음");
  const inboundBlock = importRoute.slice(importRoute.indexOf('if (mode === "inboundHistory")'), importRoute.indexOf('if (mode === "poList")'));
  if (!/INBOUND_APPLY_LOCKED/.test(inboundBlock) || /importInboundSummary/.test(inboundBlock)) throw new Error("입고 신규 event-v2 쓰기가 읽기 전용으로 잠기지 않음");
  if (!/action === "apply"/.test(syncRoute) || !/status: 409/.test(syncRoute) || !/form\.set\("dryRun", "true"\)/.test(syncRoute)) throw new Error("입고 Drive sync apply 차단 또는 읽기 전용 preview 없음");
  if (/backupSheetWithinSpreadsheet|\bput\(|writeIndex/.test(syncRoute)) throw new Error("입고 Drive sync 잠금 상태에서 백업 또는 Drive index 쓰기 경로가 남음");

  console.log(JSON.stringify({ actualDate: result.actualDate, purchaseOrders: 1, couponSku: 2, partialSku: 1, missingSku: 1, couponRows: 5, missingColumns: 3, missingProductLinkColumnPreserved: true, missingSkuNotDroppedWhenLinkBlank: true, bundledTemplateMatchesDrive: true, couponTemplatePackagePreserved: true, productionDryRun: true, previewEventLock: true, inboundApplyLocked: true }, null, 2));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
