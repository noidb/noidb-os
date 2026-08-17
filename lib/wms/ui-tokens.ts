/**
 * WMS 모바일 피킹 화면 공통 디자인 토큰.
 * 팔레트: 화이트 / 블랙(잉크) / 베이지 / 그린 중심, 파란색 계열 사용하지 않음.
 * app/globals.css의 --brand-* 커스텀 프로퍼티(:root 전역)와 값을 맞춰 앱 전체 톤을 통일한다.
 */

export const WMS_MOBILE_WIDTH = 390;

export const wmsColors = {
  background: "#ffffff",
  surface: "#faf8f4",
  surfaceBeige: "#f4f1ec",
  border: "#e5dace",
  borderStrong: "#cfc0b0",
  ink: "#252525",
  muted: "#77716a",
  green: "#60766a",
  greenDark: "#4d6358",
  greenSoft: "#e3ece6",
  warn: "#a6614e",
  warnSoft: "#f2dfd8",
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

export const wmsPrimaryButton = {
  ...wmsButtonBase,
  background: wmsColors.ink,
  color: "#ffffff",
};

export const wmsSecondaryButton = {
  ...wmsButtonBase,
  background: wmsColors.surfaceBeige,
  color: wmsColors.ink,
  border: `1px solid ${wmsColors.borderStrong}`,
};

export const wmsWarnButton = {
  ...wmsButtonBase,
  background: "#ffffff",
  color: wmsColors.warn,
  border: `1px solid ${wmsColors.warn}`,
};

export const wmsGhostButton = {
  ...wmsButtonBase,
  background: "#ffffff",
  color: wmsColors.muted,
  border: `1px solid ${wmsColors.border}`,
};
