import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { buildWeeklyAdvertisingFiles } from "../lib/wms/weekly-advertising-files";

const TEMPLATE = path.join(process.cwd(), "lib/wms/templates/Coupang_Advertising_Products.xlsx");
const SHEET = "xl/worksheets/sheet1.xml";
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const ids = (size: number) => Array.from({ length: size }, (_, index) => String(86399202564 + index));
const cellXml = (xml: string, ref: string) => xml.match(new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0];

async function inspectFile(buffer: Buffer, expected: string[], sourceZip: JSZip) {
  assert.ok(expected.length >= 1 && expected.length <= 500);
  const zip = await JSZip.loadAsync(buffer);
  assert.deepEqual(Object.keys(zip.files).sort(), Object.keys(sourceZip.files).sort(), "no sheets or archive parts added");
  for (const [name, part] of Object.entries(sourceZip.files)) {
    if (part.dir || name === SHEET) continue;
    assert.equal(sha(await zip.file(name)!.async("nodebuffer")), sha(await part.async("nodebuffer")), `${name} preserved byte for byte`);
  }
  const [sourceXml, xml] = await Promise.all([sourceZip.file(SHEET)!.async("string"), zip.file(SHEET)!.async("string")]);
  const outsideData = (value: string) => value.replace(/<sheetData>[\s\S]*?<\/sheetData>/, "<sheetData/>").replace(/<dimension\b[^>]*\/>/, "<dimension/>");
  assert.equal(outsideData(xml), outsideData(sourceXml), "widths, help merge, styles and views preserved");
  assert.equal(cellXml(xml, "A1"), cellXml(sourceXml, "A1"), "option ID header preserved");
  for (let row = 2; row <= 6; row += 1) for (const col of ["D", "E", "F"]) {
    assert.equal(cellXml(xml, `${col}${row}`), cellXml(sourceXml, `${col}${row}`), "all help cells preserved");
  }
  const actual = [...xml.matchAll(/<c\b[^>]*\br="A(\d+)"[^>]*\bt="inlineStr"[^>]*><is><t>(\d+)<\/t><\/is><\/c>/g)]
    .filter(match => Number(match[1]) >= 2);
  assert.deepEqual(actual.map(match => match[2]), expected, "IDs remain exact text in first-seen order");
  assert.deepEqual(actual.map(match => Number(match[1])), expected.map((_, index) => index + 2), "one ID per row, no gaps");
  assert.ok(!cellXml(xml, "A502"), "no 501st option in a file");
  assert.ok(!xml.includes("<f>"), "IDs cannot become formulas");
}

async function run() {
  const source = await readFile(TEMPLATE);
  const sourceZip = await JSZip.loadAsync(source);
  const boundaries = [0, 1, 499, 500, 501, 1000, 1001];
  for (const count of boundaries) {
    const input = ids(count);
    const files = await buildWeeklyAdvertisingFiles(input);
    assert.equal(files.length, Math.ceil(count / 500), `file count for ${count}`);
    assert.deepEqual(files.flatMap(file => file.optionIds), input, "all final selections appear once");
    for (let index = 0; index < files.length; index += 1) {
      assert.equal(files[index].fileName, `3-${index + 1}_광고등록.xlsx`);
      await inspectFile(files[index].buffer, input.slice(index * 500, (index + 1) * 500), sourceZip);
    }
  }
  const input = ids(501);
  const duplicates = [input[0], ...input.slice(0, 500), input[499], ` ${input[500]} `, input[500]];
  const beforeInput = JSON.stringify(duplicates);
  const duplicateFiles = await buildWeeklyAdvertisingFiles(duplicates);
  assert.equal(JSON.stringify(duplicates), beforeInput, "caller input stays unchanged");
  assert.deepEqual(duplicateFiles.map(file => file.optionIds.length), [500, 1], "deduplicate before splitting");
  assert.deepEqual(duplicateFiles.flatMap(file => file.optionIds), input);
  for (let index = 0; index < duplicateFiles.length; index += 1) await inspectFile(duplicateFiles[index].buffer, input.slice(index * 500, (index + 1) * 500), sourceZip);
  const largeIds = ["900719925474099312345", "86399202564", "900719925474099312346", "00086399202565"];
  const largeFiles = await buildWeeklyAdvertisingFiles([...largeIds, largeIds[0]]);
  await inspectFile(largeFiles[0].buffer, largeIds, sourceZip);
  for (const invalid of ["", " ", "0", "000", "-1", "1.5", "1e12", "12 34", "=1+1", "abc", 123, null]) {
    await assert.rejects(buildWeeklyAdvertisingFiles(["86399202564", invalid as string]), /옵션ID/);
  }
  await assert.rejects(buildWeeklyAdvertisingFiles(null as unknown as string[]), /옵션ID/);
  assert.equal(sha(await readFile(TEMPLATE)), sha(source), "bundled source unchanged");
  if (process.argv.includes("--write-example")) {
    const folder = path.join(process.cwd(), "tmp/weekly-ad-template-20260907/advertising-examples");
    await mkdir(folder, { recursive: true });
    for (const file of duplicateFiles) await writeFile(path.join(folder, file.fileName), file.buffer);
  }
  console.log(JSON.stringify({ verified: true, boundaries, deduplicatedChunkSizes: duplicateFiles.map(file => file.optionIds.length), largeIdsPreserved: true, templateUnchanged: true, externalWrites: 0 }));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
