import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { InboundResultItem } from "./inbound-results";

const COUPON_TEMPLATE = path.join(process.cwd(), "lib", "wms", "data", "coupon-templates", "쿠팡_프로모션쿠폰_양식.xlsx");

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function couponRow(row: number, item: InboundResultItem, discountRate: number, first: boolean): string {
  const styles = first ? [12, 3, 14, 3] : [13, 2, 15, 2];
  return `<x:row r="${row}"><x:c r="A${row}" s="${styles[0]}" t="str"><x:v>${xmlEscape(item.skuId)}</x:v></x:c><x:c r="B${row}" s="${styles[1]}" t="str"><x:v>정률</x:v></x:c><x:c r="C${row}" s="${styles[2]}" t="n"><x:v>${discountRate}</x:v></x:c><x:c r="D${row}" s="${styles[3]}"/></x:row>`;
}

function templateRow(xml: string, row: number): string {
  const match = xml.match(new RegExp(`<x:row\\s+[^>]*r="${row}"[^>]*>[\\s\\S]*?<\\/x:row>`));
  if (!match) throw new Error(`쿠폰 양식 ${row}행을 찾지 못했습니다.`);
  return match[0];
}

export async function buildCouponWorkbook(items: InboundResultItem[], discountRate: number): Promise<Buffer> {
  if (!items.length) throw new Error("쿠폰 발행 대상 SKU가 없습니다.");
  if (!Number.isInteger(discountRate) || discountRate < 1 || discountRate > 100) throw new Error("할인율은 1~100 사이의 정수로 입력해 주세요.");
  const zip = await JSZip.loadAsync(await readFile(COUPON_TEMPLATE));
  const sheet = zip.file("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("쿠폰 양식 입력 시트를 찾지 못했습니다.");
  const xml = await sheet.async("string");
  const fixed = `${templateRow(xml, 1)}${templateRow(xml, 2)}${templateRow(xml, 3)}`;
  const rows = items.map((item, index) => couponRow(index + 4, item, discountRate, index === 0)).join("");
  zip.file("xl/worksheets/sheet1.xml", xml.replace(/<x:sheetData>[\s\S]*?<\/x:sheetData>/, `<x:sheetData>${fixed}${rows}</x:sheetData>`));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function buildMissingWorkbook(items: InboundResultItem[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("미입고 SKU");
  sheet.columns = [
    { header: "SKU ID", key: "skuId", width: 18 },
    { header: "상품명", key: "productName", width: 70 },
    { header: "제품링크", key: "productLink", width: 45 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F6258" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const item of items) {
    const row = sheet.addRow({ skuId: item.skuId, productName: item.productName, productLink: item.productLink });
    if (item.productLink) {
      row.getCell(3).value = { text: item.productLink, hyperlink: item.productLink };
      row.getCell(3).font = { color: { argb: "FF2F6D4F" }, underline: true };
    }
  }
  sheet.getColumn(1).numFmt = "@";
  sheet.getColumn(2).alignment = { wrapText: true, vertical: "middle" };
  sheet.getColumn(3).alignment = { wrapText: true, vertical: "middle" };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
