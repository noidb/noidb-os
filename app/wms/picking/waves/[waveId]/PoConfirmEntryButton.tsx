"use client";

import { useRouter } from "next/navigation";
import { wmsBronzeButton } from "@/lib/wms/ui-tokens";

/** 피킹 목록 상단에서 기존 완료 화면의 실제 발주확정 서류 생성 흐름으로 바로 이동한다. */
export default function PoConfirmEntryButton({ waveId, itemCount }: { waveId: string; itemCount: number }) {
  const router = useRouter();
  const disabled = itemCount === 0;

  return (
    <div style={{ marginBottom: "14px" }}>
      <button
        type="button"
        onClick={() => router.push(`/wms/picking/waves/${waveId}/complete`)}
        disabled={disabled}
        style={{
          ...wmsBronzeButton,
          width: "100%",
          minHeight: "48px",
          fontSize: "15px",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        발주확정 서류 생성
      </button>
    </div>
  );
}
