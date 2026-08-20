"use client";

import { useEffect, useState } from "react";
import { wmsColors, wmsSageButton, wmsGhostButton } from "@/lib/wms/ui-tokens";

interface StatusResponse {
  configured: boolean;
  connected: boolean;
  connectedAt: string | null;
  folderReady: boolean;
  usingEnvRefreshToken: boolean;
}

interface Props {
  /** 연결 상태가 바뀔 때마다(최초 조회 포함) 알려준다 — 업로드 버튼 활성화 여부에 쓴다. */
  onStatusChange?: (connected: boolean) => void;
  compact?: boolean;
}

/**
 * Google Drive 이미지 업로드용 사용자 OAuth 연결 상태를 보여주고 연결/재확인/해제를 할 수 있는
 * 패널 (2026-08-20 신규). 이미지 변경창(ImageEditSheet)에서 재사용한다.
 *
 * 연결/재연결은 보안상 localhost에서만 시도한다 — Cloudflare Tunnel(휴대폰) 화면에서는 버튼을
 * 숨기고 안내만 보여준다. 서버(app/api/auth/google-drive/start)도 origin을 다시 검증하므로
 * 이 클라이언트 쪽 숨김은 방어 심층화 목적이다.
 */
export default function GoogleDriveConnectionPanel({ onStatusChange, compact }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/google-drive/status");
      const data: StatusResponse = await response.json();
      setStatus(data);
      onStatusChange?.(data.connected);
    } catch {
      setStatus(null);
      onStatusChange?.(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const host = window.location.hostname;
    setIsLocalhost(host === "localhost" || host === "127.0.0.1");
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDisconnect() {
    if (!window.confirm("Google Drive 연결을 해제할까요? 기존에 올라간 이미지나 제품DB의 이미지 URL은 삭제되지 않습니다.")) return;
    setDisconnecting(true);
    setActionMessage(null);
    try {
      const response = await fetch("/api/auth/google-drive/disconnect", { method: "POST" });
      const data = await response.json();
      if (data.note) setActionMessage(data.note);
      await refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading && !status) {
    return <p style={{ fontSize: "11px", color: wmsColors.muted, margin: compact ? "0 0 8px" : "0 0 12px" }}>Google Drive 연결 상태 확인 중...</p>;
  }

  if (!status || !status.configured) {
    return (
      <p style={{ fontSize: "11px", color: wmsColors.warnText, background: wmsColors.warnSoft, borderRadius: "8px", padding: "8px 10px", margin: compact ? "0 0 8px" : "0 0 12px" }}>
        Google Drive 연결이 아직 설정되지 않았습니다(관리자 설정 필요) — 이미지 업로드를 쓸 수 없습니다.
      </p>
    );
  }

  if (status.connected) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: compact ? "8px" : "12px", fontSize: "11px" }}>
        <span style={{ color: wmsColors.greenDark, fontWeight: 700 }}>
          ✅ Google Drive 연결됨{!status.folderReady ? " (업로드 폴더는 첫 업로드 때 준비됩니다)" : ""}
        </span>
        <div style={{ display: "flex", gap: "6px" }}>
          <button type="button" onClick={() => void refresh()} style={{ ...wmsGhostButton, padding: "4px 8px", fontSize: "10px" }}>
            연결 다시 확인
          </button>
          <button type="button" onClick={handleDisconnect} disabled={disconnecting} style={{ ...wmsGhostButton, padding: "4px 8px", fontSize: "10px", opacity: disconnecting ? 0.6 : 1 }}>
            연결 해제
          </button>
        </div>
        {actionMessage && <p style={{ fontSize: "10px", color: wmsColors.muted, margin: 0 }}>{actionMessage}</p>}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: compact ? "8px" : "12px" }}>
      <p style={{ fontSize: "11px", color: wmsColors.warnText, background: wmsColors.warnSoft, borderRadius: "8px", padding: "8px 10px", margin: "0 0 8px" }}>
        Google Drive 연결이 필요합니다.
      </p>
      {isLocalhost ? (
        <a href="/api/auth/google-drive/start" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
          <button type="button" style={{ ...wmsSageButton, width: "100%" }}>
            Google Drive 연결
          </button>
        </a>
      ) : (
        <p style={{ fontSize: "10px", color: wmsColors.muted, margin: 0 }}>
          Google Drive 연결/재연결은 집 PC(localhost)에서만 할 수 있습니다. 집 PC에서 한 번 연결하면 이 화면에서도 업로드가 가능해집니다.
        </p>
      )}
    </div>
  );
}
