import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

const SENSITIVE_CONTROLS =
  'input[name="destinationReauthPassword"],input[name="destinationReauthTotp"],input[name="accountHolder"],input[name="accountNumber"],input[name="address"]';

const MAX_PANELS = 12;
type ScrollShape = {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollWidth: number;
};
type Container = {
  element: HTMLElement;
  kind: "main" | "modal";
  initialLeft: number;
  initialTop: number;
  selected: boolean;
  shape: ScrollShape;
};
type EvidenceSnapshot = {
  route: string;
  dialogs: HTMLDialogElement[];
  containers: Container[];
  viewport: { width: number; height: number; dpr: number };
  theme: string | null;
  windowLeft: number;
  windowTop: number;
};
type PanelResult = {
  file: string;
  container: "main" | "modal";
  top: number;
  shape: ScrollShape;
};

function sameShape(left: ScrollShape, right: ScrollShape) {
  return (
    left.clientHeight === right.clientHeight &&
    left.clientWidth === right.clientWidth &&
    left.scrollHeight === right.scrollHeight &&
    left.scrollWidth === right.scrollWidth
  );
}

/** Bound collection work. Truncation is reported rather than claimed complete. */
export function withdrawalPanelOffsets(shape: ScrollShape, limit = MAX_PANELS) {
  const end = Math.max(0, shape.scrollHeight - shape.clientHeight);
  if (shape.clientHeight <= 0 || shape.clientWidth <= 0 || limit <= 0)
    return { complete: false, offsets: [] as number[] };
  const step = Math.max(1, Math.floor(shape.clientHeight * 0.75));
  const offsets = [0];
  while (offsets.at(-1)! < end && offsets.length < limit)
    offsets.push(Math.min(end, offsets.at(-1)! + step));
  return { complete: offsets.at(-1) === end, offsets };
}

/** Keep the base PNG/Buffer contract; panels cover real inner scrolling. */
export async function captureRedactedWithdrawalEvidence(
  page: Page,
  screenshotPath: string,
) {
  const extension = path.extname(screenshotPath);
  const stem = extension
    ? screenshotPath.slice(0, -extension.length)
    : screenshotPath;
  const snapshot = await page.evaluateHandle(() => {
    const visible = (node: HTMLElement) =>
      !node.hidden &&
      window.getComputedStyle(node).display !== "none" &&
      window.getComputedStyle(node).visibility !== "hidden" &&
      window.getComputedStyle(node).visibility !== "collapse" &&
      node.getClientRects().length > 0;
    const dialogs = Array.from(
      document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
    ).filter(visible);
    const containers: Container[] = [];
    const add = (
      element: HTMLElement,
      kind: Container["kind"],
      selected: boolean,
    ) => {
      containers.push({
        element,
        kind,
        selected,
        initialLeft: element.scrollLeft,
        initialTop: element.scrollTop,
        shape: {
          clientHeight: element.clientHeight,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          scrollWidth: element.scrollWidth,
        },
      });
    };
    const main = document.getElementById("main-content");
    if (main && visible(main)) add(main, "main", dialogs.length === 0);
    for (const dialog of dialogs) {
      if (!dialog.classList.contains("modal")) continue;
      const content = dialog.querySelector<HTMLElement>(".modal__content");
      if (content && visible(content)) add(content, "modal", true);
    }
    return {
      route: location.pathname,
      dialogs,
      containers,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      },
      theme: document.documentElement.dataset.theme ?? null,
      windowLeft: window.scrollX,
      windowTop: window.scrollY,
    } satisfies EvidenceSnapshot;
  });
  let metadata:
    | {
        route: string;
        theme: string | null;
        viewport: EvidenceSnapshot["viewport"];
        activeDialogs: number;
        containers: Pick<Container, "kind" | "selected" | "shape">[];
      }
    | undefined;
  const issues: string[] = [];
  const panels: PanelResult[] = [];
  let restored = false;
  let baseCaptured = false;
  const screenshotOptions = {
    scale: "css" as const,
    animations: "disabled" as const,
    caret: "hide" as const,
    // Capture-only opacity preserves layout/focus; never clear actual values.
    style: `${SENSITIVE_CONTROLS} { opacity: 0 !important; }`,
    mask: [page.locator(SENSITIVE_CONTROLS)],
  };
  try {
    metadata = await page.evaluate(
      (state) => ({
        route: state.route,
        theme: state.theme,
        viewport: state.viewport,
        activeDialogs: state.dialogs.length,
        containers: state.containers.map(({ kind, selected, shape }) => ({
          kind,
          selected,
          shape,
        })),
      }),
      snapshot,
    );
    const windowReady = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
          requestAnimationFrame(() => {
            window.scrollTo({ top: 0, left: 0, behavior: "instant" });
            requestAnimationFrame(() =>
              resolve(window.scrollX === 0 && window.scrollY === 0),
            );
          });
        }),
    );
    if (!windowReady) issues.push("WINDOW_OFFSET_UNSTABLE");
    const base = await page.screenshot({
      ...screenshotOptions,
      path: screenshotPath,
      fullPage: true,
    });
    baseCaptured = true;
    const baseStable = await page.evaluate((state) => {
      const dialogs = Array.from(
        document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
      ).filter(
        (node) =>
          !node.hidden &&
          window.getComputedStyle(node).display !== "none" &&
          window.getComputedStyle(node).visibility !== "hidden" &&
          window.getComputedStyle(node).visibility !== "collapse" &&
          node.getClientRects().length > 0,
      );
      return (
        location.pathname === state.route &&
        dialogs.length === state.dialogs.length &&
        dialogs.every((node) => state.dialogs.includes(node)) &&
        state.containers.every(
          (container) =>
            container.element.isConnected &&
            container.element.clientHeight === container.shape.clientHeight &&
            container.element.clientWidth === container.shape.clientWidth &&
            container.element.scrollHeight === container.shape.scrollHeight &&
            container.element.scrollWidth === container.shape.scrollWidth,
        )
      );
    }, snapshot);
    if (!baseStable) issues.push("BASE_STATE_CHANGED");
    if (
      metadata.activeDialogs > 0 &&
      !metadata.containers.some((container) => container.kind === "modal")
    )
      issues.push("UNSUPPORTED_ACTIVE_MODAL");
    if (metadata.activeDialogs > 1) issues.push("MULTIPLE_ACTIVE_MODALS");

    for (const [index, container] of metadata.containers.entries()) {
      if (!container.selected) continue;
      if (container.shape.scrollWidth > container.shape.clientWidth + 1)
        issues.push(`${container.kind}:HORIZONTAL_OVERFLOW`);
      if (container.shape.scrollHeight <= container.shape.clientHeight)
        continue;
      const plan = withdrawalPanelOffsets(
        container.shape,
        MAX_PANELS - panels.length,
      );
      if (!plan.complete) issues.push(`${container.kind}:FRAME_LIMIT`);
      for (const top of plan.offsets) {
        const ready = await page.evaluate(
          ({ state, index, top }) => {
            const target = state.containers[index]!;
            const measure = () => ({
              top: target.element.scrollTop,
              shape: {
                clientHeight: target.element.clientHeight,
                clientWidth: target.element.clientWidth,
                scrollHeight: target.element.scrollHeight,
                scrollWidth: target.element.scrollWidth,
              },
            });
            target.element.scrollTo({ top, left: 0, behavior: "instant" });
            return new Promise<{
              connected: boolean;
              routeMatches: boolean;
              modalMatches: boolean;
              first: ReturnType<typeof measure>;
              second: ReturnType<typeof measure>;
            }>((resolve) => {
              requestAnimationFrame(() => {
                const first = measure();
                requestAnimationFrame(() => {
                  const openDialogs = Array.from(
                    document.querySelectorAll<HTMLDialogElement>(
                      "dialog[open]",
                    ),
                  ).filter(
                    (node) =>
                      !node.hidden &&
                      window.getComputedStyle(node).display !== "none" &&
                      window.getComputedStyle(node).visibility !== "hidden" &&
                      window.getComputedStyle(node).visibility !== "collapse" &&
                      node.getClientRects().length > 0,
                  );
                  resolve({
                    connected: target.element.isConnected,
                    routeMatches: location.pathname === state.route,
                    modalMatches:
                      openDialogs.length === state.dialogs.length &&
                      openDialogs.every((node) => state.dialogs.includes(node)),
                    first,
                    second: measure(),
                  });
                });
              });
            });
          },
          { state: snapshot, index, top },
        );
        if (
          !ready.connected ||
          !ready.routeMatches ||
          !ready.modalMatches ||
          Math.abs(ready.first.top - top) > 1 ||
          Math.abs(ready.second.top - top) > 1 ||
          !sameShape(ready.first.shape, ready.second.shape) ||
          !sameShape(ready.second.shape, container.shape)
        ) {
          issues.push(`${container.kind}:OFFSET_OR_SHAPE_CHANGED`);
          break;
        }
        const panelPath = `${stem}.${container.kind}-${String(panels.length).padStart(2, "0")}.png`;
        await page.screenshot({
          ...screenshotOptions,
          fullPage: false,
          path: panelPath,
        });
        panels.push({
          file: path.basename(panelPath),
          container: container.kind,
          top: ready.second.top,
          shape: ready.second.shape,
        });
        const unchanged = await page.evaluate(
          ({ state, index, top, shape }) => {
            const target = state.containers[index]!.element;
            const openDialogs = Array.from(
              document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
            ).filter(
              (node) =>
                !node.hidden &&
                window.getComputedStyle(node).display !== "none" &&
                window.getComputedStyle(node).visibility !== "hidden" &&
                window.getComputedStyle(node).visibility !== "collapse" &&
                node.getClientRects().length > 0,
            );
            return (
              target.isConnected &&
              location.pathname === state.route &&
              openDialogs.length === state.dialogs.length &&
              openDialogs.every((node) => state.dialogs.includes(node)) &&
              Math.abs(target.scrollTop - top) <= 1 &&
              target.clientHeight === shape.clientHeight &&
              target.clientWidth === shape.clientWidth &&
              target.scrollHeight === shape.scrollHeight &&
              target.scrollWidth === shape.scrollWidth
            );
          },
          { state: snapshot, index, top, shape: ready.second.shape },
        );
        if (!unchanged) {
          issues.push(`${container.kind}:CHANGED_DURING_CAPTURE`);
          break;
        }
      }
    }
    return base;
  } catch (error) {
    issues.push("CAPTURE_FAILED");
    throw error;
  } finally {
    try {
      restored = await page.evaluate(
        (state) =>
          new Promise<boolean>((resolve) => {
            for (const container of state.containers)
              container.element.scrollTo({
                top: container.initialTop,
                left: container.initialLeft,
                behavior: "instant",
              });
            window.scrollTo({
              top: state.windowTop,
              left: state.windowLeft,
              behavior: "instant",
            });
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                resolve(
                  Math.abs(window.scrollX - state.windowLeft) <= 1 &&
                    Math.abs(window.scrollY - state.windowTop) <= 1 &&
                    state.containers.every(
                      (container) =>
                        container.element.isConnected &&
                        Math.abs(
                          container.element.scrollTop - container.initialTop,
                        ) <= 1 &&
                        Math.abs(
                          container.element.scrollLeft - container.initialLeft,
                        ) <= 1,
                    ),
                ),
              ),
            );
          }),
        snapshot,
      );
      if (!restored) issues.push("SCROLL_RESTORE_INCOMPLETE");
    } catch {
      issues.push("SCROLL_RESTORE_FAILED");
    }
    try {
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await writeFile(
        `${stem}.panels.json`,
        JSON.stringify(
          {
            version: 1,
            capturedAt: new Date().toISOString(),
            commit: process.env.GITHUB_SHA ?? null,
            ciRun: process.env.GITHUB_RUN_ID ?? null,
            base: path.basename(screenshotPath),
            baseCaptured,
            coverage: metadata?.activeDialogs
              ? "active-modal"
              : "main-or-document",
            ...metadata,
            complete: baseCaptured && restored && issues.length === 0,
            issues: [...new Set(issues)],
            panels,
          },
          null,
          2,
        ),
        "utf8",
      );
    } finally {
      await snapshot.dispose();
    }
  }
}
