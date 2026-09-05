import { getWmsFolderConnectionStatuses } from "@/lib/wms/folder-connections";
import { WMS_DESKTOP_WIDTH, wmsColors } from "@/lib/wms/ui-tokens";

export const dynamic = "force-dynamic";

export default async function FolderConnectionsPage() {
  const connections = await getWmsFolderConnectionStatuses();
  const connectedCount = connections.filter(item => item.connected).length;

  return (
    <main style={{ width: "100%", maxWidth: WMS_DESKTOP_WIDTH, boxSizing: "border-box", margin: "0 auto", padding: "14px 12px 28px", color: wmsColors.ink }}>
      <section style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "16px", background: wmsColors.surface, padding: "16px" }}>
        <p style={{ margin: 0, color: wmsColors.greenDark, fontSize: "11px", fontWeight: 900, letterSpacing: ".08em" }}>ADMIN</p>
        <h1 style={{ margin: "6px 0 4px", fontSize: "24px" }}>파일폴더 연결</h1>
        <p style={{ margin: 0, color: wmsColors.muted, fontSize: "13px", lineHeight: 1.6 }}>자동 탐색·저장에 필요한 폴더 상태입니다. 비밀값과 내부 식별번호는 표시하지 않습니다.</p>
        <div style={{ marginTop: "12px", borderRadius: "12px", background: wmsColors.surfaceBeige, padding: "12px 14px", fontSize: "14px", fontWeight: 900 }}>
          전체 {connections.length}개 · 연결됨 {connectedCount}개 · 확인 필요 {connections.length - connectedCount}개
        </div>
      </section>

      <section aria-label="폴더 연결 상태" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: "10px", marginTop: "12px" }}>
        {connections.map(item => (
          <article key={item.key} style={{ minWidth: 0, border: `1px solid ${item.connected ? wmsColors.green : wmsColors.warnSoftBorder}`, borderRadius: "14px", background: item.connected ? wmsColors.greenSoft : wmsColors.warnSoft, padding: "14px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
              <strong style={{ fontSize: "15px", lineHeight: 1.35 }}>{item.label}</strong>
              <span style={{ flexShrink: 0, borderRadius: "999px", background: item.connected ? wmsColors.green : wmsColors.warn, color: "#fff", padding: "5px 8px", fontSize: "11px", fontWeight: 900 }}>
                {item.connected ? "연결됨" : "연결 확인 필요"}
              </span>
            </div>
            <p style={{ margin: "7px 0 0", color: wmsColors.muted, fontSize: "12px", lineHeight: 1.5 }}>{item.description}</p>
          </article>
        ))}
      </section>

      {!userDriveConnectedPlaceholder(connections) ? null : (
        <section style={{ marginTop: "12px", border: `1px solid ${wmsColors.warnSoftBorder}`, borderRadius: "14px", background: "#fff", padding: "14px" }}>
          <strong style={{ fontSize: "14px" }}>Google Drive 다시 연결이 필요합니다.</strong>
          <p style={{ margin: "5px 0 10px", color: wmsColors.muted, fontSize: "12px", lineHeight: 1.5 }}>입고파일 자동 확인을 다시 사용하려면 한 번만 연결해 주세요.</p>
          <a href="/api/auth/google-drive/start?returnTo=/wms/settings/folder-connections" style={{ display: "inline-flex", minHeight: "44px", alignItems: "center", justifyContent: "center", borderRadius: "10px", background: wmsColors.slate, color: "#fff", textDecoration: "none", padding: "0 14px", fontSize: "13px", fontWeight: 900 }}>Google Drive 다시 연결</a>
        </section>
      )}
    </main>
  );
}

function userDriveConnectedPlaceholder(connections: Awaited<ReturnType<typeof getWmsFolderConnectionStatuses>>) {
  return connections.some(item => item.key === "inbound" && !item.connected);
}
