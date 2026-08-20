"use client";

import { useState } from "react";
import type { PickingWaveItem } from "@/lib/wms/picking-wave/types";
import type { LiveResolvedFields } from "@/lib/wms/picking-wave/live-catalog";
import { getWmsDisplayImageUrl } from "@/lib/wms/image-display-url";
import { wmsColors, wmsGhostButton } from "@/lib/wms/ui-tokens";

interface Props {
  item: PickingWaveItem;
  live: LiveResolvedFields;
}

interface LoadTestResult {
  attempted: boolean;
  ok: boolean | null;
  detail: string;
}

interface CatalogRawInfo {
  found: boolean;
  skuId?: string;
  modelSku?: string;
  status?: string;
  productName?: string;
  rawImageCell?: string;
}

function testImageLoad(url: string): Promise<LoadTestResult> {
  return new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve({ attempted: true, ok: false, detail: "타임아웃(8초)" }), 8000);
    img.onload = () => {
      clearTimeout(timer);
      resolve({ attempted: true, ok: true, detail: `로드 성공 (${img.naturalWidth}x${img.naturalHeight})` });
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve({ attempted: true, ok: false, detail: "브라우저에서 로드 실패(onerror)" });
    };
    img.src = url;
  });
}

/**
 * 개발 환경 전용 이미지 진단 패널 (2026-08-20 신규 — WAVE-20260819-1 이미지 미표시 실제 원인
 * 추적용). OAuth 토큰/서비스 계정 키/쿠키 등은 전혀 다루지 않는다 — 이미 화면에 보이는 상품
 * 정보(SKU/모델SKU/이미지 URL)와 제품DB 원본 이미지 셀 값만 보여준다. NODE_ENV가
 * "development"가 아니면 아무것도 렌더링하지 않는다.
 */
export default function ImageDiagnosticsPanel({ item, live }: Props) {
  const [open, setOpen] = useState(false);
  const [catalogRaw, setCatalogRaw] = useState<CatalogRawInfo | null>(null);
  const [loadingCatalogRaw, setLoadingCatalogRaw] = useState(false);
  const [directTest, setDirectTest] = useState<LoadTestResult>({ attempted: false, ok: null, detail: "" });
  const [proxyTest, setProxyTest] = useState<LoadTestResult>({ attempted: false, ok: null, detail: "" });
  const [testing, setTesting] = useState(false);

  if (process.env.NODE_ENV !== "development") return null;

  const displaySrc = getWmsDisplayImageUrl(live.imageUrl);
  const proxied = Boolean(displaySrc) && displaySrc !== live.imageUrl;

  let urlHost: string | null = null;
  let urlProtocol: string | null = null;
  try {
    if (live.imageUrl) {
      const parsed = new URL(live.imageUrl);
      urlHost = parsed.host;
      urlProtocol = parsed.protocol;
    }
  } catch {
    urlHost = "URL 파싱 실패";
  }

  async function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !catalogRaw) {
      setLoadingCatalogRaw(true);
      try {
        const res = await fetch(`/api/wms/debug/product-image-info?skuId=${encodeURIComponent(item.productCode)}`);
        setCatalogRaw(await res.json());
      } catch {
        setCatalogRaw({ found: false });
      } finally {
        setLoadingCatalogRaw(false);
      }
    }
  }

  async function runLoadTests() {
    if (!live.imageUrl) return;
    setTesting(true);
    setDirectTest({ attempted: false, ok: null, detail: "" });
    setProxyTest({ attempted: false, ok: null, detail: "" });
    const proxyUrl = live.imageUrl.startsWith("/api/wms/image-proxy") ? live.imageUrl : `/api/wms/image-proxy?url=${encodeURIComponent(live.imageUrl)}`;
    const [direct, proxy] = await Promise.all([testImageLoad(live.imageUrl), testImageLoad(proxyUrl)]);
    setDirectTest(direct);
    setProxyTest(proxy);
    setTesting(false);
  }

  return (
    <div style={{ marginTop: "10px" }}>
      <button onClick={handleOpen} style={{ ...wmsGhostButton, width: "100%", minHeight: "30px", fontSize: "10px" }}>
        {open ? "이미지 진단 정보 접기" : "🔧 이미지 진단 정보 (개발용)"}
      </button>
      {open && (
        <div
          style={{
            marginTop: "6px",
            background: "#111",
            color: "#0f0",
            borderRadius: "8px",
            padding: "10px",
            fontSize: "10px",
            fontFamily: "monospace",
            lineHeight: 1.6,
            overflowX: "auto",
          }}
        >
          <div>productCode(SKU): {item.productCode}</div>
          <div>item.modelSku(웨이브 저장값): {item.modelSku || "(없음)"}</div>
          <div>matchedBy: {live.matchedBy}</div>
          <div>liveModelSku(제품DB 매칭값): {live.liveModelSku || "(없음)"}</div>
          <div>liveSkuId(제품DB 실제 SKU ID): {live.liveSkuId || "(없음)"}</div>
          <div>item.imageUrl(웨이브 스냅샷): {item.imageUrl || "(없음)"}</div>
          <div>live.imageUrl(원본, 데이터 비교용): {live.imageUrl || "(없음)"}</div>
          <div style={{ color: proxied ? "#0ff" : "#0f0" }}>화면 표시 displaySrc(실제 img src): {displaySrc || "(없음)"}</div>
          <div>프록시 적용 여부: {proxied ? "예 (image-proxy 경유)" : displaySrc ? "아니오 (원본 직접 사용)" : "-"}</div>
          <div>URL host: {urlHost || "-"}</div>
          <div>URL protocol: {urlProtocol || "-"}</div>

          <div style={{ marginTop: "8px", borderTop: "1px solid #333", paddingTop: "6px" }}>제품DB 원본 셀 (skuId 기준 재조회):</div>
          {loadingCatalogRaw && <div>조회 중...</div>}
          {catalogRaw && catalogRaw.found === false && <div style={{ color: "#f88" }}>제품DB에서 이 SKU ID를 찾지 못함</div>}
          {catalogRaw && catalogRaw.found && (
            <>
              <div>제품DB skuId: {catalogRaw.skuId}</div>
              <div>제품DB modelSku: {catalogRaw.modelSku || "(없음)"}</div>
              <div>제품DB 현재상태: {catalogRaw.status}</div>
              <div style={{ wordBreak: "break-all" }}>원본 이미지 셀 값: {catalogRaw.rawImageCell || "(빈 셀)"}</div>
            </>
          )}

          <div style={{ marginTop: "8px", borderTop: "1px solid #333", paddingTop: "6px" }}>
            <button onClick={runLoadTests} disabled={!live.imageUrl || testing} style={{ fontSize: "10px", padding: "4px 8px", cursor: "pointer" }}>
              {testing ? "브라우저에서 실제 로드 테스트 중..." : "브라우저에서 실제 로드 테스트 실행"}
            </button>
          </div>
          {directTest.attempted && (
            <div style={{ color: directTest.ok ? "#0f0" : "#f88" }}>직접 로드: {directTest.ok ? "성공" : "실패"} — {directTest.detail}</div>
          )}
          {proxyTest.attempted && (
            <div style={{ color: proxyTest.ok ? "#0f0" : "#f88" }}>image-proxy 경유: {proxyTest.ok ? "성공" : "실패"} — {proxyTest.detail}</div>
          )}
        </div>
      )}
    </div>
  );
}
