/**
 * 같은 모델 원가·치수 채우기(사용자 요청 2026-10-23)
 * 전 탭(제품DB·비관리SKU·실적저조SKU·그 외 재등록SKU·판매중지SKU)에서 '모델명/품번'이 같은 줄 중 하나라도 값이 있으면
 * 비어 있는 줄에 그 값을 채운다. 이미 값이 있는 칸은 바꾸지 않는다.
 * 같은 모델 안에서 값이 여러 가지면(예: 옛 SKU 2,090 · 새 SKU 2,750, 세트 구성이 다른 옵션) 빈 칸을 채우지 않고 목록으로만 알려 준다.
 */
export const SAME_MODEL_FILL_FIELDS = ["원가(부가세포함)", "치수"] as const;
export type SameModelTab = { title: string; rows: string[][] };
export type SameModelFillUpdate = { title: string; row: number; col: number; value: string; field: string; model: string; skuId: string };
export type SameModelFillPlan = { updates: SameModelFillUpdate[]; conflicts: { model: string; field: string; values: string[]; used: string }[] };

const squash = (value: unknown) => String(value ?? "").replace(/\s+/g, "");
export const modelKey = (value: unknown) => String(value ?? "").trim().toLowerCase();
const find = (headers: string[], name: string) => headers.findIndex(header => squash(header) === squash(name));
/** 원가는 '2,750'과 2750을 같은 값으로 본다. */
const valueKey = (field: string, value: string) => field.startsWith("원가") ? value.replace(/[,\s원]/g, "") : value.trim();

export function planSameModelFill(tabs: readonly SameModelTab[], fields: readonly string[] = SAME_MODEL_FILL_FIELDS, productDbTitle = "제품DB"): SameModelFillPlan {
  const updates: SameModelFillUpdate[] = [];
  const conflicts: SameModelFillPlan["conflicts"] = [];
  for (const field of fields) {
    // 모델별 값 모으기
    const values = new Map<string, { value: string; fromDb: boolean }[]>();
    const blanks = new Map<string, { title: string; row: number; col: number; skuId: string }[]>();
    for (const tab of tabs) {
      const headers = (tab.rows[0] || []).map(value => String(value ?? ""));
      const modelCol = find(headers, "모델명/품번"), col = find(headers, field), skuCol = find(headers, "SKU ID");
      if (modelCol < 0 || col < 0) continue;
      tab.rows.slice(1).forEach((row, index) => {
        const model = modelKey(row[modelCol]);
        if (!model) return;
        const raw = String(row[col] ?? "");
        if (raw.trim()) {
          if (raw.startsWith("=")) return; // 수식은 옮기지 않는다
          values.set(model, [...(values.get(model) || []), { value: raw.trim(), fromDb: tab.title === productDbTitle }]);
        } else {
          blanks.set(model, [...(blanks.get(model) || []), { title: tab.title, row: index + 2, col: col + 1, skuId: skuCol >= 0 ? String(row[skuCol] ?? "").trim() : "" }]);
        }
      });
    }
    for (const [model, targets] of blanks) {
      const found = values.get(model);
      if (!found?.length) continue;
      const distinct = new Map<string, { value: string; count: number; db: number; first: number }>();
      found.forEach((entry, index) => {
        const key = valueKey(field, entry.value);
        const current = distinct.get(key) || { value: entry.value, count: 0, db: 0, first: index };
        current.count++;
        if (entry.fromDb) current.db++;
        distinct.set(key, current);
      });
      const ranked = [...distinct.values()].sort((a, b) => Number(b.db > 0) - Number(a.db > 0) || b.count - a.count || a.first - b.first);
      const used = field.startsWith("원가") ? ranked[0].value.replace(/[,\s원]/g, "") : ranked[0].value;
      // 값이 여러 가지면(옛·새 SKU 단가, 세트 구성이 다른 옵션 등) 어느 값이 맞는지 알 수 없어 채우지 않고 알려만 준다.
      if (ranked.length > 1) { conflicts.push({ model, field, values: ranked.map(item => item.value), used: "" }); continue; }
      for (const target of targets) updates.push({ ...target, value: used, field, model });
    }
  }
  return { updates, conflicts };
}

/** 계획한 값을 메모리의 줄에도 넣는다(정리 계획이 채운 값으로 옮기게). */
export function applySameModelFill(tabs: readonly SameModelTab[], plan: SameModelFillPlan) {
  for (const update of plan.updates) {
    const tab = tabs.find(item => item.title === update.title);
    const row = tab?.rows[update.row - 1];
    if (!row) continue;
    while (row.length < update.col) row.push("");
    row[update.col - 1] = update.value;
  }
}
