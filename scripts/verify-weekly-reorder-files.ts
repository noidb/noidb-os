import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { buildWeeklyReorderWorkbook, nextWeeklyReorderFriday, type WeeklyReorderRow } from "../lib/wms/weekly-reorder-files";

const TEMPLATE = path.join(process.cwd(), "lib/wms/templates/Report_Issue_Reorder.xlsx");
const SHEET = "xl/worksheets/sheet1.xml";
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const rowXml = (xml: string, row: number) => xml.match(new RegExp(`<row\\b[^>]*\\br="${row}"[^>]*>[\\s\\S]*?<\\/row>`))?.[0];
const cellXml = (xml: string, cell: string) => xml.match(new RegExp(`<c\\b[^>]*\\br="${cell}"[^>]*>[\\s\\S]*?<\\/c>`))?.[0] || "";
const textValue = (xml: string, cell: string) => cellXml(xml, cell).match(/<t>([\s\S]*?)<\/t>/)?.[1];

async function run() {
  const dates = [
    ["2026-09-07T03:00:00Z", "2026-09-11"], // Monday
    ["2026-09-10T14:59:59Z", "2026-09-11"], // Thursday 23:59:59 KST
    ["2026-09-10T15:00:00Z", "2026-09-18"], // Friday 00:00 KST
    ["2026-09-11T14:59:59Z", "2026-09-18"], // Friday 23:59:59 KST
    ["2026-09-11T15:00:00Z", "2026-09-18"], // Saturday KST
    ["2026-12-31T14:59:59Z", "2027-01-01"],
    ["2026-12-31T15:00:00Z", "2027-01-08"],
    ["2024-02-29T00:00:00Z", "2024-03-01"],
  ];
  dates.forEach(([input, expected]) => assert.equal(nextWeeklyReorderFriday(new Date(input)), expected, input));
  assert.throws(() => nextWeeklyReorderFriday(new Date("invalid")));

  const rows: WeeklyReorderRow[] = [
    { purchaseOrderNumber: "140000001", skuId: "39000001", productName: "검증상품 A", shortageQuantity: 1 },
    { purchaseOrderNumber: "140000002", skuId: "39000001", productName: "검증상품 A", shortageQuantity: 13 },
    { purchaseOrderNumber: "140000001", skuId: "0039000002", productName: "검증상품 B", shortageQuantity: 6 },
  ];
  const beforeInput = JSON.stringify(rows);
  const original = await readFile(TEMPLATE);
  const output = await buildWeeklyReorderWorkbook(rows, new Date("2026-09-07T03:00:00Z"));
  assert.equal(JSON.stringify(rows), beforeInput, "caller rows stay unchanged");
  assert.equal(sha(await readFile(TEMPLATE)), sha(original), "bundled source stays unchanged");
  const [sourceZip, outputZip] = await Promise.all([JSZip.loadAsync(original), JSZip.loadAsync(output)]);
  assert.deepEqual(Object.keys(outputZip.files).sort(), Object.keys(sourceZip.files).sort(), "same archive parts");
  for (const [name, part] of Object.entries(sourceZip.files)) {
    if (part.dir || name === SHEET) continue;
    assert.equal(sha(await outputZip.file(name)!.async("nodebuffer")), sha(await part.async("nodebuffer")), `${name} unchanged`);
  }
  const sourceXml = await sourceZip.file(SHEET)!.async("string");
  const outputXml = await outputZip.file(SHEET)!.async("string");
  const stripData = (xml: string) => xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, "<sheetData/>")
    .replace(/<dimension\b[^>]*\/>/, "<dimension/>");
  assert.equal(stripData(outputXml), stripData(sourceXml), "all sheet metadata, widths and validations preserved");
  assert.equal(rowXml(outputXml, 1), rowXml(sourceXml, 1), "Coupang template identification untouched");
  assert.equal(rowXml(outputXml, 2), rowXml(sourceXml, 2), "headers untouched");
  assert.equal((outputXml.match(/<row\b/g) || []).length, 5, "one row per PO + SKU");
  assert.match(outputXml, /<dimension ref="A1:G5"\/>/);
  rows.forEach((row, index) => {
    const n = index + 3;
    assert.equal(textValue(outputXml, `A${n}`), row.skuId, "SKU identifier preserved as text");
    assert.equal(textValue(outputXml, `B${n}`), row.purchaseOrderNumber, "original PO preserved as text");
    assert.match(cellXml(outputXml, `C${n}`), new RegExp(`t="n"><v>${row.shortageQuantity}<\\/v>`), "shortage exact, never rounded to a vendor pack");
    assert.equal(textValue(outputXml, `D${n}`), "2026-09-11");
    assert.equal(textValue(outputXml, `E${n}`), "업체실수로 인한 출고누락");
    assert.equal(textValue(outputXml, `F${n}`), "");
    assert.equal(textValue(outputXml, `G${n}`), "");
    for (let c = 0; c < 7; c += 1) {
      const col = String.fromCharCode(65 + c);
      assert.equal(cellXml(outputXml, `${col}${n}`).match(/\bs="(\d+)"/)?.[1], cellXml(sourceXml, `${col}3`).match(/\bs="(\d+)"/)?.[1], "template input style preserved");
    }
  });
  await assert.rejects(buildWeeklyReorderWorkbook([]));
  await assert.rejects(buildWeeklyReorderWorkbook([rows[0], rows[0]]), /중복/);
  await assert.rejects(buildWeeklyReorderWorkbook([rows[0], { ...rows[0], skuId: ` ${rows[0].skuId} ` }]), /중복/);
  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "2"]) {
    await assert.rejects(buildWeeklyReorderWorkbook([{ ...rows[0], shortageQuantity: invalid as number }]), /수량/);
  }
  for (const field of ["purchaseOrderNumber", "skuId"] as const) {
    for (const invalid of ["", " ", "=1+1", "12 34", "abc", "1".repeat(21)]) {
      await assert.rejects(buildWeeklyReorderWorkbook([{ ...rows[0], [field]: invalid }]), /발주번호 또는 SKU ID/);
    }
  }
  if (process.argv.includes("--write-example")) {
    const folder = path.join(process.cwd(), "tmp/weekly-ad-template-20260907");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "재발주_검증예시.xlsx"), output);
  }
  console.log(JSON.stringify({ verified: true, rows: rows.length, dateBoundaryCases: dates.length, exactShortageQuantities: rows.map(row => row.shortageQuantity), sourceUnchanged: true, templatePartsPreserved: true }));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
