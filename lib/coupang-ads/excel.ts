import type { CoupangAdsAnalyzedItem, CoupangAdsParsedSnapshot } from "./types";

const columns = [
  "상품명", "Vendor Item ID", "상태", "노출수", "클릭수", "CTR", "광고비", "광고주문수", "광고매출", "ROAS",
  "클릭→주문 전환율", "품절", "BuyBox", "추천상태", "추천이유", "데이터 부족", "목표 허용 광고비",
];

function values(item: CoupangAdsAnalyzedItem): Array<string | number> {
  return [
    item.itemName, item.vendorItemId, item.status, item.impressions, item.clicks, item.ctr / 100, item.adCost,
    item.adOrders, item.adSales, item.roas / 100, item.conversionRate / 100, item.outOfStock ? "예" : "아니오",
    item.buyBoxRole, item.recommendationLabel, item.recommendationReason, item.sampleWarning ? "데이터 부족" : "충분", item.targetAllowedAdCost,
  ];
}

export async function buildCoupangAdsWorkbook(parsed: CoupangAdsParsedSnapshot) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NOID-B OS";
  workbook.created = new Date();
  const sheets: Array<[string, CoupangAdsAnalyzedItem[]]> = [
    ["전체", parsed.items],
    ["집중광고", parsed.items.filter(item => item.recommendation === "focus")],
    ["확대테스트", parsed.items.filter(item => item.recommendation === "expand")],
    ["관찰", parsed.items.filter(item => item.recommendation === "observe")],
    ["중지후보", parsed.items.filter(item => item.recommendation === "stop")],
  ];
  for (const [name, items] of sheets) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(columns);
    items.forEach(item => sheet.addRow(values(item)));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF536D78" } };
    sheet.autoFilter = { from: "A1", to: `Q${Math.max(1, items.length + 1)}` };
    [6, 10, 11].forEach(column => { sheet.getColumn(column).numFmt = "0.00%"; });
    [4, 5, 7, 8, 9, 17].forEach(column => { sheet.getColumn(column).numFmt = "#,##0"; });
    const widths = [48, 18, 16, 12, 10, 10, 13, 12, 14, 12, 16, 9, 12, 16, 48, 13, 18];
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.eachRow(row => { row.alignment = { vertical: "middle", wrapText: true }; });
  }
  return workbook;
}

export async function exportCoupangAdsAnalysis(parsed: CoupangAdsParsedSnapshot): Promise<void> {
  const workbook = await buildCoupangAdsWorkbook(parsed);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `쿠팡광고분석_${parsed.startDate.replace(/-/g, "")}_${parsed.endDate.replace(/-/g, "")}.xlsx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 2000);
}
