import assert from "node:assert/strict";
import { extractModelSku, parseWimsClipboard } from "../lib/wms/wims-registration";

// 2026-10-23: 하이픈 없는 새 모델SKU(색상코드가 바로 붙음)도 읽어야 한다.
const cases: [string, string][] = [
  ["써지컬스틸 로마숯자 심플스터드 여성귀걸이, we00193BK | 블랙", "we00193BK"],
  ["써지컬스틸 로마숯자 심플스터드 여성귀걸이, we00193WH | 화이트", "we00193WH"],
  ["써지컬스틸 여성 심플 매듭 꼬임 원터치링 피어싱귀걸이, we20240406SI | 실버", "we20240406SI"],
  ["핸드메이드 큐빅나비 블랙끈 리본끈 초커목걸이, wn011140SI | 실버", "wn011140SI"],
  ["써지컬스틸 여성 스틱버튼 코인두줄체인귀걸이, we00290RG | 로즈골드", "we00290RG"],
  ["써지컬스틸 심플 대나무체인 남성목걸이, mn011236-SI | 유광실버", "mn011236-SI"],
  ["써지컬스틸 H크리스탈 여성 원터치귀걸이, we011623-RG | 로즈골드", "we011623-RG"],
  ["써지컬스틸 엔틱 문양 호루라기 페이퍼 롱목걸이, mn011589-SI | 실버", "mn011589-SI"],
  ["색상 없는 일반 상품명 10mm", ""],
];
for (const [name, expected] of cases) assert.equal(extractModelSku(name), expected, name);

const header = ["상품명", "상품 등록일", "바코드", "견적서 ID", "SKU ID", "상태"].join("\t");
const row = ["써지컬스틸 로마숯자 심플스터드 여성귀걸이, we00193BK | 블랙", "2026/10/23 15:56:27", "바코드 없음", "519b3944", "-", "상품 검수중"].join("\t");
const snapshot = parseWimsClipboard(header + "\n" + row);
assert.equal(snapshot.rows[0].modelSku, "we00193BK");
assert.equal(snapshot.rows[0].status, "reviewing");

console.log("verify-wims-model-sku: OK");
