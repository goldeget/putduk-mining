import type { Metadata, Viewport } from "next";
import { ThemeRuntime } from "../../../components/system/theme-runtime";
import { AppExperienceRuntime } from "../../../components/system/app-experience-runtime";
import { putdukFont } from "../../../lib/design/fonts";
import { themeBootstrap } from "../../../lib/design/theme";
import { WORKROOM_METADATA_ICONS } from "../../../components/workroom/brand";

import "./globals.css";
import "./(control)/workroom/shell.css";
import "./admin-workspace.css";

export const metadata: Metadata = {
  title: { default: "WORKROOM | 운영자", template: "%s | WORKROOM ADMIN" },
  description: "WORKROOM 무료 모의 체험 운영 콘솔",
  robots: { index: false, follow: false, nocache: true },
  icons: WORKROOM_METADATA_ICONS,
  manifest: "/manifest.webmanifest",
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
          content="#020a14"
          media="(prefers-color-scheme: dark)"
        />
        <meta
          name="theme-color"
          content="#f8f8f8"
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
        <AppExperienceRuntime />
        {children}
      </body>
    </html>
  );
}
