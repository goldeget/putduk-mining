import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AnalyticsBeacon } from "@/components/system/analytics-beacon";
import { PwaRegistrar } from "@/components/system/pwa-registrar";

import "./globals.css";
import "./productization.css";
import "./korean-typography.css";

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
        "KOREA에서 시작해 앱을 닫아도 이어지는 채굴 상태와 결과를 확인하는 채굴 서비스입니다.",
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
    "KOREA에서 시작해 앱을 닫아도 이어지는 채굴 상태와 결과를 확인하는 PUTDUK의 채굴 서비스입니다.",
  applicationName: "PUTDUK MINING",
  icons: {
    icon: [
      { url: "/brand/favicon/favicon.svg", type: "image/svg+xml" },
      {
        url: "/brand/favicon/favicon-32.png",
        sizes: "32x32",
        type: "image/png",
      },
    ],
    shortcut: "/brand/favicon/favicon.ico",
    apple: "/brand/pwa/putduk-pwa-dark-192.png",
  },
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
  colorScheme: "light dark",
  themeColor: [
    { color: "#070706", media: "(prefers-color-scheme: dark)" },
    { color: "#f8f4ea", media: "(prefers-color-scheme: light)" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("putduk-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}}catch(e){}',
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
        {children}
      </body>
    </html>
  );
}
