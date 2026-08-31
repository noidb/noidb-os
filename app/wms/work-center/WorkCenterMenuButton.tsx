import type { CSSProperties, ReactNode } from "react";

interface Props {
  icon: ReactNode;
  title: string;
  tint: string;
  borderTint: string;
  textColor: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}

/**
 * 작업센터 상단 3개 메뉴 버튼(거래처 발주관리/상품공급상태 업데이트/신규발주서 업데이트)이
 * 공유하는 단일 버튼 컴포넌트 (2026-08-20 신규). 크기·아이콘 위치·제목 위치를 한 곳에서만
 * 정의해 세 버튼이 항상 완전히 동일한 규격을 갖도록 한다 — 색상(tint 계열)만 버튼별로 다르게
 * 넘기고, 검정·파랑 등 새 색은 쓰지 않는다(호출하는 쪽에서 wmsColors 토큰만 넘김).
 * href가 있으면 페이지 이동(<a>), 없으면 onClick 액션 버튼(<button>)으로 렌더링한다.
 */
export default function WorkCenterMenuButton({ icon, title, tint, borderTint, textColor, href, onClick, disabled }: Props) {
  const boxStyle = {
    "--wms-work-center-menu-background": tint,
    "--wms-work-center-menu-border": borderTint,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    width: "100%",
    minHeight: "96px",
    padding: "16px 10px",
    borderRadius: "14px",
    opacity: disabled ? 0.55 : 1,
    boxSizing: "border-box",
  } as CSSProperties;

  const content = (
    <>
      <div className="wms-work-center-menu-icon" style={{ width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div className="wms-work-center-menu-title" style={{ fontSize: "14px", fontWeight: 800, color: textColor, textAlign: "center", lineHeight: 1.3 }}>{title}</div>
    </>
  );

  if (href) {
    return (
      <a className="wms-work-center-menu-control" href={href} style={{ ...boxStyle, textDecoration: "none" }}>
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      className="wms-work-center-menu-control"
      onClick={onClick}
      disabled={disabled}
      style={{ ...boxStyle, margin: 0, cursor: disabled ? "default" : "pointer" }}
    >
      {content}
    </button>
  );
}
