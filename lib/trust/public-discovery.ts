import {
  TRUST_DOCUMENTS,
  TRUST_LAST_UPDATED,
} from "@/lib/trust/public-content";

export const PUBLIC_SITE_ORIGIN = "https://mining.putduk.com";

/** 공개 도움·안내 경로. 회원 화면과 관리자 화면은 넣지 않는다. */
export const PUBLIC_DISCOVERY_PATHS: readonly string[] = [
  "/",
  ...TRUST_DOCUMENTS.map((document) => document.path),
  "/support",
];

/**
 * 회원·계정·API 경로. `$`로 끝나면 그 경로만 막고, 아니면 앞부분 일치를 쓴다.
 * `/mining$`는 회원 채굴 화면만 막고 공개 `/mining-rules`는 남긴다.
 */
export const PRIVATE_ROBOTS_DISALLOW = [
  "/api/",
  "/auth/",
  "/login",
  "/signup",
  "/find-id",
  "/recover",
  "/home",
  "/start",
  "/mining$",
  "/products",
  "/wallet",
  "/events",
  "/notifications",
  "/ai$",
  "/menu",
] as const;

/** 사이트맵·문서에 쓰는 공개 갱신일. */
export const PUBLIC_DISCOVERY_LAST_MODIFIED = TRUST_LAST_UPDATED;

/**
 * 현재 공개 언어만 연결한다.
 * ja-JP 본문이 없으므로 그 주소는 만들지 않는다.
 */
export function publicLanguageAlternates(path: string) {
  return { "ko-KR": path } as const;
}

export function buildBreadcrumbStructuredData(input: {
  name: string;
  path: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "퍼뜩 채굴",
        item: `${PUBLIC_SITE_ORIGIN}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: input.name,
        item: toPublicUrl(input.path),
      },
    ],
  };
}

export function toPublicUrl(path: string): string {
  if (path === "/") {
    return PUBLIC_SITE_ORIGIN;
  }

  return `${PUBLIC_SITE_ORIGIN}${path}`;
}

export function isRobotsDisallowed(pathname: string): boolean {
  return PRIVATE_ROBOTS_DISALLOW.some((rule) => {
    if (rule.endsWith("$")) {
      return pathname === rule.slice(0, -1);
    }

    return pathname.startsWith(rule);
  });
}
