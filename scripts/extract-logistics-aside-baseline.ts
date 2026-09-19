import { writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

type Value = ExcelJS.CellValue;
const base = "G:\\내 드라이브\\쿠팡데이터\\마케팅\\쿠폰 광고 관리";
const sourcePaths = {
  tracking: path.join(base, "쉽먼트상태_추적.xlsx"),
  analysis: path.join(base, "입고상세 기간검색 20260817-20260917", "미입고SKU_분류대상_마감쉽먼트기준_20260818_20260917.xlsx"),
  completed: path.join(base, "초도입고_처리완료_SKU누적.xlsx"),
  excluded: path.join(base, "마케팅제외_SKU목록.xlsx"),
};
const outputPath = path.join(process.cwd(), "lib", "wms", "logistics-aside-baseline.json");

const text = (value: Value | undefined) => String(value ?? "").trim();
const numeric = (value: Value | undefined) => Number(String(value ?? "").replace(/,/g, ""));
const rowValues = (row: ExcelJS.Row) => row.values as Value[];
async function workbook(filePath: string) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(filePath);
  return book;
}

async function main() {
  const [trackingBook, analysisBook, completedBook, excludedBook] = await Promise.all(Object.values(sourcePaths).map(workbook));
  const summary = analysisBook.getWorksheet("쉽먼트요약");
  const detail = analysisBook.getWorksheet("미입고SKU");
  const excludedStatus = analysisBook.getWorksheet("제외_발주불가상태");
  if (!summary || !detail) throw new Error("Aside 분석 파일에서 쉽먼트요약 또는 미입고SKU 시트를 찾지 못했습니다.");

  const closedShipmentNumbers: string[] = [];
  const pendingTargets: { shipmentNumber: string; expectedDate: string; centerName: string; purchaseOrderNumbers: string[]; source: "aside" }[] = [];
  const unresolved: { kind: string; shipmentNumber?: string; purchaseOrderText?: string; skuId?: string; note: string }[] = [];
  for (let index = 2; index <= summary.rowCount; index += 1) {
    const values = rowValues(summary.getRow(index));
    const shipmentNumber = text(values[1]);
    const judgement = text(values[2]);
    const purchaseOrderText = text(values[4]);
    if (!shipmentNumber) continue;
    if (judgement.startsWith("마감-")) closedShipmentNumbers.push(shipmentNumber);
    else {
      const purchaseOrderNumbers = /^\d+$/.test(purchaseOrderText) ? [purchaseOrderText] : [];
      pendingTargets.push({ shipmentNumber, expectedDate: text(values[7]), centerName: text(values[6]), purchaseOrderNumbers, source: "aside" });
      if (!purchaseOrderNumbers.length) unresolved.push({ kind: "multiple_purchase_orders", shipmentNumber, purchaseOrderText, note: "Aside 쉽먼트요약의 복수 발주서 표기는 개별 PO로 추측 분배하지 않았습니다." });
    }
  }

  const handledLines: { shipmentNumber: string; purchaseOrderNumber: string; skuId: string; quantity: number; classification: string; note: string }[] = [];
  const handledClassifications = new Set(["단종", "거래처발주", "미납분재발주완료"]);
  for (let index = 2; index <= detail.rowCount; index += 1) {
    const values = rowValues(detail.getRow(index));
    const classification = text(values[1]);
    if (!handledClassifications.has(classification)) continue;
    const purchaseOrderNumber = text(values[8]);
    const shipmentNumber = text(values[9]);
    const skuId = text(values[2]);
    const quantity = numeric(values[6]) - numeric(values[7]);
    if (!shipmentNumber || !purchaseOrderNumber || !skuId || !Number.isSafeInteger(quantity) || quantity < 0) {
      unresolved.push({ kind: "handled_line_missing_identity", shipmentNumber, purchaseOrderText: purchaseOrderNumber, skuId, note: `미입고SKU ${index}행은 수량 또는 식별값이 불완전해 자동 연결하지 않았습니다.` });
      continue;
    }
    handledLines.push({ shipmentNumber, purchaseOrderNumber, skuId, quantity, classification, note: [text(values[15]), text(values[16])].filter(Boolean).join(" · ") });
  }
  if (excludedStatus) {
    for (let index = 2; index <= excludedStatus.rowCount; index += 1) {
      const values = rowValues(excludedStatus.getRow(index));
      const skuId = text(values[1]);
      const status = text(values[3]);
      const note = text(values[4]);
      if (skuId && status) unresolved.push({ kind: "purchase_unavailable_status", skuId, note: [status, note].filter(Boolean).join(" · ") });
    }
  }

  const completedMarketingSkuIds = [...new Set(Array.from({ length: completedBook.worksheets[0].rowCount - 1 }, (_, index) => text(rowValues(completedBook.worksheets[0].getRow(index + 2))[1])).filter(Boolean))].sort();
  const excludedMarketingSkuIds = [...new Set(Array.from({ length: excludedBook.worksheets[0].rowCount - 1 }, (_, index) => text(rowValues(excludedBook.worksheets[0].getRow(index + 2))[1])).filter(Boolean))].sort();
  const trackingIds = new Set(Array.from({ length: trackingBook.worksheets[0].rowCount - 1 }, (_, index) => text(rowValues(trackingBook.worksheets[0].getRow(index + 2))[1])).filter(Boolean));
  const pendingIds = new Set(pendingTargets.map(target => target.shipmentNumber));
  if (trackingIds.size !== pendingIds.size || [...trackingIds].some(id => !pendingIds.has(id))) throw new Error("Aside 추적 18건과 미마감 쉽먼트요약 대상이 일치하지 않습니다.");

  // The analysis workbook stops at September 17 EDD. Aside's confirmed shipping
  // record and the September 20 live Supplier Hub list include this later EDD.
  pendingTargets.push({ shipmentNumber: "50640740", expectedDate: "2026-09-22", centerName: "동탄1", purchaseOrderNumbers: ["142638543"], source: "aside" });

  const baseline = {
    closedShipmentNumbers: [...new Set(closedShipmentNumbers)].sort(),
    pendingTargets: pendingTargets.sort((left, right) => left.expectedDate.localeCompare(right.expectedDate) || left.centerName.localeCompare(right.centerName, "ko") || left.shipmentNumber.localeCompare(right.shipmentNumber)),
    completedMarketingSkuIds,
    excludedMarketingSkuIds,
    handledLines,
    unresolved,
    sources: {
      period: "20260818-20260917",
      closedShipmentCount: closedShipmentNumbers.length,
      pendingShipmentCount: pendingTargets.length,
      additionalPendingEvidence: [{ shipmentNumber: "50640740", record: "07_오늘작업기록_2026-09-17.md 13:35 및 14:45 확정 기록", verifiedAt: "2026-09-20", verifiedSource: "Supplier Hub 쉽먼트 실제 목록: 발송 완료, PO 142638543, 동탄1, 입고예정일 2026-09-22" }],
      completedMarketingSkuCount: completedMarketingSkuIds.length,
      excludedMarketingSkuCount: excludedMarketingSkuIds.length,
      files: sourcePaths,
    },
  };
  await writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ closed: baseline.closedShipmentNumbers.length, pending: baseline.pendingTargets.length, completedMarketingSkuIds: baseline.completedMarketingSkuIds.length, excludedMarketingSkuIds: baseline.excludedMarketingSkuIds.length, handledLines: baseline.handledLines.length, unresolved: baseline.unresolved.length }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
