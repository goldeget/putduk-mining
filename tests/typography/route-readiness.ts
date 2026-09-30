import { expect, type Page } from "@playwright/test";

export type UiTerminalState =
  "loaded" | "empty" | "error" | "partial" | "unknown";
export const UI_TERMINAL_STATES: readonly UiTerminalState[] = [
  "loaded",
  "empty",
  "error",
  "partial",
  "unknown",
];

/** The marker belongs to a completed route body, never the shared shell/loading fallback. */
export async function waitForRouteBody(
  page: Page,
  pathname: string,
  timeout = 60_000,
): Promise<UiTerminalState> {
  const body = page
    .locator(`[data-ui-ready=${JSON.stringify(pathname)}]`)
    .first();
  await body.waitFor({ state: "visible", timeout });
  await expect
    .poll(async () => body.getAttribute("data-ui-state"), { timeout })
    .toMatch(/^(loaded|empty|error|partial|unknown)$/);
  const state = (await body.getAttribute("data-ui-state")) as UiTerminalState;
  // A ready shell wrapped around a skeleton is not a completed page.
  await expect(
    body.locator('[data-ui-state="loading"], [aria-busy="true"]'),
  ).toHaveCount(0);
  await expect(body.locator("h1").first()).toBeVisible();
  return state;
}
