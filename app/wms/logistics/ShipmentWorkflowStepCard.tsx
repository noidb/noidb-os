import type { ReactNode } from "react";
import { wmsColors } from "@/lib/wms/ui-tokens";

/**
 * picking/waves/[waveId]/complete/ShipmentWorkflowStepCard.tsx와 동일한 컴포넌트를 이 폴더에
 * 복사해 둔 것 — 원본은 웨이브 자체와는 무관한 순수 표시용 컴포넌트지만, 그 폴더(picking/waves)는
 * 전체 삭제 대상이라 거기서 import하면 나중에 끊긴다. 로직 변경 없이 위치만 옮겼다.
 */
export type ShipmentWorkflowStepStatus = "done" | "current" | "blocked";

export default function ShipmentWorkflowStepCard({ id, step, title, subtitle, status, children }: {
  id?: string;
  step: number;
  title: string;
  subtitle?: string;
  status: ShipmentWorkflowStepStatus;
  children: ReactNode;
}) {
  const badge = status === "done"
    ? { label: "완료", bg: wmsColors.greenSoft, color: wmsColors.greenDark }
    : status === "current" ? { label: "진행 가능", bg: "rgba(83,109,120,0.12)", color: wmsColors.slateDark }
      : { label: "선행 기록 필요", bg: "#fff4d8", color: "#7a4d00" };

  return <section id={id} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "12px", marginBottom: "10px", background: "#fff", scrollMarginTop: "12px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: subtitle ? "2px" : "8px" }}>
      <h2 style={{ margin: 0, fontSize: "14px" }}>{step}. {title}</h2>
      <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 8px", borderRadius: "999px", background: badge.bg, color: badge.color, flexShrink: 0 }}>{badge.label}</span>
    </div>
    {subtitle ? <p style={{ fontSize: "10px", color: wmsColors.muted, margin: "0 0 8px" }}>{subtitle}</p> : null}
    {children}
  </section>;
}
