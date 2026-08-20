import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NOID-B OS",
  description: "상품 · 이미지 · 재고 · 발주를 관리하는 Seller Workspace",
  applicationName: "NOID-B OS",
  manifest: "/manifest.webmanifest",
  icons: {
    // 승인된 N 로고로 교체(2026-08-20) — iPhone 홈 화면 캐시가 매우 강해 쿼리스트링만으로는
    // 재설치된 아이콘이 갱신되지 않을 수 있어 실제 새 파일명(/icons/noidb-*-v3.png)을 쓴다.
    // 구 경로(/icon-192.png 등)도 같은 파일로 유지해 캐시된 구 URL 요청에도 승인 로고가 나간다.
    // public/favicon.ico는 이번에 Node 스크립트로 approved 192×192 PNG를 PNG-in-ICO 포맷으로
    // 감싸 실제 ICO 형식으로 교체했다(REPORT 참고, 재생성 아님 — 원본 픽셀 그대로).
    icon: [
      { url: "/icons/noidb-icon-192-v3.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/noidb-icon-512-v3.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico?v=3" }],
    apple: [{ url: "/icons/noidb-apple-touch-v3.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "NOID-B OS", statusBarStyle: "black-translucent" },
  openGraph: {
    title: "NOID-B OS",
    siteName: "NOID-B OS",
    description: "상품 · 이미지 · 재고 · 발주를 관리하는 Seller Workspace",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "NOID-B OS",
    description: "상품 · 이미지 · 재고 · 발주를 관리하는 Seller Workspace",
  },
};

export const viewport = {
  themeColor: "#252525",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
