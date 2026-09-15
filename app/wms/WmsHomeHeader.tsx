"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { WMS_DESKTOP_WIDTH, wmsColors } from "@/lib/wms/ui-tokens";
import { HomeIcon } from "./icons";

/**
 * 모든 /wms/* 화면에 공통으로 보이는 상단 헤더(로고 + 뒤로가기 + HOME) (2026-08-19 4차 실사용
 * 테스트 반영). app/wms/layout.tsx에서 한 번만 렌더링되므로 각 페이지가 중복으로 만들 필요가 없다.
 * 브라우저 history.back에 의존하지 않고 항상 /wms/work-center로 직접 이동하는 <a href>를 쓴다 —
 * 카카오톡 링크나 새 탭으로 바로 들어온 경우에도 항상 정상 동작한다.
 *
 * 2026-09-11 UI 정리:
 * - 로고와 뒤로가기/HOME이 서로 다른 줄에 떨어져 있던 것을 한 줄(헤더 흐름) 안에 배치 —
 *   왼쪽 로고, 오른쪽 뒤로가기+HOME. 로고가 본문과 따로 튀어나와 보이던 문제 해결.
 *   Undo 기능 자체(lib/wms/undo-context)는 그대로 유지 — 각 화면(예: 거래처 발주서 관리·입고
 *   화면)이 필요할 때 직접 pushUndo/복원 흐름을 쓴다. 이 공통 헤더에서 "↶ 되돌리기" 버튼만
 *   뺐다 — 항상 비활성 상태로 가운데 흐릿하게 떠 있어 실제 업무 순서를 방해한다는 피드백 반영.
 * - 헤더 좌우 여백을 본문 카드 컨테이너(app/wms/layout.tsx의 .wms-rounded-page-shell)와 같은
 *   값(모바일 0 / PC 24px)으로 맞춰 PC 화면에서 헤더와 본문 카드의 좌우 시작선이 일치하게 했다.
 */
export default function WmsHomeHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === "/wms/work-center";

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/wms/work-center");
  }

  // 작업센터는 AI 상품등록 화면과 공유하는 AppNavigation을 직접 렌더링한다.
  // 다른 WMS 화면의 헤더는 기존대로 유지한다.
  if (isHome) return null;

  return (
    <div className="wmsHomeHeader">
      <div className="wmsHomeHeaderRow">
        {/* AI 상품등록 화면(app/page.tsx)과 같은 브랜드 로고(.brandLockup/.brandMark, app/globals.css
         *  318행대) — 승인된 N 로고 원본 하나만 쓴다. 새 스타일을 추가하지 않고 기존 클래스를
         *  그대로 재사용한다(로고 자체 디자인은 바꾸지 않음). */}
        <div className="brandLockup" style={{ marginBottom: 0 }}>
          <img className="brandMark" src="/icons/noidb-icon-192-v3.png" alt="" aria-hidden="true" />
          <div>
            <p className="brandWordmark">NOID-B OS</p>
            <span>Seller Workspace</span>
          </div>
        </div>

        <div className="wmsHomeHeaderActions">
          <button type="button" onClick={goBack} className="wmsHomeHeaderButton wmsHomeHeaderButtonGhost">
            ← 뒤로
          </button>
          <Link href="/wms/work-center" style={{ textDecoration: "none" }}>
            <button type="button" className="wmsHomeHeaderButton wmsHomeHeaderButtonPrimary">
              <HomeIcon size={16} />
              HOME
            </button>
          </Link>
        </div>
      </div>

      <style jsx>{`
        .wmsHomeHeader {
          width: 100%;
          max-width: ${WMS_DESKTOP_WIDTH}px;
          box-sizing: border-box;
          margin: 0 auto;
          padding: calc(env(safe-area-inset-top) + 8px) 0 0;
        }
        .wmsHomeHeaderRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 0 12px;
        }
        .wmsHomeHeaderActions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .wmsHomeHeaderButton {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 44px;
          padding: 0 14px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
        }
        .wmsHomeHeaderButtonGhost {
          border: 1px solid ${wmsColors.border};
          background: #ffffff;
          color: ${wmsColors.ink};
        }
        .wmsHomeHeaderButtonPrimary {
          border: 1px solid transparent;
          background: ${wmsColors.slate};
          color: #ffffff;
        }
        @media (min-width: 761px) {
          .wmsHomeHeaderRow {
            padding: 0 24px;
          }
        }
      `}</style>
    </div>
  );
}
