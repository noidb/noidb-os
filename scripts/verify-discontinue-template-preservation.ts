import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import JSZip from "jszip";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import {
  buildDiscontinueWorkbook, buildReleaseWorkbook, DISCONTINUE_TEMPLATE_NAME,
  DISCONTINUE_LETTER_TEMPLATE_NAME, RELEASE_TEMPLATE_NAME, normalizedDiscontinueItems,
} from "../lib/wms/discontinue-files";
import { buildDiscontinueLetterFromTemplate, DISCONTINUE_LETTER_TEMPLATE_SHA256 } from "../lib/wms/discontinue-letter";

const BUNDLED = path.join(process.cwd(), "lib/wms/data/discontinue-templates");
const OUTPUT = path.join(process.cwd(), "tmp/discontinue-review-20260905");
const SAMPLE_SKUS = ["39659674", "57342556", "39626071", "39626074", "39396110", "39135913"];
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

async function assertOnlyDataSheetChanged(before: Buffer, after: Buffer) {
  const [a, b] = await Promise.all([JSZip.loadAsync(before), JSZip.loadAsync(after)]);
  assert.deepEqual(Object.keys(a.files).sort(), Object.keys(b.files).sort());
  for (const [name, file] of Object.entries(a.files)) {
    if (file.dir || name === "xl/worksheets/sheet1.xml") continue;
    assert.equal(sha(await file.async("nodebuffer")), sha(await b.file(name)!.async("nodebuffer")), `${name} must be byte-identical`);
  }
  return b.file("xl/worksheets/sheet1.xml")!.async("string");
}

function pageStreams(document: PDFDocument, pageIndex: number) {
  const contents = document.getPage(pageIndex).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref => document.context.lookup(ref)) : [contents];
  return streams.map(stream => Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString("latin1")).join("\n");
}

function imageHashes(document: PDFDocument, pageIndex: number): string[] {
  const resources = document.getPage(pageIndex).node.Resources();
  const xobjects = resources?.lookup(PDFName.of("XObject"));
  if (!xobjects || !("entries" in xobjects)) return [];
  return (xobjects as { entries(): [unknown, unknown][] }).entries().map(([, reference]) => {
    const stream = document.context.lookup(reference as never) as PDFRawStream;
    return sha(decodePDFRawStream(stream).decode());
  }).sort();
}

async function verifyGenerationStatusIsAppendOnly() {
  const file = await readFile(path.join(process.cwd(), "lib/wms/vendor-order-actions.ts"), "utf8");
  const section = file.slice(file.indexOf("export async function recordStatusFileGeneration("), file.indexOf("export async function recordReceivingDelay("));
  assert.ok(section && !section.includes("updateSheetCells"));
  const pending = [
    { id: "done-d", skuId: "70000001", requestType: "단종", supplyHubStatus: "처리완료", completedAt: "2026-09-04T01:00:00Z" },
    { id: "done-r", skuId: "70000002", requestType: "단종해제", supplyHubStatus: "처리완료", completedAt: "2026-09-04T02:00:00Z" },
  ];
  const before = JSON.stringify(pending);
  const writes: unknown[][] = [];
  const sandbox = {
    exports: {} as { recordStatusFileGeneration: (input: unknown) => Promise<unknown> },
    normalizeSkuId: (value: unknown) => String(value || "").trim(),
    listStatusRequests: async () => pending,
    ensureHiddenSheet: async (...args: unknown[]) => writes.push(["ensure", ...args]),
    appendSheetRow: async (...args: unknown[]) => writes.push(["append", ...args]),
    STATUS_FILE_GENERATION_SHEET: "generation-only", STATUS_FILE_GENERATION_HEADERS: [],
    requiredText: (value: unknown) => { if (!String(value || "").trim()) throw new Error("missing"); return String(value).trim(); },
    makeId: () => "test-generation",
  };
  const code = ts.transpileModule(section, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, sandbox);
  const generate = sandbox.exports.recordStatusFileGeneration;
  await generate({ kind: "단종", skuIds: ["70000001"], requestIds: ["done-d"], xlsxFileName: "test.xlsx", pdfFileName: "test.pdf" });
  await generate({ kind: "단종해제", skuIds: ["70000002"], requestIds: ["done-r"], xlsxFileName: "release.xlsx" });
  assert.equal(JSON.stringify(pending), before, "completed request values must not change on regeneration");
  assert.equal(writes.length, 4);
  assert.ok(writes.every(write => write[1] === "generation-only"));
  const writeCount = writes.length;
  await assert.rejects(generate({ kind: "단종", skuIds: ["70000002"], requestIds: ["done-r"], xlsxFileName: "test.xlsx", pdfFileName: "test.pdf" }));
  await assert.rejects(generate({ kind: "단종", skuIds: ["70000001"], requestIds: ["done-d"], xlsxFileName: "test.xlsx" }));
  await assert.rejects(generate({ kind: "단종", skuIds: ["70000003"], requestIds: ["done-d"], xlsxFileName: "test.xlsx", pdfFileName: "test.pdf" }));
  assert.equal(writes.length, writeCount, "invalid generation must not write even a header");
}

async function verifyBundleRoute(discontinue: Buffer, release: Buffer, pdf: Buffer) {
  const file = await readFile(path.join(process.cwd(), "app/api/wms/discontinue-files/route.ts"), "utf8");
  const writes: string[] = [];
  let failPdf = false;
  class FixtureResponse extends Response {
    static json(data: unknown, init?: ResponseInit) { return new FixtureResponse(JSON.stringify(data), { ...init, headers: { "Content-Type": "application/json" } }); }
  }
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: FixtureResponse }, jszip: JSZip,
    "@/lib/wms/discontinue-files": {
      buildDiscontinueWorkbook, buildReleaseWorkbook, normalizedDiscontinueItems,
      koreaDateParts: () => ({ iso: "2026-09-05", compact: "20260905" }),
      loadDiscontinueTemplate: async () => discontinue, loadReleaseTemplate: async () => release,
      loadDiscontinueLetterTemplate: async () => pdf,
    },
    "@/lib/wms/discontinue-letter": { buildDiscontinueLetterFromTemplate: async (...args: Parameters<typeof buildDiscontinueLetterFromTemplate>) => {
      if (failPdf) throw new Error("fixture PDF failed");
      return buildDiscontinueLetterFromTemplate(...args);
    } },
    "@/lib/wms/google-drive-oauth-writer": { generatedDriveSaveHeaders: async (_buffer: Buffer, filename: string) => {
      writes.push(filename);
      return { "X-NOIDB-Drive-Saved": "true", "X-NOIDB-Drive-File-Name": encodeURIComponent(filename.replace(/\.(xlsx|pdf)$/, "_02.$1")) };
    } },
  };
  const sandbox = { exports: {} as { POST: (request: { json(): Promise<unknown> }) => Promise<Response> }, Buffer, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`);
    return modules[name];
  } };
  vm.runInNewContext(ts.transpileModule(file, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText, sandbox);
  const items = [{ skuId: "70000001", productName: "검증상품, 실버, 17호" }];
  const bundle = await sandbox.exports.POST({ json: async () => ({ kind: "discontinue", format: "bundle", items }) });
  assert.equal(bundle.status, 200);
  const zip = await JSZip.loadAsync(await bundle.arrayBuffer());
  const names = Object.keys(zip.files);
  assert.equal(names.length, 2);
  assert.ok(names.every(name => /_02\.(xlsx|pdf)$/.test(name)), "response must expose actual non-overwriting Drive filenames");
  assert.ok(names.includes(decodeURIComponent(bundle.headers.get("X-NOIDB-XLSX-File-Name") || "")));
  assert.ok(names.includes(decodeURIComponent(bundle.headers.get("X-NOIDB-PDF-File-Name") || "")));
  assert.equal(writes.length, 2);
  failPdf = true;
  const failure = await sandbox.exports.POST({ json: async () => ({ kind: "discontinue", format: "bundle", items }) });
  assert.equal(failure.status, 400);
  assert.equal(writes.length, 2, "neither file may save when the companion PDF cannot generate");
  failPdf = false;
  const releaseResponse = await sandbox.exports.POST({ json: async () => ({ kind: "release", items }) });
  assert.equal(releaseResponse.status, 200);
  assert.ok(decodeURIComponent(releaseResponse.headers.get("X-NOIDB-File-Name") || "").endsWith("_02.xlsx"));
  assert.equal(writes.length, 3);
}

async function run() {
  const [discontinue, release, pdf] = await Promise.all([DISCONTINUE_TEMPLATE_NAME, RELEASE_TEMPLATE_NAME, DISCONTINUE_LETTER_TEMPLATE_NAME].map(name => readFile(path.join(BUNDLED, name))));
  assert.equal(sha(pdf), DISCONTINUE_LETTER_TEMPLATE_SHA256);
  const selected = Array.from({ length: 21 }, (_, index) => ({ skuId: String(70000001 + index), productName: `검증상품 ${index + 1}, 실버, 17호` }));
  assert.equal(normalizedDiscontinueItems([...selected, selected[0]]).length, 21);
  assert.throws(() => normalizedDiscontinueItems([{ skuId: "wrong" }]));
  const [xlsx, released, single, multi] = await Promise.all([
    buildDiscontinueWorkbook(discontinue, selected, "2026-09-05"),
    buildReleaseWorkbook(release, selected),
    buildDiscontinueLetterFromTemplate(pdf, selected.slice(0, 1), "2026-09-05"),
    buildDiscontinueLetterFromTemplate(pdf, selected, "2027-01-01"),
  ]);
  const discontinueXml = await assertOnlyDataSheetChanged(discontinue, xlsx.buffer);
  const releaseXml = await assertOnlyDataSheetChanged(release, released.buffer);
  assert.equal((discontinueXml.match(/<row\b/g) || []).length, 23);
  assert.equal((releaseXml.match(/<row\b/g) || []).length, 22);
  assert.deepEqual([...discontinueXml.matchAll(/<c r="A\d+"[^>]*><is><t>(\d+)<\/t><\/is><\/c>/g)].map(match => match[1]), selected.map(item => item.skuId));
  assert.deepEqual([...releaseXml.matchAll(/<c r="A\d+"[^>]*><is><t>(\d+)<\/t><\/is><\/c>/g)].map(match => match[1]), selected.map(item => item.skuId));
  const original = await PDFDocument.load(pdf);
  const originalImages = imageHashes(original, 0);
  assert.ok(originalImages.length > 0, "sample must include the actual stamp image");
  for (const [data, skuCount, date] of [[single, 1, "2026-09-05"], [multi, 21, "2027-01-01"]] as const) {
    const generated = await PDFDocument.load(data);
    assert.equal(generated.getPageCount(), Math.ceil(skuCount / 6));
    const seen: string[] = [];
    for (let page = 0; page < generated.getPageCount(); page += 1) {
      assert.deepEqual(imageHashes(generated, page), originalImages, "original stamp image bytes changed");
      const content = pageStreams(generated, page);
      SAMPLE_SKUS.forEach(sku => assert.ok(!content.includes(`(${sku})`), "old sample SKU left behind"));
      assert.equal(content.split(`(${date})`).length - 1, 1);
      assert.ok(content.includes(`${date.slice(0, 4)} \\025 1 \\023`));
      seen.push(...[...content.matchAll(/\((700000\d{2})\) Tj/g)].map(match => match[1]));
    }
    assert.deepEqual(seen, selected.slice(0, skuCount).map(item => item.skuId));
  }
  await assert.rejects(buildDiscontinueLetterFromTemplate(Buffer.concat([pdf, Buffer.from("changed")]), selected, "2026-09-05"));
  await assert.rejects(buildDiscontinueLetterFromTemplate(pdf, selected, "2026-02-30"));
  await verifyGenerationStatusIsAppendOnly();
  await verifyBundleRoute(discontinue, release, pdf);
  await mkdir(OUTPUT, { recursive: true });
  await Promise.all([
    writeFile(path.join(OUTPUT, "single-page.pdf"), single), writeFile(path.join(OUTPUT, "multi-page.pdf"), multi),
    writeFile(path.join(OUTPUT, "discontinue-test.xlsx"), xlsx.buffer), writeFile(path.join(OUTPUT, "release-test.xlsx"), released.buffer),
  ]);
  console.log(JSON.stringify({ verified: true, selectedSkus: 21, preservedNonDataZipParts: true, secondSheetXmlChanges: 0, originalStampPreserved: true, sampleSkusRemaining: 0, pdfPages: [1, 4], completedRegenerationStateChanges: 0, realSheetOrDriveWrites: 0 }, null, 2));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
