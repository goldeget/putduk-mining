import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import {
  INDEXNOW_KEY,
  INDEXNOW_KEY_PATH,
  buildIndexNowSubmission,
} from "@/lib/trust/indexnow";
import { TRUST_LAST_UPDATED } from "@/lib/trust/public-content";
import {
  PUBLIC_DISCOVERY_LAST_MODIFIED,
  PUBLIC_DISCOVERY_PATHS,
  buildBreadcrumbStructuredData,
  isRobotsDisallowed,
  publicLanguageAlternates,
} from "@/lib/trust/public-discovery";

const PRIVATE_PATHS = [
  "/home",
  "/start",
  "/mining",
  "/products",
  "/products/sample",
  "/wallet",
  "/wallet/deposit",
  "/events",
  "/events/sample",
  "/notifications",
  "/ai",
  "/menu",
  "/menu/account",
  "/login",
  "/signup",
  "/api/v1/me/bootstrap",
] as const;

describe("public discovery paths", () => {
  it("lists each public help path once and keeps member screens out", () => {
    expect(new Set(PUBLIC_DISCOVERY_PATHS).size).toBe(
      PUBLIC_DISCOVERY_PATHS.length,
    );
    expect(PUBLIC_DISCOVERY_PATHS).toEqual(
      expect.arrayContaining([
        "/",
        "/faq",
        "/support",
        "/mining-rules",
        "/ai/about",
      ]),
    );
    for (const path of PRIVATE_PATHS) {
      expect(PUBLIC_DISCOVERY_PATHS).not.toContain(path);
      expect(isRobotsDisallowed(path)).toBe(true);
    }
  });

  it("leaves public help crawlable, including mining rules and AI guides", () => {
    for (const path of PUBLIC_DISCOVERY_PATHS) {
      expect(isRobotsDisallowed(path)).toBe(false);
    }
    expect(isRobotsDisallowed("/mining-rules")).toBe(false);
    expect(isRobotsDisallowed("/ai/faq")).toBe(false);
    expect(isRobotsDisallowed("/mining")).toBe(true);
    expect(isRobotsDisallowed("/ai")).toBe(true);
  });

  it("publishes the same public urls from sitemap and IndexNow", () => {
    const submission = buildIndexNowSubmission();
    const sitemapUrls = sitemap().map((entry) => entry.url);

    expect(submission.host).toBe("mining.putduk.com");
    expect(submission.key).toBe(INDEXNOW_KEY);
    expect(submission.keyLocation).toBe(
      `https://mining.putduk.com${INDEXNOW_KEY_PATH}`,
    );
    expect(submission.urlList).toEqual(sitemapUrls);
    expect(submission.urlList).toContain("https://mining.putduk.com/support");
    expect(submission.urlList).toContain("https://mining.putduk.com/faq");
    for (const path of PRIVATE_PATHS) {
      expect(submission.urlList).not.toContain(
        `https://mining.putduk.com${path}`,
      );
    }
  });

  it("allows public crawlers and blocks member paths in robots", () => {
    const policy = robots();
    expect(policy.rules).toMatchObject({
      userAgent: "*",
      allow: "/",
    });
    expect(policy.sitemap).toBe("https://mining.putduk.com/sitemap.xml");

    const disallow = Array.isArray(policy.rules)
      ? policy.rules.flatMap((rule) => rule.disallow ?? [])
      : (policy.rules?.disallow ?? []);
    expect(disallow).toEqual(
      expect.arrayContaining([
        "/products",
        "/mining$",
        "/wallet",
        "/menu",
        "/ai$",
      ]),
    );
    expect(disallow).not.toContain("/mining");
    expect(disallow).not.toContain("/faq");
    expect(disallow).not.toContain("/support");
  });

  it("hosts the IndexNow key as the file body", () => {
    const body = readFileSync(
      join(process.cwd(), "public", `${INDEXNOW_KEY}.txt`),
      "utf8",
    );
    expect(body.trim()).toBe(INDEXNOW_KEY);
  });
});

describe("public discovery freshness", () => {
  it("publishes the shared freshness date and only the current language", () => {
    expect(PUBLIC_DISCOVERY_LAST_MODIFIED).toBe(TRUST_LAST_UPDATED);
    const entries = sitemap();
    expect(
      entries.every((entry) => entry.lastModified === TRUST_LAST_UPDATED),
    ).toBe(true);
    expect(publicLanguageAlternates("/faq")).toEqual({ "ko-KR": "/faq" });
    expect(publicLanguageAlternates("/faq")).not.toHaveProperty("ja-JP");
  });

  it("builds a document breadcrumb from the public origin", () => {
    expect(
      buildBreadcrumbStructuredData({
        name: "자주 묻는 질문",
        path: "/faq",
      }),
    ).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, item: "https://mining.putduk.com/" },
        {
          position: 2,
          name: "자주 묻는 질문",
          item: "https://mining.putduk.com/faq",
        },
      ],
    });
  });
});
