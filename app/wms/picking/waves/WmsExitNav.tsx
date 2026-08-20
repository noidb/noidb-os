"use client";

import { wmsColors } from "@/lib/wms/ui-tokens";
import { ListIcon } from "../../icons";

/**
 * 통합 피킹 화면들(웨이브 상세/체크리스트/완료 웨이브 수정)에서 웨이브 목록으로 확실히 돌아갈 수
 * 있게 하는 이동 바 (2026-08-19 2차 실사용 테스트 반영, 4차 실사용 테스트에서 HOME 버튼 제거 —
 * 이제 app/wms/layout.tsx의 공통 WmsHomeHeader가 모든 화면에서 HOME을 담당하므로, 같은 화면에
 * HOME 버튼이 두 번 보이지 않도록 여기서는 "웨이브 목록"만 남긴다). 일반 <a href>로 이동하므로
 * 카카오톡 링크나 새 탭으로 바로 들어온 경우에도 항상 정상 동작한다(history에 의존하지 않음).
 */
export default function WmsExitNav({ waveListHref = "/wms/picking/waves" }: { waveListHref?: string }) {
  return (
    <div style={{ marginBottom: "10px" }}>
      <a href={waveListHref} style={{ textDecoration: "none" }}>
        <button
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            minHeight: "44px",
            padding: "0 14px",
            borderRadius: "10px",
            background: wmsColors.surfaceBeige,
            color: wmsColors.ink,
            border: `1px solid ${wmsColors.borderStrong}`,
            fontWeight: 800,
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          <ListIcon size={16} />
          웨이브 목록
        </button>
      </a>
    </div>
  );
}
