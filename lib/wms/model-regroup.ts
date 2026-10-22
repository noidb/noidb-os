/**
 * 제품DB 같은 모델 줄 붙이기(사용자 확정 2026-10-20·2026-10-23)
 * 같은 모델(모델명/품번, 대소문자·앞뒤 공백 무시)의 줄이 떨어져 있으면 뒤쪽 줄을 그 모델이 처음 나오는 묶음 바로 뒤로 옮긴다.
 * 다른 줄의 순서는 그대로 둔다. 줄 전체를 옮기므로(moveDimension) 서식·수식·사진·줄 높이가 같이 따라간다.
 */
export type RegroupMove = { startIndex: number; endIndex: number; destinationIndex: number };

/** rows: 첫 줄이 제목줄인 시트 값. 돌려주는 index는 시트 0-based 행 번호(제목줄 = 0). 순서대로 적용해야 한다. */
export function planModelRegroup(rows: readonly (readonly unknown[])[], modelHeader = "모델명/품번"): { moves: RegroupMove[]; models: string[] } {
  const headers = (rows[0] || []).map(value => String(value ?? "").replace(/\s+/g, ""));
  const modelCol = headers.indexOf(modelHeader.replace(/\s+/g, ""));
  if (modelCol < 0 || rows.length < 3) return { moves: [], models: [] };
  const keyOf = (index: number) => String(rows[index]?.[modelCol] ?? "").trim().toLowerCase();
  const current = rows.map((_, index) => index).slice(1);
  // 목표 순서: 모델이 처음 나오는 자리에 그 모델 줄을 모두 모은다.
  const byModel = new Map<string, number[]>();
  for (const index of current) { const key = keyOf(index); if (key) byModel.set(key, [...(byModel.get(key) || []), index]); }
  const target: number[] = [];
  const placed = new Set<string>();
  for (const index of current) {
    const key = keyOf(index);
    if (!key) { target.push(index); continue; }
    if (placed.has(key)) continue;
    placed.add(key);
    target.push(...byModel.get(key)!);
  }
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
