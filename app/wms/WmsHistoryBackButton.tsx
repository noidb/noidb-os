"use client";

import { useRouter } from "next/navigation";
import { WMS_MOBILE_WIDTH, wmsColors } from "@/lib/wms/ui-tokens";

/** 모든 WMS 화면에서 실제 브라우저 직전 화면으로 돌아가는 공통 버튼. */
export default function WmsHistoryBackButton() {
  const router = useRouter();
  return (
    <div style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto", padding: "8px 12px 0" }}>
      <button
        type="button"
        onClick={() => window.history.length > 1 ? router.back() : router.push("/wms")}
        style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", background: "#ffffff", color: wmsColors.ink, minHeight: "38px", padding: "0 14px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}
      >
        ← 뒤로가기
      </button>
    </div>
  );
}
