"use client";

import { usePathname, useRouter } from "next/navigation";
import { WMS_MOBILE_WIDTH, wmsColors } from "@/lib/wms/ui-tokens";
import { HomeIcon } from "./icons";
import { useWmsUndo } from "@/lib/wms/undo-context";

/**
 * 모든 /wms/* 화면에 공통으로 보이는 HOME 버튼 (2026-08-19 4차 실사용 테스트 반영).
 * app/wms/layout.tsx에서 한 번만 렌더링되므로 각 페이지가 중복으로 만들 필요가 없다.
 * 브라우저 history.back에 의존하지 않고 항상 /wms/work-center로 직접 이동하는 <a href>를 쓴다 —
 * 카카오톡 링크나 새 탭으로 바로 들어온 경우에도 항상 정상 동작한다.
 */
export default function WmsHomeHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === "/wms/work-center";
  const { canUndo, undoLabel, undoing, undoLast } = useWmsUndo();

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/wms/work-center");
  }

  return (
    <div
      style={{
        maxWidth: WMS_MOBILE_WIDTH,
        margin: "0 auto",
        padding: "calc(env(safe-area-inset-top) + 8px) 12px 0",
      }}
    >
      {/* AI 상품등록 화면(app/page.tsx)과 같은 브랜드 로고(.brandLockup/.brandMark, app/globals.css
       *  318행대) — 승인된 N 로고 원본(public/icon-192.png) 하나만 쓴다(2026-08-20, 1번·1-1번
       *  디자인 통일 요구사항). 새 스타일을 추가하지 않고 기존 클래스를 그대로 재사용한다. */}
      <div className="brandLockup" style={{ marginBottom: "10px" }}>
        <img className="brandMark" src="/icons/noidb-icon-192-v3.png" alt="" aria-hidden="true" />
        <div>
          <p className="brandWordmark">NOID-B OS</p>
          <span>Seller Workspace</span>
        </div>
      </div>

      {/* 작업센터(HOME) 화면에서는 "HOME (현재 위치)" 배지와 그 전용 줄 자체를 렌더링하지 않는다
       *  — 브랜드 헤더 바로 아래 제목이 오도록(2026-08-20 실기기 추가 확인 1번). 다른 화면에서는
       *  실제 이동 기능이 있는 HOME 버튼을 그대로 유지한다. */}
      {!isHome && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <button
            type="button"
            onClick={goBack}
            style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", background: "#ffffff", color: wmsColors.ink, minHeight: "44px", padding: "0 14px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}
          >
            ← 뒤로가기
          </button>
          <button type="button" disabled={!canUndo || undoing} title={undoLabel || "되돌릴 작업 없음"} onClick={undoLast} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", background: wmsColors.surfaceBeige, color: wmsColors.ink, minHeight: "44px", padding: "0 12px", fontSize: "12px", fontWeight: 800, cursor: canUndo ? "pointer" : "default", opacity: canUndo ? 1 : 0.45 }}>
            {undoing ? "복원 중" : "↶ 되돌리기"}
          </button>
          <a href="/wms/work-center" style={{ textDecoration: "none" }}>
          <button
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              minHeight: "44px",
              padding: "0 14px",
              borderRadius: "10px",
              background: wmsColors.slate,
              color: "#ffffff",
              border: "1px solid transparent",
              fontWeight: 800,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            <HomeIcon size={16} />
            HOME
          </button>
          </a>
        </div>
      )}
    </div>
  );
}
