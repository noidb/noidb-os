import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import {
  analyzeInboundImportSafety,
  buildInboundEventFingerprint,
  parseInboundSourceRows,
  type InboundImportDataset,
  type InboundImportItem,
} from "../lib/wms/inbound-import-safety";

const baseRows = [
  {
    구분: "발주",
    번호: "PO-100",
    SKU번호: "70000001",
    SKU명: "상품 하나, 실버",
    "입고/반출시각": "2026/09/05 09:10:11",
    수량: "4",
    공급가액: "12,000",
  },
  {
    구분: "발주",
    번호: "PO-100",
    SKU번호: "70000001",
    SKU명: "상품 하나, 실버",
    "입고/반출시각": "2026/09/05 15:20:21",
    수량: "3",
    공급가액: "9,000",
  },
];

const events = parseInboundSourceRows(baseRows, "입고-A.xlsx");
assert.equal(events.length, 2, "같은 날짜·PO·SKU의 2차 입고를 서로 다른 이벤트로 보존");
assert.equal(events[0].actualDate, "2026-09-05");
assert.notEqual(events[0].eventKey, events[1].eventKey);

function dataset(fingerprint: string, sourceFile: string, items: InboundImportItem[]): InboundImportDataset {
  return { fingerprint, sourceFile, items };
}

const emptyHistory = [["데이터세트", "발주번호", "입고예정일", "SKU ID", "상품명", "입고수량", "반출", "순입고", "최근입고일", "이전공급가일", "이전공급가", "최근공급가일", "최근공급가", "반영일"]];
const overlap = analyzeInboundImportSafety(emptyHistory, [
  dataset("hash-a", "입고-A.xlsx", events),
  dataset("hash-b", "입고-B.xlsx", [events[0]]),
]);
assert.equal(overlap.conflicts.length, 0);
assert.equal(overlap.sourceEventCount, 3);
assert.equal(overlap.uniqueEventCount, 2);
assert.equal(overlap.overlapDuplicateEventCount, 1, "서로 다른 파일의 완전히 같은 이벤트를 한 번만 반영");
assert.equal(overlap.candidateEventCount, 2);
assert.equal(overlap.candidateInbound, 7, "같은 날의 실제 2차 입고 4+3은 모두 보존");
assert.ok(overlap.acceptedDatasets.every(item => item.items.length === 1 && item.fingerprint.startsWith("noidb-inbound-event-v2:")), "Apps Script 기존 데이터세트 열에 이벤트 단위 fingerprint 기록");

const ambiguousSameFileDuplicate = analyzeInboundImportSafety(emptyHistory, [
  dataset("hash-ambiguous", "입고-중복행.xlsx", [events[0], events[0]]),
]);
assert.equal(ambiguousSameFileDuplicate.acceptedDatasets.length, 0);
assert.match(ambiguousSameFileDuplicate.conflicts[0]?.reason || "", /한 파일 안에/, "동일 파일의 식별 불가능한 중복행은 임의로 하나만 남기지 않고 차단");

const exactHistory = [
  emptyHistory[0],
  [buildInboundEventFingerprint(events[0]), "PO-100", "", "70000001", "상품 하나, 실버", "4", "0", "4", "2026-09-05 09:10:11", "", "0", "2026-09-05 09:10:11", "12000", "2026-09-05"],
];
const exactDuplicate = analyzeInboundImportSafety(exactHistory, [dataset("hash-new", "입고-new.xlsx", [events[0]])]);
assert.equal(exactDuplicate.conflicts.length, 0);
assert.equal(exactDuplicate.candidateEventCount, 0);
assert.equal(exactDuplicate.duplicateEventCount, 1, "다른 파일명이어도 기존의 같은 초 단위 이벤트는 중복 제외");

const changedQuantity = { ...events[0], totalInbound: 5, netInbound: 5 };
const exactConflict = analyzeInboundImportSafety(exactHistory, [dataset("hash-conflict", "입고-conflict.xlsx", [changedQuantity])]);
assert.equal(exactConflict.acceptedDatasets.length, 0);
assert.equal(exactConflict.conflicts.length, 1, "같은 이벤트의 수량이 다르면 임의 증분 계산 없이 전체 차단");

const invalidHeaders = [[...emptyHistory[0]]];
invalidHeaders[0][1] = "잘못된 발주번호 열";
assert.throws(
  () => analyzeInboundImportSafety(invalidHeaders, [dataset("hash-header", "입고-header.xlsx", events)]),
  /입고이력 열 구성이 올바르지 않습니다/,
  "기존 이력 헤더 손상을 빈 이력으로 간주하지 않음",
);
const malformedMissingPo = [emptyHistory[0], [...exactHistory[1]]];
malformedMissingPo[1][1] = "";
assert.throws(
  () => analyzeInboundImportSafety(malformedMissingPo, [dataset("hash-missing-po", "입고-missing-po.xlsx", events)]),
  /발주번호.*새 입고파일을 반영할 수 없습니다/,
  "기존 비어 있지 않은 행의 PO 누락을 skip하지 않고 차단",
);
const malformedMissingFingerprint = [emptyHistory[0], [...exactHistory[1]]];
malformedMissingFingerprint[1][0] = "";
assert.throws(
  () => analyzeInboundImportSafety(malformedMissingFingerprint, [dataset("hash-missing-fingerprint", "입고-missing-fingerprint.xlsx", events)]),
  /데이터세트.*새 입고파일을 반영할 수 없습니다/,
  "기존 비어 있지 않은 행의 fingerprint 누락을 skip하지 않고 차단",
);

const legacyDailyHistory = [
  emptyHistory[0],
  ["legacy", "PO-100", "", "70000001", "상품 하나, 실버", "7", "0", "7", "2026-09-05", "", "0", "", "0", "2026-09-05"],
];
const legacyExact = analyzeInboundImportSafety(legacyDailyHistory, [dataset("hash-day", "입고-day.xlsx", events)]);
assert.equal(legacyExact.conflicts.length, 0);
assert.equal(legacyExact.candidateEventCount, 0);
assert.equal(legacyExact.duplicateEventCount, 2, "시각이 없는 과거 요약은 같은 날 전체합계가 정확히 같을 때만 중복 인정");

const legacyTimedAggregate = [
  emptyHistory[0],
  ["legacy-file-hash", "PO-100", "", "70000001", "상품 하나, 실버", "7", "0", "7", "2026-09-05 15:20:21", "", "0", "2026-09-05 15:20:21", "9000", "2026-09-05"],
];
const legacyTimedExact = analyzeInboundImportSafety(legacyTimedAggregate, [dataset("hash-timed-day", "입고-timed-day.xlsx", events)]);
assert.equal(legacyTimedExact.conflicts.length, 0);
assert.equal(legacyTimedExact.candidateEventCount, 0, "event-v2 marker가 없는 과거 시각 행도 임의의 단일 이벤트로 신뢰하지 않음");
assert.equal(legacyTimedExact.duplicateEventCount, 2);

const legacyConflict = analyzeInboundImportSafety(legacyDailyHistory, [dataset("hash-partial", "입고-partial.xlsx", [events[0]])]);
assert.equal(legacyConflict.acceptedDatasets.length, 0);
assert.equal(legacyConflict.conflicts.length, 1, "과거 일합계와 부분 파일이 다르면 자동 반영 차단");

assert.throws(
  () => parseInboundSourceRows([{ ...baseRows[0], 수량: "" }], "blank.xlsx"),
  /수량 빈칸 또는 숫자 아님/,
  "빈 수량을 숫자 0으로 바꾸지 않음",
);
assert.throws(
  () => parseInboundSourceRows([{ ...baseRows[0], 수량: "0" }], "zero.xlsx"),
  /수량 0은 양의 정수가 아님/,
  "명시적인 0도 별도 유효성 오류로 보존",
);
for (const invalidMoment of ["2026/02/30", "2026/13/01", "2026/09/05 24:00:00", "2026/09/05 23:60:00", "2026/09/05 23:59:60", "2026/09/05 09:10:11 잘못된값"]) {
  assert.throws(
    () => parseInboundSourceRows([{ ...baseRows[0], "입고/반출시각": invalidMoment }], "invalid-date.xlsx"),
    /입고\/반출시각 없음/,
    `실재하지 않는 입고시각 차단: ${invalidMoment}`,
  );
}

async function actualDriveReadOnlyEvidence() {
  const paths = [
    "G:\\내 드라이브\\쿠팡데이터\\입고상세내역 다운로드\\Coupang_Stocked_Data_List(2026-07-12~2026-08-12).xlsx",
    "G:\\내 드라이브\\쿠팡데이터\\쿠팡2023~202607입고리스트\\쿠팡전체입고리스트_2026\\Coupang_Stocked_Data_List(2026-01-01~2026-07-14).xlsx",
  ];
  if (!paths.every(existsSync)) return { checked: false as const };

  const datasets: InboundImportDataset[] = [];
  for (const filePath of paths) {
    const buffer = await readFile(filePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    assert.ok(sheet, `${filePath}: 첫 시트 없음`);
    const safeText = (cell: ExcelJS.Cell) => {
      try { return cell.text.trim(); } catch { return String(cell.value ?? "").trim(); }
    };
    const headers = Array.from({ length: sheet.columnCount }, (_, index) => safeText(sheet.getCell(1, index + 1)));
    const rows: Record<string, string>[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = Object.fromEntries(headers.map((header, index) => [header, safeText(sheet.getCell(rowNumber, index + 1))]));
      if (Object.values(row).some(Boolean)) rows.push(row);
    }
    datasets.push({
      fingerprint: createHash("sha256").update(buffer).digest("hex"),
      sourceFile: filePath.split("\\").at(-1) || filePath,
      items: parseInboundSourceRows(rows, filePath),
    });
  }

  const driveAnalysis = analyzeInboundImportSafety(emptyHistory, datasets);
  const timesByDayPoSku = new Map<string, Set<string>>();
  datasets.flatMap(item => item.items).forEach(item => {
    const key = [item.actualDate, item.po, item.sku].join("|");
    const times = timesByDayPoSku.get(key) || new Set<string>();
    times.add(item.actualAt);
    timesByDayPoSku.set(key, times);
  });
  const sameDaySecondReceiptKeys = Array.from(timesByDayPoSku.values()).filter(times => times.size > 1).length;
  assert.ok(sameDaySecondReceiptKeys > 0, "실제 자료의 같은 날 2차 입고 증빙을 찾지 못함");
  assert.ok(driveAnalysis.overlapDuplicateEventCount > 0, "실제 겹친 기간 파일의 동일 이벤트를 찾지 못함");
  assert.equal(driveAnalysis.conflicts.length, 0, "실제 겹친 파일의 동일 이벤트 값이 충돌함");
  return {
    checked: true as const,
    files: datasets.length,
    sourceEvents: driveAnalysis.sourceEventCount,
    sameDaySecondReceiptKeys,
    exactCrossFileOverlapEvents: driveAnalysis.overlapDuplicateEventCount,
  };
}

actualDriveReadOnlyEvidence().then(actualDrive => {
  console.log(JSON.stringify({
    ok: true,
    sameDaySecondReceiptPreserved: true,
    crossFileOverlapSkipped: true,
    exactHistoryDuplicateSkipped: true,
    conflictingQuantityBlocked: true,
    legacyDailyExactOnly: true,
    blankAndZeroSeparated: true,
    actualDriveReadOnly: actualDrive,
  }, null, 2));
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
