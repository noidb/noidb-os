"use client";

import { wmsColors } from "@/lib/wms/ui-tokens";
import { NOIDB_EXTENSIONS } from "@/lib/wms/extension-info";

/**
 * 작업센터 '크롬 확장 프로그램'(2026-10-21 사용자 요청).
 * 확장 zip을 받으려고 여러 화면을 찾아가기 힘들어서, 두 확장의 받기 버튼·기능·설치 방법을 메인에 모은다(원래 화면의 받기 버튼도 그대로 둔다).
 */
export default function ExtensionDownloads() {
  return (
    <section aria-label="크롬 확장 프로그램" style={{ border: `1px solid ${wmsColors.border}`, background: "#fff", borderRadius: 14, padding: "14px 16px", margin: "0 0 18px" }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 18, color: wmsColors.ink, paddingLeft: 10, borderLeft: "4px solid #60766a" }}>크롬 확장 프로그램</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 8 }}>
        {NOIDB_EXTENSIONS.map(extension => (
          <article key={extension.id} style={{ border: "1px solid #e5dace", background: "#fbf8f4", borderRadius: 10, padding: "10px 12px", display: "grid", gridTemplateRows: "auto 1fr auto", gap: 6 }}>
            <div>
              <strong style={{ fontSize: 15, color: wmsColors.ink }}>{extension.name}</strong>
              <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 700, color: "#60766a" }}>v{extension.version}</span>
              <span style={{ display: "block", fontSize: 12, color: wmsColors.muted }}>{extension.where}</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: wmsColors.ink, lineHeight: 1.55 }}>
              {extension.features.map(feature => <li key={feature}>{feature}</li>)}
            </ul>
            <a className="softBeigeButton" style={{ minHeight: 38, padding: "6px 8px", fontSize: 13, textDecoration: "none" }} href={extension.zip} download>
              {extension.name} v{extension.version} 받기
            </a>
          </article>
        ))}
      </div>
      <details style={{ marginTop: 8, fontSize: 12, color: wmsColors.ink }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>설치·업데이트 방법</summary>
        <ol style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
          <li><b>업데이트(평소):</b> 받은 zip을 예전에 풀었던 폴더에 그대로 덮어써 풉니다.</li>
          <li>크롬 주소창에 <code>chrome://extensions</code> → 해당 확장의 새로고침(↻)을 누르고 버전이 위와 같은지 확인합니다.</li>
          <li>열려 있던 쿠팡·NOID-B 화면을 F5로 새로고침합니다.</li>
          <li><b>처음 한 번만 설치:</b> zip을 풀고 <code>chrome://extensions</code>에서 오른쪽 위 &apos;개발자 모드&apos;를 켠 뒤 &apos;압축해제된 확장 프로그램을 로드합니다&apos;로 그 폴더를 고릅니다.</li>
        </ol>
      </details>
    </section>
  );
}
