import { createHash } from "node:crypto";

export type InboundEventKind = "inbound" | "outbound";

export interface InboundImportItem {
  eventKey: string;
  actualAt: string;
  actualDate: string;
  kind: InboundEventKind;
  po: string;
  expectedDate: string;
  sku: string;
  name: string;
  totalInbound: number;
  outbound: number;
  netInbound: number;
  lastDate: string;
  previousSupplyDate: string;
  previousSupplyPrice: number;
  latestSupplyDate: string;
  latestSupplyPrice: number;
}

export interface InboundImportDataset {
  fingerprint: string;
  sourceFile: string;
  items: InboundImportItem[];
}

export interface InboundImportConflict {
  eventKey: string;
  sourceFiles: string[];
  reason: string;
}

export interface InboundImportSafetyAnalysis {
  previewToken: string;
  acceptedDatasets: InboundImportDataset[];
  sourceEventCount: number;
  uniqueEventCount: number;
  candidateEventCount: number;
  duplicateEventCount: number;
  overlapDuplicateEventCount: number;
  candidateInbound: number;
  candidateOutbound: number;
  conflicts: InboundImportConflict[];
}

interface NormalizedMoment {
  actualAt: string;
  actualDate: string;
  hasTime: boolean;
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ").trim();
}

function field(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(row, name)) continue;
    const value = cleanText(row[name]);
    if (value !== "") return value;
  }
  return "";
}

function numericText(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeInboundMoment(value: unknown): NormalizedMoment | null {
  const text = cleanText(value);
  const match = text.match(/^(20\d{2})[/.\-](\d{1,2})[/.\-](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  const hasTime = match[4] !== undefined;
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  if (hasTime && (hour > 23 || minute > 59 || second > 59)) return null;
  const actualDate = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const actualAt = hasTime
    ? `${actualDate} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`
    : actualDate;
  return { actualAt, actualDate, hasTime };
}

export function buildInboundEventKey(input: {
  actualAt: string;
  po: string;
  sku: string;
  kind: InboundEventKind;
}): string {
  return [input.actualAt, cleanText(input.po), cleanText(input.sku), input.kind].join("|");
}

function eventSignature(item: InboundImportItem): string {
  return JSON.stringify([
    item.totalInbound,
    item.outbound,
    item.expectedDate,
    item.previousSupplyDate,
    item.previousSupplyPrice,
    item.latestSupplyDate,
    item.latestSupplyPrice,
  ]);
}

const EVENT_FINGERPRINT_PREFIX = "noidb-inbound-event-v2:";

/** 기존 Apps Script의 데이터세트 열을 그대로 활용하는 이벤트 단위 fingerprint. */
export function buildInboundEventFingerprint(item: InboundImportItem): string {
  return EVENT_FINGERPRINT_PREFIX + createHash("sha256")
    .update(`${item.eventKey}\n${eventSignature(item)}`)
    .digest("hex");
}

function dailyKey(item: Pick<InboundImportItem, "actualDate" | "po" | "sku">): string {
  return [item.actualDate, item.po, item.sku].join("|");
}

/**
 * 쿠팡 입고상세내역의 원문 행을 손실 없는 이벤트로 바꾼다.
 *
 * 같은 날짜에도 같은 PO/SKU가 여러 번 입고될 수 있으므로 날짜만으로 합치지 않는다. 원문에
 * 있는 초 단위 입고/반출 시각과 방향을 보존하고, 빈 수량과 명시적인 0도 서로 다르게 검증한다.
 */
export function parseInboundSourceRows(
  rows: Record<string, string>[],
  sourceFile: string,
): InboundImportItem[] {
  const parsed: InboundImportItem[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    const po = field(row, ["발주번호", "발주서번호", "발주서 번호", "번호"]);
    const sku = field(row, ["SKU번호", "SKU ID"]);
    const rawKind = field(row, ["구분"]);
    const rawMoment = field(row, ["입고/반출시각", "입고일"]);
    const rawQuantity = field(row, ["수량", "입고수량"]);
    const looksLikeData = Boolean(po || sku || rawKind || rawMoment || rawQuantity);
    if (!looksLikeData) return;

    const rowNumber = index + 2;
    const moment = normalizeInboundMoment(rawMoment);
    const quantity = numericText(rawQuantity);
    const kind: InboundEventKind | null = rawKind === "발주" || rawKind === "입고"
      ? "inbound"
      : rawKind === "반출" ? "outbound" : null;
    const rowErrors: string[] = [];
    if (!po) rowErrors.push("발주번호 없음");
    if (!sku) rowErrors.push("SKU 없음");
    if (!kind) rowErrors.push(`구분 확인 필요(${rawKind || "빈칸"})`);
    if (!moment) rowErrors.push("입고/반출시각 없음");
    if (quantity === null) rowErrors.push("수량 빈칸 또는 숫자 아님");
    else if (!Number.isInteger(quantity) || quantity <= 0) rowErrors.push(`수량 ${quantity}은 양의 정수가 아님`);
    if (rowErrors.length) {
      errors.push(`${sourceFile} ${rowNumber}행: ${rowErrors.join(", ")}`);
      return;
    }

    const expectedDate = field(row, ["입고예정일", "입고예정일시"]);
    const name = field(row, ["SKU명", "SKU 이름", "상품명"]);
    const supplyDate = moment!.actualAt;
    const supplyPrice = numericText(field(row, ["공급가액", "공급가"])) || 0;
    const totalInbound = kind === "inbound" ? quantity! : 0;
    const outbound = kind === "outbound" ? quantity! : 0;
    parsed.push({
      eventKey: buildInboundEventKey({ actualAt: moment!.actualAt, po, sku, kind: kind! }),
      actualAt: moment!.actualAt,
      actualDate: moment!.actualDate,
      kind: kind!,
      po,
      expectedDate,
      sku,
      name,
      totalInbound,
      outbound,
      netInbound: totalInbound - outbound,
      lastDate: moment!.actualAt,
      previousSupplyDate: "",
      previousSupplyPrice: 0,
      latestSupplyDate: supplyDate,
      latestSupplyPrice: kind === "inbound" ? supplyPrice : 0,
    });
  });

  if (errors.length) {
    const sample = errors.slice(0, 5).join(" / ");
    throw new Error(`입고 원문 필수값을 확인해 주세요. ${sample}${errors.length > 5 ? ` 외 ${errors.length - 5}건` : ""}`);
  }
  if (!parsed.length) throw new Error(`${sourceFile}: 반영할 입고/반출 행이 없습니다.`);
  return parsed;
}

function collapseRequestDatasets(datasets: InboundImportDataset[]): {
  datasets: InboundImportDataset[];
  sourceEventCount: number;
  duplicateCount: number;
  conflicts: InboundImportConflict[];
} {
  const next = datasets.map(dataset => ({ ...dataset, items: [] as InboundImportItem[] }));
  const seen = new Map<string, { item: InboundImportItem; sourceFiles: string[]; datasetIndexes: Set<number> }>();
  const conflicts: InboundImportConflict[] = [];
  let duplicateCount = 0;
  let sourceEventCount = 0;

  datasets.forEach((dataset, datasetIndex) => {
    dataset.items.forEach(item => {
      sourceEventCount += 1;
      const existing = seen.get(item.eventKey);
      if (!existing) {
        seen.set(item.eventKey, { item, sourceFiles: [dataset.sourceFile], datasetIndexes: new Set([datasetIndex]) });
        next[datasetIndex].items.push(item);
        return;
      }
      const sourceFiles = Array.from(new Set([...existing.sourceFiles, dataset.sourceFile]));
      existing.sourceFiles = sourceFiles;
      if (existing.datasetIndexes.has(datasetIndex)) {
        conflicts.push({
          eventKey: item.eventKey,
          sourceFiles,
          reason: "한 파일 안에 같은 입고시각·발주번호·SKU가 여러 번 있어 자동 판단할 수 없습니다.",
        });
      } else if (eventSignature(existing.item) === eventSignature(item)) duplicateCount += 1;
      else conflicts.push({
        eventKey: item.eventKey,
        sourceFiles,
        reason: "같은 입고시각·발주번호·SKU의 수량 또는 금액이 파일마다 다릅니다.",
      });
      existing.datasetIndexes.add(datasetIndex);
    });
  });

  return { datasets: next.filter(dataset => dataset.items.length), sourceEventCount, duplicateCount, conflicts };
}

interface ExistingExactEvent {
  signature: string;
  count: number;
}

interface ExistingDailyTotal {
  inbound: number;
  outbound: number;
}

const REQUIRED_INBOUND_HISTORY_HEADERS = [
  "데이터세트", "발주번호", "입고예정일", "SKU ID", "상품명", "입고수량", "반출", "순입고",
  "최근입고일", "이전공급가일", "이전공급가", "최근공급가일", "최근공급가", "반영일",
] as const;

function existingInboundEvidence(rows: string[][]): {
  exact: Map<string, ExistingExactEvent>;
  daily: Map<string, ExistingDailyTotal>;
} {
  const exact = new Map<string, ExistingExactEvent>();
  const daily = new Map<string, ExistingDailyTotal>();
  if (!rows.length) return { exact, daily };
  const headers = rows[0].map(value => cleanText(value));
  const invalidHeader = REQUIRED_INBOUND_HISTORY_HEADERS.find((header, index) => headers[index] !== header);
  if (invalidHeader) {
    throw new Error(`입고이력 열 구성이 올바르지 않습니다. ${invalidHeader} 열을 확인해 주세요.`);
  }
  const at = (row: string[], names: string[]) => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index >= 0) return cleanText(row[index]);
    }
    return "";
  };
  rows.slice(1).forEach((row, rowIndex) => {
    if (!row.some(value => cleanText(value))) return;
    const datasetFingerprint = at(row, ["데이터세트"]);
    const po = at(row, ["발주번호"]);
    const sku = at(row, ["SKU ID"]);
    const moment = normalizeInboundMoment(at(row, ["입고시각", "최근입고일", "실제입고일"]));
    const inboundValue = numericText(at(row, ["입고수량", "총입고"]));
    const outboundValue = numericText(at(row, ["반출"]));
    const invalidFields = [
      !datasetFingerprint ? "데이터세트" : "",
      !po ? "발주번호" : "",
      !sku ? "SKU ID" : "",
      !moment ? "최근입고일" : "",
      inboundValue === null || !Number.isInteger(inboundValue) || inboundValue < 0 ? "입고수량" : "",
      outboundValue === null || !Number.isInteger(outboundValue) || outboundValue < 0 ? "반출" : "",
    ].filter(Boolean);
    if (invalidFields.length || !moment) {
      throw new Error(`입고이력 ${rowIndex + 2}행의 ${invalidFields.join(", ")} 값이 비어 있거나 올바르지 않습니다. 이력을 확인하기 전에는 새 입고파일을 반영할 수 없습니다.`);
    }
    const inbound = inboundValue!;
    const outbound = outboundValue!;
    if (inbound === 0 && outbound === 0) {
      throw new Error(`입고이력 ${rowIndex + 2}행의 입고수량과 반출이 모두 0입니다. 이력을 확인하기 전에는 새 입고파일을 반영할 수 없습니다.`);
    }
    const existingDailyKey = [moment.actualDate, po, sku].join("|");

    if (datasetFingerprint.startsWith(EVENT_FINGERPRINT_PREFIX)
      && moment.hasTime
      && ((inbound > 0 && outbound === 0) || (outbound > 0 && inbound === 0))) {
      const kind: InboundEventKind = inbound > 0 ? "inbound" : "outbound";
      const item: InboundImportItem = {
        eventKey: buildInboundEventKey({ actualAt: moment.actualAt, po, sku, kind }),
        actualAt: moment.actualAt,
        actualDate: moment.actualDate,
        kind,
        po,
        expectedDate: at(row, ["입고예정일"]),
        sku,
        name: at(row, ["상품명"]),
        totalInbound: inbound,
        outbound,
        netInbound: inbound - outbound,
        lastDate: moment.actualAt,
        previousSupplyDate: normalizeInboundMoment(at(row, ["이전공급가일"]))?.actualAt || at(row, ["이전공급가일"]),
        previousSupplyPrice: numericText(at(row, ["이전공급가"])) || 0,
        latestSupplyDate: normalizeInboundMoment(at(row, ["최근공급가일"]))?.actualAt || at(row, ["최근공급가일"]),
        latestSupplyPrice: numericText(at(row, ["최근공급가"])) || 0,
      };
      // prefix만 흉내 낸 행은 신뢰하지 않는다. 이 경우 과거 일합계로 내려 보내 값이 완전히
      // 일치할 때만 중복으로 처리하고, 조금이라도 다르면 자동 반영을 막는다.
      if (datasetFingerprint === buildInboundEventFingerprint(item)) {
        const prior = exact.get(item.eventKey);
        exact.set(item.eventKey, { signature: eventSignature(item), count: (prior?.count || 0) + 1 });
        return;
      }
    }

    const prior = daily.get(existingDailyKey) || { inbound: 0, outbound: 0 };
    prior.inbound += inbound;
    prior.outbound += outbound;
    daily.set(existingDailyKey, prior);
  });
  return { exact, daily };
}

function previewToken(rows: string[][], datasets: InboundImportDataset[]): string {
  return createHash("sha256").update(JSON.stringify({
    history: rows,
    files: datasets.map(dataset => ({ fingerprint: dataset.fingerprint, sourceFile: dataset.sourceFile })),
    events: datasets.flatMap(dataset => dataset.items.map(item => [item.eventKey, eventSignature(item)])),
  })).digest("hex");
}

/**
 * 현재 _입고요약과 새 다운로드를 읽기 전용으로 대조한다.
 *
 * 초 단위 식별자가 있는 행은 이벤트 단위로, 과거 날짜-only 요약행은 같은 날짜+PO+SKU의
 * 전체 일합계가 정확히 같을 때만 중복으로 인정한다. 서로 다른 값은 어느 쪽도 추정하지 않고
 * 전체 반영을 중단할 수 있도록 conflict로 돌려준다.
 */
export function analyzeInboundImportSafety(
  historyRows: string[][],
  datasets: InboundImportDataset[],
): InboundImportSafetyAnalysis {
  const collapsed = collapseRequestDatasets(datasets);
  const evidence = existingInboundEvidence(historyRows);
  const conflicts = [...collapsed.conflicts];
  const duplicateKeys = new Set<string>();
  const provisional: Array<{ item: InboundImportItem; sourceFile: string }> = [];

  collapsed.datasets.forEach(dataset => dataset.items.forEach(item => {
    const existing = evidence.exact.get(item.eventKey);
    if (!existing) {
      provisional.push({ item, sourceFile: dataset.sourceFile });
      return;
    }
    if (existing.count > 1) {
      conflicts.push({ eventKey: item.eventKey, sourceFiles: [dataset.sourceFile], reason: "기존 입고이력에 같은 이벤트가 여러 번 있어 자동 판단할 수 없습니다." });
    } else if (existing.signature === eventSignature(item)) duplicateKeys.add(item.eventKey);
    else conflicts.push({ eventKey: item.eventKey, sourceFiles: [dataset.sourceFile], reason: "기존 입고이력과 같은 이벤트의 수량 또는 금액이 다릅니다." });
  }));

  const provisionalByDay = new Map<string, Array<{ item: InboundImportItem; sourceFile: string }>>();
  provisional.forEach(entry => {
    const key = dailyKey(entry.item);
    const values = provisionalByDay.get(key) || [];
    values.push(entry);
    provisionalByDay.set(key, values);
  });
  const acceptedKeys = new Set<string>();
  provisionalByDay.forEach((entries, key) => {
    const legacy = evidence.daily.get(key);
    if (!legacy) {
      entries.forEach(entry => acceptedKeys.add(entry.item.eventKey));
      return;
    }
    const incoming = entries.reduce((sum, entry) => ({
      inbound: sum.inbound + entry.item.totalInbound,
      outbound: sum.outbound + entry.item.outbound,
    }), { inbound: 0, outbound: 0 });
    if (incoming.inbound === legacy.inbound && incoming.outbound === legacy.outbound) {
      entries.forEach(entry => duplicateKeys.add(entry.item.eventKey));
      return;
    }
    conflicts.push({
      eventKey: key,
      sourceFiles: Array.from(new Set(entries.map(entry => entry.sourceFile))),
      reason: "시각이 없는 과거 일합계와 새 파일의 같은 날짜·발주번호·SKU 합계가 달라 자동 반영할 수 없습니다.",
    });
  });

  const acceptedDatasets = conflicts.length ? [] : collapsed.datasets.flatMap(dataset => dataset.items
    .filter(item => acceptedKeys.has(item.eventKey))
    .map(item => ({
      fingerprint: buildInboundEventFingerprint(item),
      sourceFile: dataset.sourceFile,
      items: [item],
    })));
  const accepted = acceptedDatasets.flatMap(dataset => dataset.items);
  return {
    previewToken: previewToken(historyRows, collapsed.datasets),
    acceptedDatasets,
    sourceEventCount: collapsed.sourceEventCount,
    uniqueEventCount: collapsed.datasets.reduce((sum, dataset) => sum + dataset.items.length, 0),
    candidateEventCount: accepted.length,
    duplicateEventCount: duplicateKeys.size,
    overlapDuplicateEventCount: collapsed.duplicateCount,
    candidateInbound: accepted.reduce((sum, item) => sum + item.totalInbound, 0),
    candidateOutbound: accepted.reduce((sum, item) => sum + item.outbound, 0),
    conflicts,
  };
}
