import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NOID-B OS",
  description: "노이드비 쿠팡 상품등록 도우미",
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
