import type { ReactNode } from "react";
import { wmsColors } from "@/lib/wms/ui-tokens";

export type ShipmentWorkflowStepStatus = "done" | "current";

export default function ShipmentWorkflowStepCard({ step, title, subtitle, status, children }: {
  step: number;
  title: string;
  subtitle?: string;
  status: ShipmentWorkflowStepStatus;
  children: ReactNode;
}) {
  const badge = status === "done"
    ? { label: "완료", bg: wmsColors.greenSoft, color: wmsColors.greenDark }
    : { label: "진행 가능", bg: "rgba(83,109,120,0.12)", color: wmsColors.slateDark };

  return <section style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "12px", marginBottom: "10px", background: "#fff" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: subtitle ? "2px" : "8px" }}>
      <h2 style={{ margin: 0, fontSize: "14px" }}>{step}. {title}</h2>
      <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 8px", borderRadius: "999px", background: badge.bg, color: badge.color, flexShrink: 0 }}>{badge.label}</span>
    </div>
    {subtitle ? <p style={{ fontSize: "10px", color: wmsColors.muted, margin: "0 0 8px" }}>{subtitle}</p> : null}
    {children}
  </section>;
}
