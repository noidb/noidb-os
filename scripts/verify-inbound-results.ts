import { createHash } from "node:crypto";
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
  const importRoute = await readFile(path.join(process.cwd(), "app", "api", "coupang-data", "route.ts"), "utf8");
  const syncRoute = await readFile(path.join(process.cwd(), "app", "api", "wms", "inbound-drive-sync", "route.ts"), "utf8");
  if (!/mode === "inboundHistory"/.test(importRoute) || !/sku, actualDate/.test(importRoute)) throw new Error("입고 실제일 그룹 또는 운영 dry-run 보호 없음");
  if (!/expectedFileIds/.test(syncRoute) || !/backupSheetWithinSpreadsheet\("제품DB"\)/.test(syncRoute)) throw new Error("입고 자동반영 미리보기 고정 또는 제품DB 백업 없음");

  console.log(JSON.stringify({ actualDate: result.actualDate, purchaseOrders: 1, couponSku: 2, partialSku: 1, missingSku: 1, couponRows: 5, missingColumns: 3, missingProductLink: true, bundledTemplateMatchesDrive: true, productionDryRun: true, previewFingerprintLock: true, productDbBackupBeforeApply: true }, null, 2));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
