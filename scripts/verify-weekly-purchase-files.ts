import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { parseWeeklyPurchaseFile, resolveWeeklyPurchaseDocuments, type WeeklyPurchaseFileSource } from "../lib/wms/weekly-purchase-files";

const oldSource: WeeklyPurchaseFileSource = { name: "발주서_이전.zip", modifiedTime: "2026-09-07T01:00:00.000Z", id: "old" };
const newSource: WeeklyPurchaseFileSource = { name: "발주서_최신.zip", modifiedTime: "2026-09-08T01:00:00.000Z", id: "new" };
type Item = { sku: string; ordered: number; confirmed: number | null; received: number | null };
const original: Item[] = [{ sku: "39136021", ordered: 5, confirmed: 4, received: 1 }, { sku: "39323459", ordered: 2, confirmed: 0, received: 0 }];

async function workbook(items = original, edit?: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Sheet1");
  sheet.getCell("A1").value = "발주서 No.140245699";
  const headers = ["No.", "상품코드", "상품명/옵션/BARCODE", "매입유형", "발주유형", "물류센터", "발주수량", "업체납품가능수량", "입고수량"];
  headers.forEach((header, index) => { sheet.getCell(20, index + 1).value = header; sheet.mergeCells(20, index + 1, 21, index + 1); });
  items.forEach((item, index) => {
    const row = 22 + index * 2;
    sheet.getCell(row, 1).value = String(index + 1);
    sheet.getCell(row, 2).value = item.sku;
    sheet.getCell(row, 3).value = `상품 ${item.sku}, 실버, one size`;
    sheet.getCell(row + 1, 3).value = `R${item.sku}`;
    sheet.getCell(row, 7).value = item.ordered;
    sheet.getCell(row, 8).value = item.confirmed;
    sheet.getCell(row, 9).value = item.received;
    for (const column of [1, 2, 7, 8, 9]) sheet.mergeCells(row, column, row + 1, column);
  });
  const total = 22 + items.length * 2;
  sheet.getCell(total, 1).value = "합계";
  sheet.mergeCells(total, 1, total, 6);
  for (const [column, key] of [[7, "ordered"], [8, "confirmed"], [9, "received"]] as const) {
    sheet.getCell(total, column).value = items.every(item => item[key] !== null) ? items.reduce((sum, item) => sum + (item[key] ?? 0), 0) : null;
  }
  edit?.(sheet);
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function zipFile(buffer: Buffer, source = newSource, name = "PO_140245699.xlsx") {
  const zip = new JSZip(); zip.file(`발주서/${name}`, buffer);
  return parseWeeklyPurchaseFile(await zip.generateAsync({ type: "nodebuffer" }), source);
}
async function invalid(edit: (sheet: ExcelJS.Worksheet) => void, expectedCode = "ITEM_INVALID") {
  const parsed = await zipFile(await workbook(original, edit));
  assert.equal(parsed.documents.length, 0);
  assert.ok(parsed.errors.some(error => error.code === expectedCode), JSON.stringify(parsed.errors));
  assert.equal(resolveWeeklyPurchaseDocuments([parsed], ["140245699"]).resolvedRows.length, 0);
  return parsed;
}

async function main() {
  const old = await zipFile(await workbook(), oldSource);
  assert.deepEqual(old.errors, []);
  assert.equal(old.documents.length, 1);
  assert.deepEqual(old.documents[0].rows.map(row => [row.skuId, row.orderedQuantity, row.confirmedQuantity, row.receivedQuantity, row.sourceRow]), [
    ["39136021", 5, 4, 1, 22], ["39323459", 2, 0, 0, 24],
  ]);
  assert.equal(old.documents[0].rows[0].sourceEntryFile, "발주서/PO_140245699.xlsx");
  assert.equal(old.documents[0].rows[0].sourceContainerFile, oldSource.name);
  assert.equal(old.documents[0].rows[0].optionName, "실버, one size");
  assert.equal(old.documents[0].rows[1].confirmedQuantity, 0, "Explicit zero must remain zero instead of falling back to ordered quantity");

  const blank = await invalid(sheet => { sheet.getCell("H22").value = null; });
  assert.ok(blank.errors.some(error => error.sourceRow === 22 && error.skuId === "39136021" && error.message.includes("비어")));
  assert.equal(resolveWeeklyPurchaseDocuments([old, blank], ["140245699"]).resolvedRows.length, 0, "A newer unknown confirmed quantity must block an older complete document");
  await invalid(sheet => { sheet.getCell("H22").value = { formula: "G22", result: 5 }; });
  await invalid(sheet => { sheet.getCell("I22").value = { formula: "1+1", result: 2 }; });
  await invalid(sheet => { sheet.getCell("B22").value = { formula: '"39136021"', result: "39136021" }; });
  await invalid(sheet => { sheet.getCell("H22").value = 1.5; });
  await invalid(sheet => { sheet.getCell("H22").value = -1; });
  await invalid(sheet => { sheet.getCell("G22").value = null; });
  await invalid(sheet => { sheet.getCell("B22").value = "0"; });
  await invalid(sheet => { sheet.getCell("B22").value = "39136021x"; });
  await invalid(sheet => { sheet.getCell("B24").value = "39136021"; });
  await invalid(sheet => { sheet.getCell("A24").value = "3"; });
  await invalid(sheet => { sheet.getCell("G26").value = 999; }, "TOTAL_INVALID");
  await invalid(sheet => { sheet.getCell("H26").value = { formula: "SUM(H22:H25)", result: 4 }; }, "TOTAL_INVALID");
  await invalid(sheet => { sheet.getCell("A26").value = null; }, "TOTAL_MISSING");
  await invalid(sheet => { sheet.unMergeCells("H22:H23"); }, "ITEM_ROW_AMBIGUOUS");
  const mismatch = await zipFile(await workbook(), newSource, "PO_999999999.xlsx");
  assert.deepEqual(new Set(mismatch.errors.map(error => error.purchaseOrderNumber)), new Set(["999999999", "140245699"]));
  assert.ok(mismatch.errors.every(error => error.code === "PO_IDENTITY"));

  const updated = await zipFile(await workbook([{ sku: "39136021", ordered: 5, confirmed: 3, received: 3 }]), newSource);
  const resolved = resolveWeeklyPurchaseDocuments([updated, old], ["140245699", "140245699", "999"]);
  assert.deepEqual(resolved.errors.map(error => [error.purchaseOrderNumber, error.code]), [["999", "PO_SOURCE_MISSING"]], "An absent original PO is unresolved, not proof of a shortage");
  assert.equal(resolved.resolvedRows.length, 1, "Latest full document owns the SKU set; deleted older rows must not leak in");
  assert.equal(resolved.resolvedRows[0].confirmedQuantity, 3);
  assert.equal(resolved.resolvedRows[0].receivedQuantity, 3);
  assert.deepEqual(resolved.sourceFiles, [newSource]);
  const sameTimeDifferent = await zipFile(await workbook(), { ...newSource, name: "발주서_동시각.zip", id: "simultaneous" });
  const conflict = resolveWeeklyPurchaseDocuments([updated, sameTimeDifferent, old], ["140245699"]);
  assert.equal(conflict.resolvedRows.length, 0);
  assert.ok(conflict.errors.every(error => error.code === "LATEST_CONFLICT"));
  assert.deepEqual(resolveWeeklyPurchaseDocuments([sameTimeDifferent, old, updated], ["140245699"]), conflict, "Concurrent parsing order must not change validation or source tokens");
  const matching = await zipFile(await workbook([{ sku: "39136021", ordered: 5, confirmed: 3, received: 3 }]), { ...newSource, name: "발주서_동일.zip", id: "identical" });
  assert.equal(resolveWeeklyPurchaseDocuments([matching, updated], ["140245699"]).resolvedRows.length, 1);
  const sameSkuDifferentI = await zipFile(await workbook([{ sku: "39136021", ordered: 5, confirmed: 3, received: 2 }]), { ...newSource, name: "발주서_입고차이.zip" });
  assert.equal(resolveWeeklyPurchaseDocuments([updated, sameSkuDifferentI], ["140245699"]).resolvedRows.length, 0);
  const staleBad = await invalid(sheet => { sheet.getCell("H22").value = null; });
  staleBad.errors = staleBad.errors.map(error => ({ ...error, sourceModifiedTime: "2026-09-06T00:00:00.000Z" }));
  assert.equal(resolveWeeklyPurchaseDocuments([staleBad, old], ["140245699"]).resolvedRows.length, 2, "A complete newer source supersedes a damaged older snapshot");

  const broken = await zipFile(Buffer.from("unreadable"));
  assert.equal(broken.errors[0].purchaseOrderNumber, "140245699");
  assert.equal(resolveWeeklyPurchaseDocuments([old, broken], ["140245699"]).resolvedRows.length, 0);
  const brokenArchive = await parseWeeklyPurchaseFile(Buffer.from("unreadable"), newSource);
  assert.equal(resolveWeeklyPurchaseDocuments([old, brokenArchive], ["140245699"]).resolvedRows.length, 0, "A newer unreadable archive cannot be assumed to omit the target PO");
  const unknownTime = await parseWeeklyPurchaseFile(await workbook(), { name: "PO_140245699.xlsx", modifiedTime: "" });
  assert.equal(resolveWeeklyPurchaseDocuments([old, unknownTime], ["140245699"]).resolvedRows.length, 0);
  const nullableReceived = await zipFile(await workbook([{ sku: "39136021", ordered: 5, confirmed: 3, received: null }]));
  assert.equal(nullableReceived.documents[0].rows[0].receivedQuantity, null, "Unknown I is diagnostic null; never manufacture receipt quantity zero");

  let realDocuments = 0;
  for (const [po, expectedCount] of [["140245699", 43], ["140246781", 1], ["140246833", 1], ["141060313", 4]] as const) {
    const file = path.join(process.cwd(), ".tmp", "uploaded-monthly-po-check", `PO_${po}.xlsx`);
    if (!existsSync(file)) continue;
    const parsed = await parseWeeklyPurchaseFile(readFileSync(file), { name: `PO_${po}.xlsx`, modifiedTime: statSync(file).mtime.toISOString() });
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.documents[0].rows.length, expectedCount);
    if (po === "140245699") {
      for (const [sku, row] of [["39136021", 42], ["39323459", 48]] as const) {
        const item = parsed.documents[0].rows.find(item => item.skuId === sku)!;
        assert.deepEqual([item.orderedQuantity, item.confirmedQuantity, item.receivedQuantity, item.sourceRow], [1, 1, 1, row]);
      }
    }
    realDocuments++;
  }
  console.log(`PASS weekly purchase files: merged PO rows, explicit zero, blank/formula/invalid quantities, identity and totals, latest snapshots, conflicts; real samples ${realDocuments}/4`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
