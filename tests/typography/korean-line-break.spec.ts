import { test } from "@playwright/test";

import {
  auditTypographyRoute,
  installTypographyTheme,
  TYPOGRAPHY_THEMES,
  TYPOGRAPHY_VIEWPORTS,
  type TypographyTheme,
  type TypographyViewport,
} from "./helpers";

const PUBLIC_ROUTES = [
  { name: "landing", url: "/" },
  { name: "login", url: "/login" },
  { name: "signup", url: "/signup" },
  { name: "verification", url: "/verification" },
  { name: "trial-guide", url: "/trial" },
  { name: "withdrawal-guide", url: "/withdrawal" },
  { name: "service-status", url: "/status" },
] as const;

const ADMIN_PUBLIC_ROUTES = [
  { name: "admin-login", url: "http://127.0.0.1:3100/login" },
  {
    name: "admin-session-expired",
    url: "http://127.0.0.1:3100/session-expired",
  },
  {
    name: "admin-unauthorized",
    url: "http://127.0.0.1:3100/unauthorized?code=STEP_UP_REQUIRED",
  },
  {
    name: "admin-reauth",
    url: "http://127.0.0.1:3100/reauth?reason=step-up",
  },
] as const;

const SCALED_TEXT_ROUTES = [
  PUBLIC_ROUTES[0],
  PUBLIC_ROUTES[1],
  PUBLIC_ROUTES[2],
  ADMIN_PUBLIC_ROUTES[0],
] as const;

async function auditOne(input: {
  page: Parameters<typeof auditTypographyRoute>[0]["page"];
  route: { name: string; url: string };
  testInfo: Parameters<typeof auditTypographyRoute>[0]["testInfo"];
  textScale?: number;
  theme: TypographyTheme;
  viewport: TypographyViewport;
}) {
  await installTypographyTheme(input.page, input.theme);
  await auditTypographyRoute({
    page: input.page,
    routeName: input.route.name,
    testInfo: input.testInfo,
    theme: input.theme,
    url: input.route.url,
    viewport: input.viewport,
    ...(input.textScale === undefined ? {} : { textScale: input.textScale }),
  });
}

test.describe("Korean-friendly line breaking", () => {
  for (const viewport of TYPOGRAPHY_VIEWPORTS) {
    for (const theme of TYPOGRAPHY_THEMES) {
      for (const route of PUBLIC_ROUTES) {
        test(`${route.name} ${viewport.label}px ${theme}`, async ({
          page,
        }, testInfo) => {
          await auditOne({ page, route, testInfo, theme, viewport });
        });
      }

      for (const route of ADMIN_PUBLIC_ROUTES) {
        test(`${route.name} ${viewport.label}px ${theme}`, async ({
          page,
        }, testInfo) => {
          await auditOne({ page, route, testInfo, theme, viewport });
        });
      }
    }
  }

  const scaledViewport = TYPOGRAPHY_VIEWPORTS[0];
  if (scaledViewport === undefined) {
    throw new Error("390 viewport is required for the 200% text audit.");
  }
  const scaledTheme = "light" as const;

  for (const route of SCALED_TEXT_ROUTES) {
    test(`${route.name} ${scaledViewport.label}px ${scaledTheme} 200% root text`, async ({
      page,
    }, testInfo) => {
      await auditOne({
        page,
        route,
        testInfo,
        textScale: 2,
        theme: scaledTheme,
        viewport: scaledViewport,
      });
    });
  }
});
