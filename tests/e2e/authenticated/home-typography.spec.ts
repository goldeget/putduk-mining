import { unlink } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import { assertTypographyClean } from "../../typography/helpers";
import { ensureLocalTrialProgram } from "./helpers/eligibility";
import { loginAsMember } from "./helpers/member-session";
import { expectSettledRoute } from "./helpers/settled-route";
import { assertViewportFits } from "./helpers/viewport-geometry";

type PhaseTiming = {
  phase: string;
  cellLabel?: string | undefined;
  startedMs: number;
  durationMs?: number;
  state: "running" | "completed" | "interrupted";
  pngBytes?: number;
};

type TimingProfile = {
  startedAt: number;
  currentPhase: string;
  currentCellLabel?: string | undefined;
  lastMark: { phase: string; elapsedMs: number; state: PhaseTiming["state"] };
  authStartupMs: number;
  pngBytes: number;
  cells: { label: string; completed: boolean }[];
  phases: PhaseTiming[];
};

const timingProfiles = new Map<string, TimingProfile>();

function beginPhase(profile: TimingProfile, phase: string) {
  const startedAt = performance.now();
  const timing: PhaseTiming = {
    phase,
    cellLabel: profile.currentCellLabel,
    startedMs: startedAt - profile.startedAt,
    state: "running",
  };
  profile.phases.push(timing);
  profile.currentPhase = phase;
  profile.lastMark = { phase, elapsedMs: timing.startedMs, state: "running" };
  return (completed: boolean) => {
    const endedAt = performance.now();
    timing.durationMs = endedAt - startedAt;
    timing.state = completed ? "completed" : "interrupted";
    profile.lastMark = {
      phase,
      elapsedMs: endedAt - profile.startedAt,
      state: timing.state,
    };
    if (phase.startsWith("auth.")) profile.authStartupMs += timing.durationMs;
  };
}

async function measure<T>(
  profile: TimingProfile,
  phase: string,
  operation: () => Promise<T>,
): Promise<T> {
  const finish = beginPhase(profile, phase);
  let completed = false;
  try {
    const result = await operation();
    completed = true;
    return result;
  } finally {
    finish(completed);
  }
}

function measureAssertions(profile: TimingProfile, operation: () => void) {
  const finish = beginPhase(profile, "layout.assertions");
  let completed = false;
  try {
    operation();
    completed = true;
  } finally {
    finish(completed);
  }
}

test.afterEach(async ({}, info) => {
  const profile = timingProfiles.get(info.testId);
  if (!profile) return;
  try {
    const { startedAt, ...details } = profile;
    const elapsedMs = performance.now() - startedAt;
    const phases = details.phases.map((phase) => ({
      ...phase,
      durationMs: phase.durationMs ?? elapsedMs - phase.startedMs,
    }));
    const totals: Record<
      string,
      { count: number; totalMs: number; maxMs: number }
    > = {};
    for (const phase of phases) {
      const total = (totals[phase.phase] ??= {
        count: 0,
        totalMs: 0,
        maxMs: 0,
      });
      total.count += 1;
      total.totalMs += phase.durationMs;
      total.maxMs = Math.max(total.maxMs, phase.durationMs);
    }
    const summary = {
      elapsedMs,
      authStartupMs: phases
        .filter((phase) => phase.phase.startsWith("auth."))
        .reduce((sum, phase) => sum + phase.durationMs, 0),
      completedCells: details.cells.filter((cell) => cell.completed).length,
      lastLabel: details.cells.at(-1)?.label,
      currentPhase: details.currentPhase,
      lastMark: details.lastMark,
      pngBytes: details.pngBytes,
      phases: totals,
    };
    console.info(`HOME_TYPOGRAPHY_PHASE_PROFILE ${JSON.stringify(summary)}`);
    await info.attach("home-typography-phase-profile", {
      body: JSON.stringify({
        ...details,
        authStartupMs: summary.authStartupMs,
        elapsedMs,
        phases,
      }),
      contentType: "application/json",
    });
  } finally {
    timingProfiles.delete(info.testId);
  }
});

test.beforeAll(async () => {
  await ensureLocalTrialProgram();
});

test("unfunded home retains Korean layout across viewport and text scales", async ({
  page,
}, info) => {
  const profile: TimingProfile = {
    startedAt: performance.now(),
    currentPhase: "auth.create-member",
    lastMark: { phase: "auth.create-member", elapsedMs: 0, state: "running" },
    authStartupMs: 0,
    pngBytes: 0,
    cells: [],
    phases: [],
  };
  timingProfiles.set(info.testId, profile);
  const member = await measure(profile, "auth.create-member", () =>
    createConfirmedMember("home-korean-typography"),
  );
  await measure(profile, "auth.login", () =>
    loginAsMember(page, member, "/home"),
  );
  await measure(profile, "auth.settled-route", () =>
    expectSettledRoute(page, "/home"),
  );
  await measure(profile, "auth.wallet-assertion", () =>
    expect(page.locator('[data-home-amount="wallet"]')).toHaveText("0원"),
  );
  const records: {
    width: number;
    theme: "dark" | "light";
    preference: "dark" | "light" | "system";
    textScale: number;
    route: "/home";
    fixture: "real confirmed member, no funding";
    wallet: "0원";
  }[] = [];
  // Start with the newly exposed 430px breakpoint, then cover every requested width.
  for (const width of [430, 320, 360, 390, 834, 1024, 1440]) {
    await measure(profile, "viewport.resize", () =>
      page.setViewportSize({ width, height: width === 834 ? 1112 : 900 }),
    );
    for (const { theme, preference } of [
      { theme: "dark", preference: "dark" },
      { theme: "light", preference: "light" },
      { theme: "dark", preference: "system" },
      { theme: "light", preference: "system" },
    ] as const) {
      await measure(profile, "theme.emulate-media", () =>
        page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" }),
      );
      await measure(profile, "theme.select", () =>
        page
          .getByRole("combobox", { name: "화면 테마" })
          .first()
          .selectOption(preference),
      );
      await measure(profile, "theme.assertion", () =>
        expect(page.locator("html")).toHaveAttribute("data-theme", theme),
      );
      for (const scale of [100, 125, 150, 200]) {
        const label = `unfunded-home-${width}-${preference}-${theme}-${scale}`;
        profile.currentCellLabel = label;
        const cell = { label, completed: false };
        profile.cells.push(cell);
        await measure(profile, "scale.fonts-raf", () =>
          page.evaluate(async (value) => {
            document.documentElement.style.fontSize = `${(16 * value) / 100}px`;
            await document.fonts.ready;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            );
          }, scale),
        );
        const overflows = await measure(
          profile,
          "intrinsic-overflow.read",
          () =>
            page.getByRole("main").evaluate((main) =>
              [...main.querySelectorAll<HTMLElement>("*")]
                .filter(
                  (el) =>
                    el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1,
                )
                .map((el) => ({
                  className: el.className,
                  tag: el.tagName,
                  client: el.clientWidth,
                  scroll: el.scrollWidth,
                  overflow: getComputedStyle(el).overflowX,
                  text: el.innerText?.slice(0, 80),
                })),
            ),
        );
        await measure(profile, "intrinsic-overflow.attach", () =>
          info.attach(`${label}-intrinsic-overflows`, {
            body: JSON.stringify(overflows),
            contentType: "application/json",
          }),
        );
        await measure(profile, "viewport.helper", () =>
          assertViewportFits(page, info, label),
        );
        await measure(profile, "typography.helper", () =>
          assertTypographyClean(page, label, info),
        );
        const summaryRows = await measure(profile, "layout.summary-read", () =>
          page
            .getByRole("region", { name: "내 채굴 정보", exact: true })
            .evaluate((section) => {
              const grid = section.querySelector(":scope > div")!;
              const rows = new Map<number, number>();
              for (const card of grid.children) {
                const rect = card.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                const top = Math.round(rect.top);
                rows.set(top, (rows.get(top) ?? 0) + 1);
              }
              return [...rows.values()];
            }),
        );
        measureAssertions(profile, () => {
          expect(summaryRows.reduce((sum, count) => sum + count, 0)).toBe(
            theme === "dark" ? 4 : 3,
          );
          expect(
            new Set(summaryRows).size,
            `${label}: balanced summary rows`,
          ).toBe(1);
        });
        const shortcuts = page.getByRole("navigation", {
          name: "바로 가기",
          exact: true,
        });
        const primaryActions = shortcuts.locator("[data-home-primary-actions]");
        const visibleLinks = primaryActions.getByRole("link");
        await measure(profile, "layout.link-count", () =>
          expect(visibleLinks).toHaveCount(4),
        );
        expect(
          await measure(profile, "layout.link-hrefs", () =>
            visibleLinks.evaluateAll((links) =>
              links.map((link) => link.getAttribute("href")),
            ),
          ),
        ).toEqual([
          "/mining",
          "/wallet/deposit",
          "/wallet/withdraw",
          theme === "dark" ? "/events" : "/wallet?view=history",
        ]);
        const actionGeometry = await measure(
          profile,
          "layout.geometry-read",
          () =>
            primaryActions.evaluate((grid) => {
              const bounds = grid.getBoundingClientRect();
              const rows = new Map<number, number>();
              const cards = [...grid.children].filter(
                (card) => card.getBoundingClientRect().width > 0,
              );
              const violations: string[] = [];
              for (const card of cards) {
                const rect = card.getBoundingClientRect();
                const top = Math.round(rect.top);
                rows.set(top, (rows.get(top) ?? 0) + 1);
                if (rect.width < 44 || rect.height < 44)
                  violations.push("small touch target");
                if (
                  rect.left < bounds.left - 1 ||
                  rect.right > bounds.right + 1
                )
                  violations.push("card outside primary group");
                const label = card.querySelector("strong")!;
                const range = document.createRange();
                range.selectNodeContents(label);
                const textRects = [...range.getClientRects()].filter(
                  (text) => text.width > 0 && text.height > 0,
                );
                if (
                  new Set(textRects.map((text) => Math.round(text.top))).size >
                  1
                )
                  violations.push("wrapped action label");
                if (
                  textRects.some(
                    (text) =>
                      text.left < rect.left - 1 || text.right > rect.right + 1,
                  )
                )
                  violations.push("label outside card");
              }
              return { rows: [...rows.values()], violations };
            }),
        );
        measureAssertions(profile, () => {
          expect(
            actionGeometry.violations,
            `${label}: readable shortcut labels and touch targets`,
          ).toEqual([]);
          expect(
            actionGeometry.rows.reduce((sum, count) => sum + count, 0),
          ).toBe(4);
          expect(
            new Set(actionGeometry.rows).size,
            `${label}: balanced primary shortcut rows`,
          ).toBe(1);
        });
        const aiHelp = shortcuts.getByRole("button", {
          name: "AI 도움",
          exact: true,
        });
        if (theme === "dark") {
          await measure(profile, "layout.ai-visible", () =>
            expect(aiHelp).toBeVisible(),
          );
          const placement = await measure(profile, "layout.ai-placement", () =>
            shortcuts.evaluate((nav) => {
              const group = nav
                .querySelector("[data-home-primary-actions]")!
                .getBoundingClientRect();
              const help = nav
                .querySelector("footer[data-ai-dock]")!
                .getBoundingClientRect();
              return {
                inOwnRow: help.top >= group.bottom - 1,
                fillsGroupWidth: Math.abs(help.width - group.width) <= 1,
                alignedBesideGroup:
                  Math.abs(help.top - group.top) <= 1 &&
                  help.left >= group.right,
              };
            }),
          );
          measureAssertions(profile, () => {
            expect(
              placement.inOwnRow
                ? placement.fillsGroupWidth
                : placement.alignedBesideGroup,
              `${label}: AI remains a deliberate help action`,
            ).toBe(true);
          });
        } else {
          await measure(profile, "layout.ai-hidden", () =>
            expect(aiHelp).toBeHidden(),
          );
        }
        await measure(profile, "layout.attach", () =>
          info.attach(`${label}-shortcut-layout`, {
            body: JSON.stringify(actionGeometry),
            contentType: "application/json",
          }),
        );
        // Persist the original PNG without retaining and IPC-encoding every
        // screenshot body for the entire 112-cell test.
        const shortcutsPng = info.outputPath(`${label}-shortcuts.png`);
        const shortcutsBytes = (
          await measure(profile, "shortcuts.screenshot-path-io", () =>
            shortcuts.screenshot({
              animations: "disabled",
              path: shortcutsPng,
            }),
          )
        ).length;
        profile.pngBytes += shortcutsBytes;
        profile.phases[profile.phases.length - 1]!.pngBytes = shortcutsBytes;
        await measure(profile, "shortcuts.attach-copy-ipc", () =>
          info.attach(`${label}-shortcuts`, {
            path: shortcutsPng,
            contentType: "image/png",
          }),
        );
        await measure(profile, "shortcuts.unlink", () => unlink(shortcutsPng));
        await measure(profile, "scroll.reset", () =>
          page
            .getByRole("main")
            .evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" })),
        );
        const pagePng = info.outputPath(`${label}.png`);
        const pageBytes = (
          await measure(profile, "page.screenshot-path-io", () =>
            page.screenshot({ animations: "disabled", path: pagePng }),
          )
        ).length;
        profile.pngBytes += pageBytes;
        profile.phases[profile.phases.length - 1]!.pngBytes = pageBytes;
        await measure(profile, "page.attach-copy-ipc", () =>
          info.attach(label, {
            path: pagePng,
            contentType: "image/png",
          }),
        );
        await measure(profile, "page.unlink", () => unlink(pagePng));
        records.push({
          width,
          theme,
          preference,
          textScale: scale,
          route: "/home",
          fixture: "real confirmed member, no funding",
          wallet: "0원",
        });
        cell.completed = true;
        profile.currentCellLabel = undefined;
      }
    }
  }
  measureAssertions(profile, () => expect(records).toHaveLength(112));
  await measure(profile, "matrix.attach", () =>
    info.attach("unfunded-home-typography-matrix", {
      body: JSON.stringify(records),
      contentType: "application/json",
    }),
  );
});
