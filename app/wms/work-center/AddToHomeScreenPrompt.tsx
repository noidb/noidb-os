"use client";

import { useEffect, useState } from "react";
import { wmsColors, wmsSecondaryButton } from "@/lib/wms/ui-tokens";

const DISMISS_KEY = "noidb_wms_a2hs_dismissed_v1";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function detectEnv() {
  const ua = window.navigator.userAgent || "";
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  // 카카오톡/네이버/인스타그램/페이스북/라인 인앱 브라우저 — 홈 화면 추가가 제한되거나 불가능하다.
  const isInApp = /kakaotalk|naver|instagram|fban|fbav|line\//i.test(ua);
  return { isStandalone, isIOS, isInApp };
}

/**
 * 홈 화면에 추가 안내 배너 (2026-08-19 2차 실사용 테스트 반영 — 카카오톡 링크를 매번 찾는
 * 번거로움 해소). 브라우저별로 실제로 가능한 것만 안내한다 — 인앱 브라우저에서 설치가 된 것처럼
 * 거짓 안내하지 않는다. 한 번 닫으면(localStorage) 다시 뜨지 않는다.
 */
export default function AddToHomeScreenPrompt() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [env, setEnv] = useState<{ isStandalone: boolean; isIOS: boolean; isInApp: boolean } | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    setEnv(detectEnv());
    setReady(true);
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  if (!ready || dismissed || !env || env.isStandalone) return null;

  async function handleInstallClick() {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      dismiss();
      return;
    }
    if (env!.isIOS) {
      setShowIOSGuide(prev => !prev);
      return;
    }
    window.alert("이 브라우저는 자동 설치 안내를 지원하지 않습니다. 브라우저 메뉴에서 '홈 화면에 추가' 또는 '앱 설치'를 선택해주세요.");
  }

  return (
    <div style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "12px", marginBottom: "14px", background: wmsColors.surfaceBeige }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
        <div style={{ fontSize: "12px", color: wmsColors.ink, lineHeight: 1.5 }}>
          {env.isInApp
            ? "카카오톡·네이버 등 인앱 브라우저에서는 홈 화면 추가가 제한됩니다. 우측 상단 메뉴에서 '다른 브라우저로 열기'(또는 'Safari로 열기')를 선택한 뒤 다시 시도해주세요."
            : "매번 링크를 찾지 않도록 홈 화면에 NOID-B OS 아이콘을 추가할 수 있습니다."}
        </div>
        <button onClick={dismiss} aria-label="닫기" style={{ background: "none", border: "none", color: wmsColors.muted, fontSize: "16px", cursor: "pointer", flexShrink: 0, lineHeight: 1 }}>
          ×
        </button>
      </div>

      {!env.isInApp && (
        <button onClick={handleInstallClick} style={{ ...wmsSecondaryButton, width: "100%", marginTop: "8px", minHeight: "38px", fontSize: "12px" }}>
          홈 화면에 추가
        </button>
      )}

      {showIOSGuide && (
        <div style={{ marginTop: "8px", fontSize: "11px", color: wmsColors.ink, lineHeight: 1.7 }}>
          1. Safari 하단 공유 버튼을 눌러주세요
          <br />
          2. "홈 화면에 추가"를 선택해주세요
          <br />
          3. 이름을 확인한 뒤 "추가"를 눌러주세요
        </div>
      )}
    </div>
  );
}
