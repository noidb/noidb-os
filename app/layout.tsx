import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NOID-B OS",
  description: "상품 · 이미지 · 재고 · 발주를 관리하는 Seller Workspace",
  applicationName: "NOID-B OS",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
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
