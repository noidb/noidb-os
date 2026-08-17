"use client";

import type { CSSProperties, ReactNode } from "react";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";

export const warehousePageStyle: CSSProperties = {
  maxWidth: WMS_MOBILE_WIDTH,
  margin: "0 auto",
  padding: "16px",
  fontFamily: "sans-serif",
  background: wmsColors.background,
  color: wmsColors.ink,
  minHeight: "100vh",
  overflowX: "hidden",
  boxSizing: "border-box",
};

export function WarehouseScreen({ children }: { children: ReactNode }) {
  return <main style={warehousePageStyle}>{children}</main>;
}

export function BackLink({ href, label = "← 뒤로" }: { href: string; label?: string }) {
  return (
    <a href={href} style={{ ...wmsGhostButton, display: "inline-flex", alignItems: "center", marginBottom: "12px", textDecoration: "none" }}>
      {label}
    </a>
  );
}

export function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: wmsColors.surfaceBeige, border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "10px", textAlign: "center" }}>
      <div style={{ fontSize: "18px", fontWeight: 800 }}>{value}</div>
      <div style={{ fontSize: "11px", color: wmsColors.muted, marginTop: "2px" }}>{label}</div>
    </div>
  );
}

export function BigNavButton({ href, label, sub }: { href: string; label: string; sub?: string }) {
  return (
    <a
      href={href}
      style={{
        ...wmsPrimaryButton,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        height: "auto",
        minHeight: "56px",
        padding: "12px 16px",
        textDecoration: "none",
        marginBottom: "10px",
      }}
    >
      <span style={{ fontSize: "16px" }}>{label}</span>
      {sub && <span style={{ fontSize: "12px", fontWeight: 400, opacity: 0.85, marginTop: "2px" }}>{sub}</span>}
    </a>
  );
}

export function FormField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label style={{ display: "block", marginBottom: "14px" }}>
      <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "6px" }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: "11px", color: wmsColors.muted, marginTop: "4px" }}>{hint}</div>}
    </label>
  );
}

export const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "48px",
  fontSize: "16px",
  padding: "0 12px",
  borderRadius: "10px",
  border: `1px solid ${wmsColors.borderStrong}`,
  boxSizing: "border-box",
  background: "#ffffff",
  color: wmsColors.ink,
};

export const selectStyle: CSSProperties = { ...inputStyle };

export const textareaStyle: CSSProperties = { ...inputStyle, minHeight: "72px", padding: "10px 12px", resize: "vertical" };

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "12px", padding: "14px", marginBottom: "12px", background: "#ffffff", ...style }}>
      {children}
    </div>
  );
}

export { wmsColors, wmsPrimaryButton, wmsSecondaryButton, wmsGhostButton };
