import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "노이드비 AI",
  description: "사진 한 장으로 쿠팡 등록 준비 완료",
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
