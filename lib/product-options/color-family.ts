/**
 * 2026-11-04 쿠팡 양식의 '색상계열' 칸(예: 모자 양식)을 SKU 색상옵션마다 따로 고른다.
 * 양식 드롭다운 목록(choices)에 실제로 있는 값만 돌려준다. 못 고르면 빈 문자열.
 */

export function isColorFamilyHeader(header: string): boolean {
  return /색상\s*계열/.test(String(header || "").replace(/\s+/g, ""));
}

/** [색상 이름에 들어간 글자, 계열 이름 후보(앞이 우선)] — 순서대로 먼저 맞는 것을 쓴다. */
const RULES: [RegExp, string[]][] = [
  [/로즈|rose/i, ["핑크"]],
  [/골드|gold|금색/i, ["골드"]],
  [/실버|silver|은색/i, ["실버", "그레이"]],
  [/블랙|black|검정/i, ["블랙"]],
  [/아이보리|화이트|white|흰/i, ["화이트"]],
  [/베이지|beige|브라운|brown|갈색|카키/i, ["브라운", "베이지"]],
  [/그레이|gray|grey|회색|차콜/i, ["그레이"]],
  [/핑크|pink/i, ["핑크"]],
  [/레드|red|빨강|와인|버건디/i, ["레드"]],
  [/네이비|navy|남색/i, ["네이비", "블루"]],
  [/블루|blue|파랑/i, ["블루"]],
  [/그린|green|초록/i, ["그린"]],
  [/옐로|yellow|노랑/i, ["옐로우", "옐로"]],
  [/오렌지|orange/i, ["오렌지"]],
  [/퍼플|purple|보라|바이올렛|violet/i, ["바이올렛", "퍼플"]],
  [/투명|clear/i, ["투명"]],
];

export function guessColorFamily(color: string, choices: string[]): string {
  const text = String(color || "").trim();
  if (!text) return "";
  // 색이 여러 개 섞인 이름(예: '블랙/화이트', '혼합')은 멀티컬러
  const multi = choices.find(choice => /멀티|혼합/.test(choice));
  if (multi && (/멀티|혼합|믹스|mix/i.test(text) || /[\/+&]/.test(text))) return multi;
  for (const [pattern, names] of RULES) {
    if (!pattern.test(text)) continue;
    for (const name of names) {
      const found = choices.find(choice => choice.replace(/\s+/g, "").startsWith(name));
      if (found) return found;
    }
  }
  return "";
}
