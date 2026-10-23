/**
 * 제품DB 같은 모델 줄 붙이기(사용자 확정 2026-10-20·2026-10-23)
 * 같은 모델(모델명/품번, 대소문자·앞뒤 공백 무시)의 줄이 떨어져 있으면 뒤쪽 줄을 그 모델이 처음 나오는 묶음 바로 뒤로 옮긴다.
 * 다른 줄의 순서는 그대로 둔다. 줄 전체를 옮기므로(moveDimension) 서식·수식·사진·줄 높이가 같이 따라간다.
 *
 * 세트 구성 줄(사용자 요청 2026-10-23): 모델SKU 칸에 여러 줄로 모델SKU가 적힌 줄은 세트 줄이다
 * (예: "wn00307RG\nwe00306RG"). 모델SKU가 하나뿐인 줄이 어떤 세트 줄의 구성 모델SKU와 같으면
 * 같은 모델 묶음 대신 그 세트 줄 바로 아래에 붙인다. 여러 세트에 들어가면 시트에서 먼저 나오는 세트 줄 아래.
 */
export type RegroupMove = { startIndex: number; endIndex: number; destinationIndex: number };

/** rows: 첫 줄이 제목줄인 시트 값. 돌려주는 index는 시트 0-based 행 번호(제목줄 = 0). 순서대로 적용해야 한다. */
export function planModelRegroup(rows: readonly (readonly unknown[])[], modelHeader = "모델명/품번", modelSkuHeader = "모델SKU"): { moves: RegroupMove[]; models: string[] } {
  const headers = (rows[0] || []).map(value => String(value ?? "").replace(/\s+/g, ""));
  const modelCol = headers.indexOf(modelHeader.replace(/\s+/g, ""));
  if (modelCol < 0 || rows.length < 3) return { moves: [], models: [] };
  const keyOf = (index: number) => String(rows[index]?.[modelCol] ?? "").trim().toLowerCase();
  const current = rows.map((_, index) => index).slice(1);
  // 세트 줄과 그 구성 줄 찾기(모델SKU 칸이 없으면 세트 규칙은 건너뛴다).
  const attachedTo = findSetComponents(rows, current, headers.indexOf(modelSkuHeader.replace(/\s+/g, "")));
  const componentsOf = new Map<number, number[]>();
  for (const index of current) { const set = attachedTo.get(index); if (set !== undefined) componentsOf.set(set, [...(componentsOf.get(set) || []), index]); }
  const base = current.filter(index => !attachedTo.has(index));
  // 목표 순서: 모델이 처음 나오는 자리에 그 모델 줄을 모두 모은다.
  const byModel = new Map<string, number[]>();
  for (const index of base) { const key = keyOf(index); if (key) byModel.set(key, [...(byModel.get(key) || []), index]); }
  const grouped: number[] = [];
  const placed = new Set<string>();
  for (const index of base) {
    const key = keyOf(index);
    if (!key) { grouped.push(index); continue; }
    if (placed.has(key)) continue;
    placed.add(key);
    grouped.push(...byModel.get(key)!);
  }
  // 세트 줄 바로 아래에 구성 줄(현재 순서 그대로)을 붙인다.
  const target: number[] = [];
  // 구성 줄 순서는 세트 줄 모델SKU에 적힌 순서, 같은 모델SKU끼리는 현재 순서.
  const skuCol = headers.indexOf(modelSkuHeader.replace(/\s+/g, ""));
  for (const index of grouped) {
    const lines = skuLines(rows[index]?.[skuCol]);
    const parts = [...(componentsOf.get(index) || [])].sort((a, b) => lines.indexOf(skuLines(rows[a]?.[skuCol])[0]) - lines.indexOf(skuLines(rows[b]?.[skuCol])[0]));
    target.push(index, ...parts);
  }
  return movesToTarget(current, target, keyOf);
}

/** 현재 순서(current)를 목표 순서(target)로 바꾸는 줄 이동 목록. 두 목록은 같은 줄 번호를 담아야 한다. */
function movesToTarget(current: readonly number[], target: readonly number[], keyOf: (index: number) => string): { moves: RegroupMove[]; models: string[] } {
  const moves: RegroupMove[] = [];
  const models = new Set<string>();
  const list = [...current];
  for (let i = 0; i < target.length; i++) {
    if (list[i] === target[i]) continue;
    const j = list.indexOf(target[i], i);
    let k = 1;
    while (i + k < target.length && j + k < list.length && list[j + k] === target[i + k]) k++;
    // 시트 행 번호 = 목록 위치 + 1(제목줄)
    moves.push({ startIndex: j + 1, endIndex: j + k + 1, destinationIndex: i + 1 });
    models.add(keyOf(target[i]));
    const block = list.splice(j, k);
    list.splice(i, 0, ...block);
    i += k - 1;
  }
  return { moves, models: [...models] };
}

/**
 * 승인대기 옵션 아래로 같은 모델 줄 붙이기(사용자 요청 2026-10-23)
 * 현재상태가 anchorStatuses(예: 기존상품승인대기)인 줄을 기준 줄로 잡고, 같은 모델(모델명/품번)의 다른 옵션 줄을
 * 그 기준 줄 바로 아래로 옮긴다. 같은 모델의 기준 줄이 여러 개면 기준 줄끼리 먼저, 그 뒤에 나머지 옵션 순서.
 * 줄 순서만 바꾸고 칸 내용은 건드리지 않는다. 세트 줄·세트 구성 줄은 옮기지 않는다. 다른 줄의 순서는 그대로.
 */
export function planAnchorModelRegroup(
  rows: readonly (readonly unknown[])[], anchorStatuses: readonly string[],
  modelHeader = "모델명/품번", modelSkuHeader = "모델SKU", statusHeader = "현재상태"
): { moves: RegroupMove[]; models: string[] } {
  const headers = (rows[0] || []).map(value => String(value ?? "").replace(/\s+/g, ""));
  const modelCol = headers.indexOf(modelHeader.replace(/\s+/g, ""));
  const statusCol = headers.indexOf(statusHeader.replace(/\s+/g, ""));
  if (modelCol < 0 || statusCol < 0 || rows.length < 3) return { moves: [], models: [] };
  const keyOf = (index: number) => String(rows[index]?.[modelCol] ?? "").trim().toLowerCase();
  const current = rows.map((_, index) => index).slice(1);
  const skuCol = headers.indexOf(modelSkuHeader.replace(/\s+/g, ""));
  const attachedTo = findSetComponents(rows, current, skuCol);
  const isSetRow = (index: number) => skuLines(rows[index]?.[skuCol]).length >= 2;
  const movable = (index: number) => !attachedTo.has(index) && !isSetRow(index) && Boolean(keyOf(index));
  const anchorSet = new Set(anchorStatuses.map(status => status.replace(/\s+/g, "")));
  const isAnchor = (index: number) => anchorSet.has(String(rows[index]?.[statusCol] ?? "").replace(/\s+/g, ""));
  const blocks = new Map<string, number[]>();
  for (const index of current) {
    if (!movable(index) || !isAnchor(index)) continue;
    const key = keyOf(index);
    if (!blocks.has(key)) blocks.set(key, []);
  }
  if (blocks.size === 0) return { moves: [], models: [] };
  for (const [key, block] of blocks) {
    const sameModel = current.filter(index => movable(index) && keyOf(index) === key);
    block.push(...sameModel.filter(isAnchor), ...sameModel.filter(index => !isAnchor(index)));
  }
  const inBlock = new Set<number>([...blocks.values()].flat());
  const emitted = new Set<string>();
  const target: number[] = [];
  for (const index of current) {
    if (!inBlock.has(index)) { target.push(index); continue; }
    const key = keyOf(index);
    // 기준 줄이 처음 나오는 자리에서 그 모델 묶음을 한 번에 내놓는다(그보다 위에 있던 같은 모델 줄은 아래로 내려온다).
    if (!isAnchor(index) || emitted.has(key)) continue;
    emitted.add(key);
    target.push(...blocks.get(key)!);
  }
  return movesToTarget(current, target, keyOf);
}

const skuLines = (value: unknown) => String(value ?? "").split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(Boolean);

/** 구성 줄 → 붙일 세트 줄(시트 0-based 행 번호). 세트 줄 자신은 구성 줄이 되지 않는다. */
export function findSetComponents(rows: readonly (readonly unknown[])[], current: readonly number[], modelSkuCol: number): Map<number, number> {
  const attachedTo = new Map<number, number>();
  if (modelSkuCol < 0) return attachedTo;
  const setOfSku = new Map<string, number>();
  for (const index of current) {
    const lines = skuLines(rows[index]?.[modelSkuCol]);
    if (lines.length < 2) continue;
    for (const sku of lines) if (!setOfSku.has(sku)) setOfSku.set(sku, index);
  }
  for (const index of current) {
    const lines = skuLines(rows[index]?.[modelSkuCol]);
    if (lines.length !== 1) continue;
    const set = setOfSku.get(lines[0]);
    if (set !== undefined) attachedTo.set(index, set);
  }
  return attachedTo;
}
