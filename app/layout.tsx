import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AnalyticsBeacon } from "@/components/system/analytics-beacon";
import { PwaRegistrar } from "@/components/system/pwa-registrar";

import "./globals.css";

const siteUrl = "https://mining.putduk.com";

const platformStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "PUTDUK",
      url: siteUrl,
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      inLanguage: "ko-KR",
      name: "PUTDUK MINING",
      publisher: { "@id": `${siteUrl}/#organization` },
      url: siteUrl,
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteUrl}/#application`,
      alternateName: "퍼뜩 채굴",
      applicationCategory: "FinanceApplication",
      description:
        "서버 기준 채굴, 정산, 원장을 하나의 흐름으로 설계한 가상 채굴 플랫폼입니다.",
      inLanguage: "ko-KR",
      name: "PUTDUK MINING",
      operatingSystem: "Web, PWA",
      url: siteUrl,
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "퍼뜩 채굴 | PUTDUK MINING",
    template: "%s | 퍼뜩 채굴",
  },
  description:
    "서버 기준 채굴, 정산, 원장을 하나의 신뢰 가능한 흐름으로 설계한 PUTDUK의 가상 채굴 플랫폼입니다.",
  applicationName: "PUTDUK MINING",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: siteUrl,
    siteName: "PUTDUK MINING",
    title: "퍼뜩 채굴 | PUTDUK MINING",
    description: "채굴의 시간을, 신뢰 가능한 기록으로.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#070a0d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
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
        {children}
      </body>
    </html>
  );
}
