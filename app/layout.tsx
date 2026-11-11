import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { SupportRuntime } from "@/components/support/support-runtime";
import { AnalyticsBeacon } from "@/components/system/analytics-beacon";
import { WebVitalsBeacon } from "@/components/system/web-vitals-beacon";
import { PwaRegistrar } from "@/components/system/pwa-registrar";
import { ThemeRuntime } from "@/components/system/theme-runtime";
import { putdukFont } from "@/lib/design/fonts";
import { themeBootstrap } from "@/lib/design/theme";
import { WORKROOM_METADATA_ICONS } from "@/components/workroom/brand";

import "./globals.css";
import "./productization.css";

const siteUrl = "https://workroom.putduk.com";

const platformStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "WORKROOM",
      url: siteUrl,
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      inLanguage: "ko-KR",
      name: "WORKROOM",
      publisher: { "@id": `${siteUrl}/#organization` },
      url: siteUrl,
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteUrl}/#application`,
      alternateName: "워크룸",
      applicationCategory: "EducationalApplication",
      description:
        "실제 거래와 분리된 무료 시뮬레이션입니다. 체험 포인트는 현금 전환이나 출금이 불가능합니다.",
      inLanguage: "ko-KR",
      name: "WORKROOM",
      operatingSystem: "Web, PWA",
      url: siteUrl,
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "워크룸 | WORKROOM",
    template: "%s | 워크룸",
  },
  description:
    "환율과 주식의 흐름을 체험하는 무료 WORKROOM 시뮬레이션. 체험 포인트는 현금으로 전환되지 않습니다.",
  applicationName: "WORKROOM",
  icons: WORKROOM_METADATA_ICONS,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: siteUrl,
    siteName: "WORKROOM",
    title: "워크룸 | WORKROOM",
    description: "나만의 공간에서 시장의 흐름을 경험하세요.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="ko"
      className={putdukFont.variable}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <meta
          name="theme-color"
          content="#0b1220"
          media="(prefers-color-scheme: dark)"
        />
        <meta
          name="theme-color"
          content="#0b1220"
          media="(prefers-color-scheme: light)"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: themeBootstrap,
          }}
        />
      </head>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(platformStructuredData).replace(
              /</g,
              "\\u003c",
            ),
          }}
        />
        <PwaRegistrar />
        <AnalyticsBeacon />
        <WebVitalsBeacon />
        <ThemeRuntime />
        {children}
        <SupportRuntime memberLauncher={false} floatingLauncher={false} />
      </body>
    </html>
  );
}
