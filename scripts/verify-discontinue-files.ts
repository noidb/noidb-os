import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import {
  buildDiscontinueWorkbook,
  buildReleaseWorkbook,
  DISCONTINUE_COMMENT,
  DISCONTINUE_REASON,
  DISCONTINUE_TEMPLATE_NAME,
  RELEASE_REASON,
  RELEASE_TEMPLATE_NAME,
} from "../lib/wms/discontinue-files";

const ROOT = "G:\\내 드라이브\\쿠팡데이터\\단종 및 해제";
const BUNDLED = path.join(process.cwd(), "lib", "wms", "data", "discontinue-templates");

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function requireIncludes(value: string, expected: string, label: string) {
  if (!value.includes(expected)) throw new Error(`${label} 검증 실패: '${expected}' 없음`);
}

function rowCount(xml: string): number {
  return (xml.match(/<row\b/g) || []).length;
}

async function sheetXml(buffer: Buffer, file: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file(file);
  if (!entry) throw new Error(`${file} 없음`);
  return entry.async("string");
}

async function run() {
  const discontinueSource = await readFile(path.join(ROOT, DISCONTINUE_TEMPLATE_NAME));
  const releaseSource = await readFile(path.join(ROOT, RELEASE_TEMPLATE_NAME));
  const bundledDiscontinue = await readFile(path.join(BUNDLED, DISCONTINUE_TEMPLATE_NAME));
  const bundledRelease = await readFile(path.join(BUNDLED, RELEASE_TEMPLATE_NAME));
  if (sha256(discontinueSource) !== sha256(bundledDiscontinue)) throw new Error("앱 내 단종 양식 복사본이 G: 원본과 다름");
  if (sha256(releaseSource) !== sha256(bundledRelease)) throw new Error("앱 내 단종해제 양식 복사본이 G: 원본과 다름");
  const selected = [
    { skuId: "70000001", productName: "검증상품 하나, 실버, 17호" },
    { skuId: "70000002", productName: "검증상품 둘, 골드, 2P" },
  ];

  const preservedBefore = await sheetXml(discontinueSource, "xl/worksheets/sheet2.xml");
  const discontinue = await buildDiscontinueWorkbook(discontinueSource, selected, "2026-09-05");
  const discontinueSheet = await sheetXml(discontinue.buffer, "xl/worksheets/sheet1.xml");
  const preservedAfter = await sheetXml(discontinue.buffer, "xl/worksheets/sheet2.xml");
  if (preservedBefore !== preservedAfter) throw new Error("단종 양식 두 번째 탭 XML이 변경됨");
  if (rowCount(discontinueSheet) !== 4) throw new Error("단종 파일 데이터행 수 불일치");
  for (const item of selected) requireIncludes(discontinueSheet, item.skuId, "단종 SKU");
  requireIncludes(discontinueSheet, DISCONTINUE_REASON, "단종 사유");
  requireIncludes(discontinueSheet, DISCONTINUE_COMMENT, "단종 코멘트");
  requireIncludes(discontinueSheet, "2026-09-05", "단종 날짜");

  const release = await buildReleaseWorkbook(releaseSource, selected);
  const releaseSheet = await sheetXml(release.buffer, "xl/worksheets/sheet1.xml");
  if (rowCount(releaseSheet) !== 3) throw new Error("단종해제 파일에 기존 데이터행이 남음");
  for (const item of selected) {
    requireIncludes(releaseSheet, item.skuId, "단종해제 SKU");
    requireIncludes(releaseSheet, item.productName, "단종해제 상품명");
  }
  requireIncludes(releaseSheet, RELEASE_REASON, "단종해제 사유");

  console.log(JSON.stringify({
    discontinueSkuCount: discontinue.itemCount,
    discontinueWorksheet2Changed: false,
    discontinueRows: rowCount(discontinueSheet),
    releaseSkuCount: release.itemCount,
    releaseRows: rowCount(releaseSheet),
    releaseOldDataRowsRemaining: 0,
    bundledTemplatesMatchDriveOriginals: true,
  }, null, 2));
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
