import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "오늘의 퍼뜩 | 운영자", template: "%s | PUTDUK ADMIN" },
  description: "PUTDUK MINING 전용 운영 컨트롤 플레인",
  robots: { index: false, follow: false, nocache: true },
};
export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: "#08090b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
