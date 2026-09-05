import { createHash } from "node:crypto";
import type { InboundImportItem } from "./inbound-import-safety";

export interface InboundCellChange {
  sku: string;
  row: number;
  column: number;
  field: "누적입고" | "미입고";
  before: string;
  after: number;
}

export interface InboundCellPreview {
  token: string;
  changes: InboundCellChange[];
  purchaseOrders: string[];
  skus: string[];
  blockers: string[];
}

const clean = (value: unknown) => String(value ?? "").trim();
function quantity(value: unknown): number | null {
  const raw = clean(value).replace(/,/g, "");
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Read-only plan. Only the two tracking cells of incoming SKUs are candidates.
 * Keep every PO separate until its remaining quantity has been calculated.
 * FORMULA values are required for productRows so formulas cannot be overwritten.
 */
export function buildInboundCellPreview(
  productRows: string[][],
  purchaseRows: string[][],
  historyRows: string[][],
  incoming: InboundImportItem[],
): InboundCellPreview {
  const changes: InboundCellChange[] = [];
  const blockers: string[] = [];
  const skus = [...new Set(incoming.map(item => item.sku))].sort();
  const selected = new Set(skus);
  const purchaseOrders = [...new Set(incoming.map(item => item.po))].sort();
  const columns = (rows: string[][], required: string[], label: string) => {
    const headers = (rows[0] || []).map(clean);
    for (const header of required) {
      if (headers.filter(value => value === header).length !== 1) blockers.push(`${label}: ${header} 열을 확인해 주세요.`);
    }
    return (row: string[], header: string) => clean(row[headers.indexOf(header)]);
  };
  const product = columns(productRows, ["SKU ID", "누적입고", "미입고"], "제품DB");
  const purchase = columns(purchaseRows, ["발주번호", "SKU ID", "확정수량", "발주수량", "발주현황"], "발주이력");
  const history = columns(historyRows, ["발주번호", "SKU ID", "입고수량", "반출"], "입고이력");
  const totals = new Map<string, number>();
  const ordered = new Map<string, number>();
  const bySku = new Map<string, Array<{ row: number; values: string[] }>>();
  const key = (po: string, sku: string) => JSON.stringify([po, sku]);
  if (!blockers.length) {
    productRows.slice(1).forEach((row, index) => {
      const sku = product(row, "SKU ID");
      if (!selected.has(sku)) return;
      bySku.set(sku, [...(bySku.get(sku) || []), { row: index + 2, values: row }]);
    });
    historyRows.slice(1).forEach((row, index) => {
      const sku = history(row, "SKU ID");
      if (!selected.has(sku)) return;
      const po = history(row, "발주번호");
      const received = quantity(history(row, "입고수량"));
      const returned = quantity(history(row, "반출"));
      if (!po || received === null || returned === null) {
        blockers.push(`입고이력 ${index + 2}행: 발주번호와 입고·반출 수량을 확인해 주세요.`);
        return;
      }
      totals.set(key(po, sku), (totals.get(key(po, sku)) || 0) + received - returned);
    });
    incoming.forEach(item => {
      totals.set(key(item.po, item.sku), (totals.get(key(item.po, item.sku)) || 0) + item.totalInbound - item.outbound);
    });
    purchaseRows.slice(1).forEach((row, index) => {
      const sku = purchase(row, "SKU ID");
      if (!selected.has(sku)) return;
      const po = purchase(row, "발주번호");
      const confirmed = quantity(purchase(row, "확정수량") || purchase(row, "발주수량"));
      if (!po || confirmed === null) {
        blockers.push(`발주이력 ${index + 2}행: 발주번호와 확정수량을 확인해 주세요.`);
        return;
      }
      const id = key(po, sku);
      if (ordered.has(id)) {
        blockers.push(`발주 ${po} · SKU ${sku}: 발주이력이 중복되어 최신 수량 확인이 필요합니다.`);
        return;
      }
      ordered.set(id, /취소|반려|무효/.test(purchase(row, "발주현황")) ? 0 : confirmed);
    });
    for (const [id, total] of totals) {
      const [po, sku] = JSON.parse(id) as string[];
      if (total < 0) blockers.push(`발주 ${po} · SKU ${sku}: 반출수량이 누적입고보다 많습니다.`);
      if (!ordered.has(id)) blockers.push(`발주 ${po} · SKU ${sku}: 확정 발주이력이 없습니다.`);
    }
    for (const sku of skus) {
      const rows = bySku.get(sku) || [];
      if (rows.length !== 1) {
        blockers.push(`SKU ${sku}: 제품DB에서 ${rows.length}행이 확인되어 한 행을 특정할 수 없습니다.`);
        continue;
      }
      let cumulative = 0;
      let missing = 0;
      for (const [id, total] of totals) if ((JSON.parse(id) as string[])[1] === sku) cumulative += total;
      for (const [id, confirmed] of ordered) if ((JSON.parse(id) as string[])[1] === sku) missing += Math.max(0, confirmed - Math.max(0, totals.get(id) || 0));
      for (const [field, after] of [["누적입고", cumulative], ["미입고", missing]] as const) {
        const before = product(rows[0].values, field);
        if (before.startsWith("=") || (before !== "" && quantity(before) === null)) {
          blockers.push(`SKU ${sku} · ${field}: 기존 셀에 수식 또는 숫자 이외의 값이 있습니다.`);
        } else if (before === "" || quantity(before) !== after) {
          changes.push({ sku, row: rows[0].row, column: productRows[0].map(clean).indexOf(field) + 1, field, before, after });
        }
      }
    }
  }
  const token = createHash("sha256").update(JSON.stringify({ productRows, purchaseRows, historyRows, incoming })).digest("hex");
  return { token, changes: blockers.length ? [] : changes, purchaseOrders, skus, blockers: [...new Set(blockers)] };
}
