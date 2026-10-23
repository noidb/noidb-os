import assert from "node:assert/strict";
import { planAnchorModelRegroup } from "../lib/wms/model-regroup";

// 2026-10-23: 기존상품승인대기 옵션 아래로 같은 모델 줄 붙이기
const H = ["모델명/품번", "모델SKU", "현재상태"];
/** 이동 계획을 적용한 뒤 줄 이름(모델SKU) 순서를 돌려준다. */
function apply(rows: string[][], anchors = ["기존상품승인대기"]) {
  const plan = planAnchorModelRegroup(rows, anchors);
  const order = rows.map((_, i) => i).slice(1);
  for (const m of plan.moves) { const block = order.splice(m.startIndex - 1, m.endIndex - m.startIndex); order.splice(m.destinationIndex - 1, 0, ...block); }
  return { names: order.map(i => rows[i][1]), plan };
}

// 1) 기준 줄이 위에 있고 같은 모델 옵션이 아래쪽에 떨어져 있음 → 기준 줄 바로 아래로
let r = apply([H, ["we1", "we1BK", "기존상품승인대기"], ["x", "x1", "정상"], ["y", "y1", "정상"], ["we1", "we1WH", "정상"], ["we1", "we1RG", "과재고"]]);
assert.deepEqual(r.names, ["we1BK", "we1WH", "we1RG", "x1", "y1"]);

// 2) 같은 모델 옵션이 기준 줄보다 위에 있어도 기준 줄 자리 아래로 내려온다
r = apply([H, ["we1", "we1WH", "정상"], ["x", "x1", "정상"], ["we1", "we1BK", "기존상품승인대기"], ["y", "y1", "정상"]]);
assert.deepEqual(r.names, ["x1", "we1BK", "we1WH", "y1"]);

// 3) 이미 붙어 있으면 이동 없음, 두 번 돌려도 같다(멱등)
r = apply([H, ["we1", "we1BK", "기존상품승인대기"], ["we1", "we1WH", "정상"], ["x", "x1", "정상"]]);
assert.deepEqual(r.plan.moves, []);

// 4) 다른 모델·기준 상태가 아닌 줄은 건드리지 않는다
r = apply([H, ["a", "a1", "정상"], ["b", "b1", "정상"], ["a", "a2", "정상"]]);
assert.deepEqual(r.plan.moves, []);
assert.deepEqual(r.names, ["a1", "b1", "a2"]);

// 5) 기준 줄이 한 모델에 둘이면 기준 줄끼리 먼저, 그 뒤 나머지 옵션
r = apply([H, ["we1", "we1BK", "기존상품승인대기"], ["x", "x1", "정상"], ["we1", "we1WH", "정상"], ["we1", "we1RG", "기존상품승인대기"]]);
assert.deepEqual(r.names, ["we1BK", "we1RG", "we1WH", "x1"]);

// 6) 모델이 다른 기준 줄 둘 → 각자 자기 모델 옵션을 아래로
r = apply([H, ["a", "a1", "기존상품승인대기"], ["b", "b1", "기존상품승인대기"], ["a", "a2", "정상"], ["b", "b2", "정상"]]);
assert.deepEqual(r.names, ["a1", "a2", "b1", "b2"]);

// 7) 세트 줄(모델SKU 여러 줄)과 그 구성 줄은 옮기지 않는다
r = apply([H, ["we1", "we1BK", "기존상품승인대기"], ["set", "we1WH\nwe2WH", "정상"], ["we1", "we1WH", "정상"], ["we1", "we1RG", "정상"]]);
assert.deepEqual(r.names, ["we1BK", "we1RG", "we1WH\nwe2WH", "we1WH"]);

// 8) 모델명 대소문자·공백 무시, 제목·열이 없으면 아무 일도 안 함
r = apply([H, ["WE1 ", "we1BK", "기존상품승인대기"], ["x", "x1", "정상"], ["we1", "we1WH", "정상"]]);
assert.deepEqual(r.names, ["we1BK", "we1WH", "x1"]);
assert.deepEqual(planAnchorModelRegroup([["모델SKU"], ["a"], ["b"]], ["기존상품승인대기"]).moves, []);

console.log("verify-approval-pending-regroup: OK");
