/**
 * WMS 모바일 화면 공통 디자인 토큰 (2026-08-19 5차 실사용 테스트 — AI 상품등록 화면과 시각
 * 언어 통일).
 *
 * 색상값은 전부 app/globals.css의 실제 AI 상품등록 화면 스타일에서 그대로 가져왔다 — 새로
 * 추측한 색이 아니다. 특히 :root의 --brand-* 변수(318~326행)와 .secondaryButton/.resetAllButton/
 * .coupangSearchButton/.googleSearchButton/.search1688Button/.card h2::before/.field input:focus
 * 등에서 실제로 쓰인 값을 그대로 옮겼다. AI 상품등록 화면(app/globals.css, app/page.tsx 등) 자체는
 * 이번에 전혀 수정하지 않았다 — 이 파일만 같은 값을 참조하는 WMS 전용 토큰이다.
 *
 * 이전에는 --brand-ink(#252525, AI 등록화면의 .dark/.aiButton 배경)를 WMS 주요 버튼/카드
 * 배경으로 썼는데, 이번 요청으로 "큰 검정 배경 버튼·카드 금지"가 명확해져 ink는 본문 글씨·
 * 아이콘 얇은 선·테두리 등 "최소 범위"에서만 쓰고, 버튼/카드 배경은 slate·sage·sand·bronze·
 * clay-soft 계열로만 구성한다.
 */

export const WMS_MOBILE_WIDTH = 390;

export const wmsColors = {
  background: "#ffffff",
  surface: "#faf8f4",
  surfaceBeige: "#f4f1ec",
  border: "#e5dace", // --brand-sand
  borderStrong: "#cfc0b0", // AI 등록화면 .secondaryButton 테두리
  ink: "#252525", // --brand-ink — 제목/아이콘 얇은 선/테두리 등 최소 범위 전용, 버튼·카드 배경 금지
  muted: "#77716a",
  slate: "#536d78", // --brand-slate — 기본 이동·조회(HOME 등)
  slateDark: "#3f4f55", // AI 등록화면 .coupangSearchButton — 현재 위치/선택된 메뉴, 승인 등 강조
  green: "#60766a", // --brand-sage — 저장·완료·새로고침
  greenDark: "#4d6358", // --brand-sage-dark — 최종 확정처럼 더 강한 완료 동작
  greenSoft: "#e3ece6", // AI 등록화면 .progressStep.done 배경
  sand: "#e5dace", // --brand-sand — 보조 버튼 배경
  sandText: "#302d29", // AI 등록화면 .secondaryButton 글자색
  bronze: "#9a7042", // --brand-bronze — 오커/브라운 포인트
  bronzeSoft: "#f3ece1",
  bronzeSoftBorder: "#d9c7a8",
  warn: "#a6614e", // --brand-clay
  warnSoft: "#f2dfd8", // --brand-clay-soft
  warnText: "#7f4032", // AI 등록화면 .resetAllButton/.removeButton 글자색
  warnSoftBorder: "#dfbdb2",
};

export const wmsButtonBase = {
  minHeight: "48px",
  borderRadius: "10px",
  fontSize: "15px",
  fontWeight: 700,
  border: "1px solid transparent",
  cursor: "pointer",
  padding: "0 14px",
} as const;

/** 기본 이동·조회 (HOME, 다음 화면 이동 등 일반 주요 동작) — 블루그레이 */
export const wmsPrimaryButton = {
  ...wmsButtonBase,
  background: wmsColors.slate,
  color: "#ffffff",
};

/** 현재 위치/선택된 메뉴, 승인처럼 더 강조가 필요한 진한 블루그레이 */
export const wmsSlateDarkButton = {
  ...wmsButtonBase,
  background: wmsColors.slateDark,
  color: "#ffffff",
};

/** 저장·완료·새로고침 — 세이지그린 */
export const wmsSageButton = {
  ...wmsButtonBase,
  background: wmsColors.green,
  color: "#ffffff",
};

/** 최종 확정 등 더 강조가 필요한 완료 동작 — 진한 그린 */
export const wmsGreenDarkButton = {
  ...wmsButtonBase,
  background: wmsColors.greenDark,
  color: "#ffffff",
};

/** 보조 버튼 — 웜베이지 */
export const wmsSecondaryButton = {
  ...wmsButtonBase,
  background: wmsColors.sand,
  color: wmsColors.sandText,
  border: `1px solid ${wmsColors.borderStrong}`,
};

/** 오커·브라운 포인트(반전선택 등 중립 이상의 별도 동작) */
export const wmsBronzeButton = {
  ...wmsButtonBase,
  background: wmsColors.bronzeSoft,
  color: wmsColors.bronze,
  border: `1px solid ${wmsColors.bronzeSoftBorder}`,
};

/** 경고·삭제·초기화 — 연한 살구색·브라운 */
export const wmsWarnButton = {
  ...wmsButtonBase,
  background: wmsColors.warnSoft,
  color: wmsColors.warnText,
  border: `1px solid ${wmsColors.warnSoftBorder}`,
};

/** 비활성/중립 이동 — 연한 회색·베이지 */
export const wmsGhostButton = {
  ...wmsButtonBase,
  background: "#ffffff",
  color: wmsColors.muted,
  border: `1px solid ${wmsColors.border}`,
};

/**
 * "겉 박스" 라운드 계층 (2026-08-20 배포 전 마지막 디자인 마감).
 * AI 상품등록 도우미(app/page.tsx)가 쓰는 app/globals.css의 실제 값을 그대로 옮겼다 — 새로
 * 만든 값이 아니다. `.card{border-radius:14px;border-color:#d8d3cc;box-shadow:0 4px 16px
 * rgba(30,28,25,.045)}`가 큰 섹션 카드 기준, `.imageSlot/.thumbnailCard/.shotCard{border-radius:12px}`가
 * 그보다 한 단계 작은 일반 카드 기준이다. 버튼·입력창·배지·표 셀·바코드·이미지 자체는 이 토큰
 * 대상이 아니다(기존 wmsButtonBase 등 그대로 유지).
 */
export const wmsOuterCardBorderColor = "#d8d3cc";
export const wmsOuterCardRadius = "14px";
export const wmsCardRadius = "12px";

/** 페이지에서 가장 큰 외곽 섹션 카드(발주서 초안 카드, 안내 배너, 옵션 상세 카드 등) */
export const wmsOuterCard = {
  background: "#ffffff",
  border: `1px solid ${wmsOuterCardBorderColor}`,
  borderRadius: wmsOuterCardRadius,
  boxShadow: "0 4px 16px rgba(30,28,25,.045)",
} as const;
