import "./globals.css";

export const metadata = {
  title: "NOID-B OS",
  description: "노이드비 AI 상품등록 도우미"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
