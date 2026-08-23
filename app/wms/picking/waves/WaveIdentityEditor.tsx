"use client";
import { useState } from "react";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsGhostButton, wmsPrimaryButton } from "@/lib/wms/ui-tokens";

export default function WaveIdentityEditor({ wave, onSave }: { wave: PickingWave; onSave: (wave: PickingWave) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(wave.displayName || "");
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  if (!editing) return <div style={{ minWidth: 0 }}><div style={{ fontSize: "20px", fontWeight: 900, overflowWrap: "anywhere" }}>{wave.displayName || wave.id}</div><div style={{ color: wmsColors.muted, fontSize: "12px", overflowWrap: "anywhere" }}>{wave.id}{wave.workerName ? ` · 작업자 ${wave.workerName}` : ""}</div><button onClick={() => { setName(wave.displayName || ""); setEditing(true); }} style={{ ...wmsGhostButton, minHeight: "32px", marginTop: "6px", fontSize: "11px" }}>이름 수정</button></div>;
  return <div style={{ width: "100%" }}><input value={name} onChange={event => setName(event.target.value)} aria-label="웨이브명" style={{ width: "100%", minWidth: 0, boxSizing: "border-box", minHeight: "42px", fontSize: "16px", padding: "8px", borderRadius: "8px", border: `1px solid ${wmsColors.borderStrong}` }} />{!trimmed && <div style={{ color: "#c0392b", fontSize: "11px", marginTop: "4px" }}>웨이브명은 비워둘 수 없습니다.</div>}<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "6px" }}><button disabled={saving} onClick={() => setEditing(false)} style={{ ...wmsGhostButton, minHeight: "36px" }}>취소</button><button disabled={saving || !trimmed} onClick={async () => { setSaving(true); await onSave({ ...wave, displayName: trimmed, updatedAt: new Date().toISOString() }); setSaving(false); setEditing(false); }} style={{ ...wmsPrimaryButton, minHeight: "36px", opacity: saving || !trimmed ? 0.5 : 1 }}>저장</button></div></div>;
}
