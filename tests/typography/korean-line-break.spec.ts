import { test } from "@playwright/test";

import {
  auditTypographyRoute,
  installTypographyTheme,
  TYPOGRAPHY_THEMES,
  TYPOGRAPHY_VIEWPORTS,
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

test.describe("Korean-friendly line breaking", () => {
  for (const viewport of TYPOGRAPHY_VIEWPORTS) {
    for (const theme of TYPOGRAPHY_THEMES) {
      test(
        `public surfaces ${viewport.label}px ${theme}`,
        async ({ page }, testInfo) => {
          await installTypographyTheme(page, theme);
          for (const route of PUBLIC_ROUTES) {
            await auditTypographyRoute({
              page,
              routeName: route.name,
              testInfo,
              theme,
              url: route.url,
              viewport,
            });
          }
        },
      );

      test(
        `admin public surfaces ${viewport.label}px ${theme}`,
        async ({ page }, testInfo) => {
          await installTypographyTheme(page, theme);
          for (const route of ADMIN_PUBLIC_ROUTES) {
            await auditTypographyRoute({
              page,
              routeName: route.name,
              testInfo,
              theme,
              url: route.url,
              viewport,
            });
          }
        },
      );
    }
  }

  test(
    "390px light surfaces remain readable at 200% root text size",
    async ({ page }, testInfo) => {
      const viewport = TYPOGRAPHY_VIEWPORTS[0];
      const theme = "light" as const;
      await installTypographyTheme(page, theme);

      for (const route of [
        PUBLIC_ROUTES[0],
        PUBLIC_ROUTES[1],
        PUBLIC_ROUTES[2],
        ADMIN_PUBLIC_ROUTES[0],
      ]) {
        await auditTypographyRoute({
          page,
          routeName: route.name,
          testInfo,
          textScale: 2,
          theme,
          url: route.url,
          viewport,
        });
      }
    },
  );
});
