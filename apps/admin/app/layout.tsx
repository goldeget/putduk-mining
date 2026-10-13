import type { Metadata, Viewport } from "next";
import { ThemeRuntime } from "../../../components/system/theme-runtime";
import { putdukFont } from "../../../lib/design/fonts";
import { themeBootstrap } from "../../../lib/design/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "오늘의 퍼뜩 | 운영자", template: "%s | PUTDUK ADMIN" },
  description: "PUTDUK MINING 전용 운영 컨트롤 플레인",
  robots: { index: false, follow: false, nocache: true },
  icons: {
    icon: [
      {
        url: "/brand/identity/20261013/favicon/favicon.svg",
        type: "image/svg+xml",
      },
      {
        url: "/brand/identity/20261013/favicon/favicon-32.png",
        sizes: "32x32",
        type: "image/png",
      },
    ],
    shortcut: "/brand/identity/20261013/favicon/favicon.ico",
    apple: "/brand/identity/20261013/pwa/putduk-pwa-dark-192.png",
  },
};
export const viewport: Viewport = {
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={putdukFont.variable} suppressHydrationWarning>
      <head>
        <meta
          name="theme-color"
          content="#070706"
          media="(prefers-color-scheme: dark)"
        />
        <meta
          name="theme-color"
          content="#f8f4ea"
          media="(prefers-color-scheme: light)"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: themeBootstrap,
          }}
        />
      </head>
      <body>
        <ThemeRuntime />
        {children}
      </body>
    </html>
  );
}
