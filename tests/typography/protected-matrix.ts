import { test, type Page, type TestInfo } from "@playwright/test";

import {
  auditTypographyRoute,
  installTypographyTheme,
  TYPOGRAPHY_THEMES,
  TYPOGRAPHY_VIEWPORTS,
  type TypographyTheme,
  type TypographyViewport,
} from "./helpers";

export type ProtectedTypographyRoute = {
  name: string;
  origin: string;
  pathname: string;
  url: string;
};

async function auditProtectedRoute(input: {
  page: Page;
  route: ProtectedTypographyRoute;
  testInfo: TestInfo;
  textScale?: number;
  theme: TypographyTheme;
  viewport: TypographyViewport;
}) {
  const hydration: string[] = [];
  const onConsole = (message: { text: () => string; type: () => string }) => {
    const text = message.text();
    if (!/hydration/i.test(text)) return;
    hydration.push(text.slice(0, 240));
  };
  input.page.on("console", onConsole);
  try {
    await installTypographyTheme(input.page, input.theme);
    await auditTypographyRoute({
      origin: input.route.origin,
      page: input.page,
      pathname: input.route.pathname,
      readySelector: "main",
      routeName: input.route.name,
      testInfo: input.testInfo,
      theme: input.theme,
      url: input.route.url,
      viewport: input.viewport,
      waitUntil: "domcontentloaded",
      ...(input.textScale === undefined ? {} : { textScale: input.textScale }),
    });
  } finally {
    input.page.off("console", onConsole);
  }
  if (hydration.length > 0) {
    input.testInfo.annotations.push({
      type: "hydration",
      description: hydration[0] ?? "hydration",
    });
  }
}

export function registerProtectedTypographyMatrix(
  routes: readonly ProtectedTypographyRoute[],
) {
  for (const viewport of TYPOGRAPHY_VIEWPORTS) {
    for (const theme of TYPOGRAPHY_THEMES) {
      for (const route of routes) {
        test(`${route.name} ${viewport.label}px ${theme}`, async ({
          page,
        }, testInfo) => {
          await auditProtectedRoute({
            page,
            route,
            testInfo,
            theme,
            viewport,
          });
        });
      }
    }
  }

  const scaledViewport = TYPOGRAPHY_VIEWPORTS[0];
  if (scaledViewport === undefined) {
    throw new Error("390 viewport is required for the 200% text audit.");
  }

  for (const route of routes) {
    test(`${route.name} ${scaledViewport.label}px light 200% root text`, async ({
      page,
    }, testInfo) => {
      await auditProtectedRoute({
        page,
        route,
        testInfo,
        textScale: 2,
        theme: "light",
        viewport: scaledViewport,
      });
    });
  }
}
