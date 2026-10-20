import { unlink } from "node:fs/promises";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
  type Video,
} from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import { assertTypographyClean } from "../../typography/helpers";
import { ensureLocalTrialProgram } from "./helpers/eligibility";
import { loginAsMember } from "./helpers/member-session";
import { expectSettledRoute } from "./helpers/settled-route";
import { assertViewportFits } from "./helpers/viewport-geometry";

type ActorId = 0 | 1;

function buildHomeCells() {
  return [430, 320, 360, 390, 834, 1024, 1440].flatMap((width, widthIndex) =>
    (
      [
        { theme: "dark", preference: "dark" },
        { theme: "light", preference: "light" },
        { theme: "dark", preference: "system" },
        { theme: "light", preference: "system" },
      ] as const
    ).flatMap(({ theme, preference }, themeIndex) =>
      [100, 125, 150, 200].map((scale, scaleIndex) => ({
        canonicalIndex: widthIndex * 16 + themeIndex * 4 + scaleIndex,
        width,
        height: width === 834 ? 1112 : 900,
        theme,
        preference,
        scale,
        label:
          "unfunded-home-" +
          width +
          "-" +
          preference +
          "-" +
          theme +
          "-" +
          scale,
        owner: ((themeIndex + scaleIndex) % 2) as ActorId,
      })),
    ),
  );
}

type HomeCell = ReturnType<typeof buildHomeCells>[number];
type HomeRecord = {
  width: number;
  theme: HomeCell["theme"];
  preference: HomeCell["preference"];
  textScale: number;
  route: "/home";
  fixture: "real confirmed member, no funding";
  wallet: "0원";
};
type PhaseTiming = {
  phase: string;
  cellLabel?: string | undefined;
  startedMs: number;
  durationMs?: number;
  state: "running" | "completed" | "interrupted";
  pngBytes?: number;
};
type TimingProfile = {
  actorId: ActorId;
  startedAt: number;
  currentPhase: string;
  currentCellLabel?: string | undefined;
  lastMark: { phase: string; elapsedMs: number; state: PhaseTiming["state"] };
  authStartupMs: number;
  pngBytes: number;
  pngCount: number;
  stopped: boolean;
  cells: {
    canonicalIndex: number;
    label: string;
    completed: boolean;
    pngCount: number;
  }[];
  phases: PhaseTiming[];
};
type CaptureEnvironment = Awaited<ReturnType<typeof readCaptureEnvironment>>;
type CaptureActor = {
  id: ActorId;
  page: Page;
  environment: CaptureEnvironment;
  profile: TimingProfile;
  done: boolean;
};
type CaptureRun = {
  startedAt: number;
  originalPage: Page;
  profiles: TimingProfile[];
  actors: CaptureActor[];
  extraBrowser?: Browser | undefined;
  extraContext?: BrowserContext | undefined;
  extraVideo?: Video | null | undefined;
  videoMode: string;
  tasks: Promise<void>[];
  resources: Promise<unknown>[];
  stopped: boolean;
  failed: boolean;
  failure?: unknown;
  cancellation?: Promise<void> | undefined;
  matrixStartedAt?: number | undefined;
};
const timingRuns = new Map<string, CaptureRun>();

function createProfile(actorId: ActorId, startedAt: number): TimingProfile {
  return {
    actorId,
    startedAt,
    currentPhase: "actor.initializing",
    lastMark: { phase: "actor.initializing", elapsedMs: 0, state: "running" },
    authStartupMs: 0,
    pngBytes: 0,
    pngCount: 0,
    stopped: false,
    cells: [],
    phases: [],
  };
}

function ensureActorRunning(profile: TimingProfile) {
  if (profile.stopped) throw new Error("HOME_CAPTURE_ACTOR_STOPPED");
}

function beginPhase(profile: TimingProfile, phase: string) {
  ensureActorRunning(profile);
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
    ensureActorRunning(profile);
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

async function readCaptureEnvironment(page: Page) {
  return page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    platform: navigator.platform,
    language: navigator.language,
    coarsePointer: matchMedia("(pointer:coarse)").matches,
  }));
}

async function assertCaptureContext(actor: CaptureActor, state: HomeCell) {
  expect(actor.page.viewportSize()).toEqual({
    width: state.width,
    height: state.height,
  });
  const current = await actor.page.evaluate(() => ({
    environment: {
      dpr: window.devicePixelRatio,
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform,
      language: navigator.language,
      coarsePointer: matchMedia("(pointer:coarse)").matches,
    },
    fontSizePx: Number.parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    ),
    theme: document.documentElement.dataset.theme,
    pathname: window.location.pathname,
  }));
  expect(current.environment).toEqual(actor.environment);
  expect(current.fontSizePx).toBe((16 * state.scale) / 100);
  expect(current.theme).toBe(state.theme);
  expect(current.pathname).toBe("/home");
  await expect(
    actor.page.getByRole("combobox", { name: "화면 테마" }).first(),
  ).toHaveValue(state.preference);
}

function phaseTotals(phases: { phase: string; durationMs: number }[]) {
  const totals: Record<
    string,
    { count: number; totalMs: number; maxMs: number }
  > = {};
  for (const phase of phases) {
    const total = (totals[phase.phase] ??= { count: 0, totalMs: 0, maxMs: 0 });
    total.count += 1;
    total.totalMs += phase.durationMs;
    total.maxMs = Math.max(total.maxMs, phase.durationMs);
  }
  return totals;
}

function trackResource<T extends { close(): Promise<void> }>(
  run: CaptureRun,
  create: () => Promise<T>,
  register: (resource: T) => void,
) {
  const task = create().then(async (resource) => {
    register(resource);
    if (run.stopped) {
      await resource.close();
      throw new Error("HOME_CAPTURE_ACTOR_STOPPED");
    }
    return resource;
  });
  run.resources.push(task);
  return task;
}

function cancelCaptureActors(run: CaptureRun) {
  run.stopped = true;
  for (const profile of run.profiles) profile.stopped = true;
  run.cancellation ??= (async () => {
    const closed = await Promise.allSettled([
      run.originalPage.context().close(),
      ...(run.extraContext ? [run.extraContext.close()] : []),
    ]);
    // With no registered context, Browser.close must reject newContext before
    // teardown joins it. Otherwise context.close has already rejected newPage;
    // keep the Browser alive until the recorded video's saveAs RPC finishes.
    const browserClosed = await Promise.allSettled([
      ...(run.extraBrowser && !run.extraContext
        ? [run.extraBrowser.close()]
        : []),
    ]);
    const errors = [...closed, ...browserClosed]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length)
      throw new AggregateError(errors, "HOME_CAPTURE_ACTOR_CLEANUP_FAILED");
  })();
  return run.cancellation;
}

function shouldRecordVideo(mode: string, retry: number) {
  return (
    mode === "on" ||
    mode === "retain-on-failure" ||
    mode === "retain-on-failure-and-retries" ||
    (mode === "on-first-retry" && retry === 1) ||
    (mode === "on-all-retries" && retry > 0) ||
    (mode === "retain-on-first-failure" && retry === 0)
  );
}

async function finishCaptureRun(run: CaptureRun, info: TestInfo) {
  try {
    if (
      run.failed ||
      info.status !== info.expectedStatus ||
      run.actors.some((actor) => !actor.done)
    ) {
      await cancelCaptureActors(run);
    } else {
      await run.extraContext?.close();
    }
  } finally {
    await Promise.allSettled([...run.tasks, ...run.resources]);
    try {
      // A launch/context creation may settle after cancellation began. Its
      // registered resource is still closed before video finalization.
      await run.extraContext?.close();
      if (run.extraVideo) {
        const preserve =
          ["on", "on-first-retry", "on-all-retries"].includes(run.videoMode) ||
          info.status !== info.expectedStatus ||
          (run.videoMode === "retain-on-failure-and-retries" && info.retry > 0);
        if (preserve) {
          const videoPath = info.outputPath("home-capture-actor-1.webm");
          await run.extraVideo.saveAs(videoPath);
          await info.attach("home-capture-actor-1-video", {
            path: videoPath,
            contentType: "video/webm",
          });
          await unlink(videoPath);
        }
        await run.extraVideo.delete();
      }
    } finally {
      await run.extraBrowser?.close();
    }
  }
}

test.afterEach(async ({}, info) => {
  const run = timingRuns.get(info.testId);
  if (!run) return;
  // Freeze the observation before cancellation/teardown can settle pending work.
  const observedAt = performance.now();
  const actors = run.profiles.map(
    ({ startedAt, phases, cells, ...details }) => {
      const elapsedMs = observedAt - startedAt;
      const observedPhases = phases.map((phase) => ({
        ...phase,
        durationMs: phase.durationMs ?? elapsedMs - phase.startedMs,
      }));
      return {
        ...details,
        lastMark: { ...details.lastMark },
        elapsedMs,
        cells: cells.map((cell) => ({ ...cell })),
        phases: observedPhases,
      };
    },
  );
  const cells = actors
    .flatMap((actor) =>
      actor.cells.map((cell) => ({ ...cell, actorId: actor.actorId })),
    )
    .sort((a, b) => a.canonicalIndex - b.canonicalIndex);
  const phases = actors.flatMap((actor) => actor.phases);
  const summary = {
    elapsedMs: observedAt - run.startedAt,
    setupMs: (run.matrixStartedAt ?? observedAt) - run.startedAt,
    bodyElapsedMs:
      run.matrixStartedAt === undefined ? 0 : observedAt - run.matrixStartedAt,
    executionModel:
      "two browsers with isolated contexts; independent layout cells; phase durations overlap",
    authStartupMs: actors.reduce((sum, actor) => sum + actor.authStartupMs, 0),
    completedCells: cells.filter((cell) => cell.completed).length,
    lastLabel: cells.at(-1)?.label,
    currentPhase: actors
      .map((actor) => "actor-" + actor.actorId + ":" + actor.currentPhase)
      .join("|"),
    pngBytes: actors.reduce((sum, actor) => sum + actor.pngBytes, 0),
    pngCount: actors.reduce((sum, actor) => sum + actor.pngCount, 0),
    phases: phaseTotals(phases),
    actors: actors.map((actor) => ({
      actorId: actor.actorId,
      completedCells: actor.cells.filter((cell) => cell.completed).length,
      lastLabel: actor.cells.at(-1)?.label,
      currentPhase: actor.currentPhase,
      lastMark: actor.lastMark,
      pngCount: actor.pngCount,
      pngBytes: actor.pngBytes,
      phases: phaseTotals(actor.phases),
    })),
  };
  try {
    await finishCaptureRun(run, info);
  } finally {
    try {
      console.info("HOME_TYPOGRAPHY_PHASE_PROFILE " + JSON.stringify(summary));
      await info.attach("home-typography-phase-profile", {
        body: JSON.stringify({ ...summary, cells, actors }),
        contentType: "application/json",
      });
    } finally {
      timingRuns.delete(info.testId);
    }
  }
});

test.beforeAll(async () => {
  await ensureLocalTrialProgram();
});

async function captureHomeCell(
  actor: CaptureActor,
  state: HomeCell,
  info: TestInfo,
): Promise<HomeRecord> {
  const { page, profile } = actor;
  const { width, height, theme, preference, scale, label, canonicalIndex } =
    state;
  ensureActorRunning(profile);
  profile.currentCellLabel = label;
  const observation = { canonicalIndex, label, completed: false, pngCount: 0 };
  profile.cells.push(observation);
  // Every assigned cell specifies its own state; this is distributed layout
  // coverage, not a claim to preserve one page's temporal transition history.
  await measure(profile, "viewport.resize", () =>
    page.setViewportSize({ width, height }),
  );
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
  await measure(profile, "scroll.prepare-cell", () =>
    page
      .getByRole("main")
      .evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" })),
  );
  await measure(profile, "scale.fonts-raf", () =>
    page.evaluate(async (value) => {
      document.documentElement.style.fontSize = `${(16 * value) / 100}px`;
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }, scale),
  );
  const overflows = await measure(profile, "intrinsic-overflow.read", () =>
    page.getByRole("main").evaluate((main) =>
      [...main.querySelectorAll<HTMLElement>("*")]
        .filter(
          (el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1,
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
    expect(new Set(summaryRows).size, `${label}: balanced summary rows`).toBe(
      1,
    );
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
  const actionGeometry = await measure(profile, "layout.geometry-read", () =>
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
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
          violations.push("card outside primary group");
        const label = card.querySelector("strong")!;
        const range = document.createRange();
        range.selectNodeContents(label);
        const textRects = [...range.getClientRects()].filter(
          (text) => text.width > 0 && text.height > 0,
        );
        if (new Set(textRects.map((text) => Math.round(text.top))).size > 1)
          violations.push("wrapped action label");
        if (
          textRects.some(
            (text) => text.left < rect.left - 1 || text.right > rect.right + 1,
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
    expect(actionGeometry.rows.reduce((sum, count) => sum + count, 0)).toBe(4);
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
            Math.abs(help.top - group.top) <= 1 && help.left >= group.right,
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
  await measure(profile, "context.capture-contract", () =>
    assertCaptureContext(actor, state),
  );
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
  profile.pngCount += 1;
  observation.pngCount += 1;
  await measure(profile, "shortcuts.unlink", () => unlink(shortcutsPng));
  await measure(profile, "scroll.reset", () =>
    page
      .getByRole("main")
      .evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" })),
  );
  await measure(profile, "context.capture-contract", () =>
    assertCaptureContext(actor, state),
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
  profile.pngCount += 1;
  observation.pngCount += 1;
  await measure(profile, "page.unlink", () => unlink(pagePng));

  return {
    width,
    theme,
    preference,
    textScale: scale,
    route: "/home",
    fixture: "real confirmed member, no funding",
    wallet: "0원",
  };
}

test("unfunded home retains Korean layout across viewport and text scales", async ({
  page,
  browser,
  playwright,
  browserName,
  launchOptions,
  headless,
  channel,
  video,
}, info) => {
  const startedAt = performance.now();
  const profile = createProfile(0, startedAt);
  const rawVideoMode = typeof video === "string" ? video : video.mode;
  const videoMode =
    rawVideoMode === "retry-with-video" ? "on-first-retry" : rawVideoMode;
  const run: CaptureRun = {
    startedAt,
    originalPage: page,
    profiles: [profile],
    actors: [],
    videoMode,
    tasks: [],
    resources: [],
    stopped: false,
    failed: false,
  };
  timingRuns.set(info.testId, run);
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
  const environment = await measure(profile, "context.original-contract", () =>
    readCaptureEnvironment(page),
  );
  const state = await measure(profile, "actor.storage-state", () =>
    page.context().storageState({ indexedDB: true }),
  );
  const extraProfile = createProfile(1, startedAt);
  run.profiles.push(extraProfile);
  // Same Playwright instance inherits all resolved use/context options. Only
  // the authenticated state is copied in RAM; no second login or account.
  run.extraBrowser = await measure(extraProfile, "actor.browser-launch", () =>
    trackResource(
      run,
      () =>
        playwright[browserName].launch({
          ...launchOptions,
          headless,
          ...(channel === undefined ? {} : { channel }),
        }),
      (resource) => {
        run.extraBrowser = resource;
      },
    ),
  );
  expect(run.extraBrowser.version()).toBe(browser.version());
  run.extraContext = await measure(extraProfile, "actor.context-create", () =>
    trackResource(
      run,
      () =>
        run.extraBrowser!.newContext({
          storageState: structuredClone(state),
          ...(shouldRecordVideo(videoMode, info.retry)
            ? {
                recordVideo: {
                  dir: info.outputPath("home-capture-actor-1-video"),
                  ...(typeof video === "object" && video.size
                    ? { size: video.size }
                    : {}),
                },
              }
            : {}),
        }),
      (resource) => {
        run.extraContext = resource;
      },
    ),
  );
  const extraPage = await measure(extraProfile, "actor.page-create", () =>
    trackResource(
      run,
      () => run.extraContext!.newPage(),
      (resource) => {
        run.extraVideo = resource.video();
      },
    ),
  );
  run.extraVideo = extraPage.video();
  await measure(extraProfile, "actor.clone-route", () =>
    extraPage.goto("/home"),
  );
  await measure(extraProfile, "actor.settled-route", () =>
    expectSettledRoute(extraPage, "/home"),
  );
  await measure(extraProfile, "actor.wallet-assertion", () =>
    expect(extraPage.locator('[data-home-amount="wallet"]')).toHaveText("0원"),
  );
  expect(await readCaptureEnvironment(extraPage)).toEqual(environment);
  run.actors = [
    { id: 0, page, environment, profile, done: false },
    { id: 1, page: extraPage, environment, profile: extraProfile, done: false },
  ];
  const plannedCells = buildHomeCells();
  expect(plannedCells.filter((cell) => cell.owner === 0)).toHaveLength(56);
  expect(plannedCells.filter((cell) => cell.owner === 1)).toHaveLength(56);
  expect(plannedCells.at(-1)?.owner).toBe(0);
  const records: (HomeRecord | undefined)[] = [];
  run.matrixStartedAt = performance.now();
  run.tasks = run.actors.map(async (actor) => {
    try {
      for (const cell of plannedCells) {
        if (run.stopped) return;
        if (cell.owner !== actor.id) continue;
        const record = await captureHomeCell(actor, cell, info);
        ensureActorRunning(actor.profile);
        records[cell.canonicalIndex] = record;
        actor.profile.cells[actor.profile.cells.length - 1]!.completed = true;
        actor.profile.currentCellLabel = undefined;
      }
    } catch (error) {
      if (!run.failed) {
        run.failed = true;
        run.failure = error;
      }
      await cancelCaptureActors(run);
    } finally {
      actor.done = true;
    }
  });
  const outcomes = await Promise.allSettled(run.tasks);
  if (run.failed) throw run.failure;
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  const canonicalRecords = records.filter(
    (record): record is HomeRecord => record !== undefined,
  );
  measureAssertions(profile, () => expect(records).toHaveLength(112));
  expect(canonicalRecords).toHaveLength(112);
  const tuple = (
    record: Pick<HomeRecord, "width" | "theme" | "preference" | "textScale">,
  ) =>
    [record.width, record.preference, record.theme, record.textScale].join("|");
  expect(canonicalRecords.map(tuple)).toEqual(
    plannedCells.map((cell) => tuple({ ...cell, textScale: cell.scale })),
  );
  expect(new Set(canonicalRecords.map(tuple)).size).toBe(112);
  expect(
    run.profiles.map(
      (actor) => actor.cells.filter((cell) => cell.completed).length,
    ),
  ).toEqual([56, 56]);
  expect(
    run.profiles.every((actor) =>
      actor.cells.every((cell) => cell.pngCount === 2),
    ),
  ).toBe(true);
  expect(run.profiles.reduce((sum, actor) => sum + actor.pngCount, 0)).toBe(
    224,
  );
  await measure(profile, "matrix.attach", () =>
    info.attach("unfunded-home-typography-matrix", {
      body: JSON.stringify(canonicalRecords),
      contentType: "application/json",
    }),
  );
});
