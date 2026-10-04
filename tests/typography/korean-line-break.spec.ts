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
  { name: "find-id", url: "/find-id" },
  { name: "recover", url: "/recover" },
  { name: "auth-error", url: "/auth/error" },
  { name: "auth-forbidden", url: "/auth/forbidden" },
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
  PUBLIC_ROUTES[3],
  PUBLIC_ROUTES[4],
  PUBLIC_ROUTES[5],
  PUBLIC_ROUTES[6],
  ADMIN_PUBLIC_ROUTES[0],
] as const;

const AUTH_ROUTES = PUBLIC_ROUTES.filter((route) =>
  [
    "login",
    "signup",
    "find-id",
    "recover",
    "auth-error",
    "auth-forbidden",
  ].includes(route.name),
);

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
    ...(AUTH_ROUTES.some((route) => route.name === input.route.name)
      ? { requireRouteBody: true, pathname: input.route.url }
      : {}),
    ...(["/auth/error", "/auth/forbidden"].includes(input.route.url)
      ? { expectedStates: ["error"] as const }
      : {}),
    ...(input.textScale === undefined ? {} : { textScale: input.textScale }),
  });
}

test.describe("Korean-friendly line breaking", () => {
  const narrowViewport: TypographyViewport = {
    label: "320",
    width: 320,
    height: 740,
  };
  for (const theme of TYPOGRAPHY_THEMES) {
    for (const route of AUTH_ROUTES) {
      test(`${route.name} 320px ${theme}`, async ({ page }, testInfo) => {
        await auditOne({
          page,
          route,
          testInfo,
          theme,
          viewport: narrowViewport,
        });
      });
    }
  }
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
