import { unlink } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import {
  createConfirmedMember,
  createLocalServiceRoleClient,
} from "../fixtures/local-auth";
import { assertTypographyClean } from "../../typography/helpers";
import { ensureLocalTrialProgram } from "./helpers/eligibility";
import { loginAsMember } from "./helpers/member-session";
import { expectSettledRoute } from "./helpers/settled-route";
import { assertViewportFits } from "./helpers/viewport-geometry";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import { issueCommandFamilyToken } from "./helpers/admin-money-ui";

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
  setupAuthFundingMs: number;
  matrixStartedMs?: number | undefined;
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
    if (phase.startsWith("setup."))
      profile.setupAuthFundingMs += timing.durationMs;
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
      matrixStartedMs: details.matrixStartedMs,
      setupAuthFundingMs: phases
        .filter((phase) => phase.phase.startsWith("setup."))
        .reduce((sum, phase) => sum + phase.durationMs, 0),
      completedCells: details.cells.filter((cell) => cell.completed).length,
      lastLabel: details.cells.at(-1)?.label,
      currentPhase: details.currentPhase,
      lastMark: details.lastMark,
      pngBytes: details.pngBytes,
      phases: totals,
    };
    console.info(
      `FUNDED_HOME_TYPOGRAPHY_PHASE_PROFILE ${JSON.stringify(summary)}`,
    );
    await info.attach("funded-home-typography-phase-profile", {
      body: JSON.stringify({
        ...details,
        setupAuthFundingMs: summary.setupAuthFundingMs,
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

test("approved deposit Home retains real principal and readable shortcuts across 112 layouts", async ({
  page,
  browser,
}, info) => {
  const profile: TimingProfile = {
    startedAt: performance.now(),
    currentPhase: "setup.auth-and-funding",
    lastMark: {
      phase: "setup.auth-and-funding",
      elapsedMs: 0,
      state: "running",
    },
    setupAuthFundingMs: 0,
    pngBytes: 0,
    cells: [],
    phases: [],
  };
  timingProfiles.set(info.testId, profile);
  const finishSetup = beginPhase(profile, "setup.auth-and-funding");
  const member = await createConfirmedMember("funded-home-typography");
  const operator = await createConfirmedMember("funded-home-operator");
  await grantAdminRole(operator.userId);
  const local = createLocalServiceRoleClient();
  const policy = await local.rpc("read_effective_economy_policy", {
    p_effective_at_microseconds: String(BigInt(Date.now()) * 1000n),
  });
  expect(policy.error).toBeNull();
  const principal = String(
    policy.data?.policy?.configuration?.minimumPrincipalKrw,
  );
  expect(principal).toMatch(/^[1-9][0-9]*$/);
  const principalLabel = `${BigInt(principal).toLocaleString("ko-KR")}원`;
  await loginAsMember(page, member, "/home");
  await expectSettledRoute(page, "/home");
  const deposit = await page.evaluate(async (amountAtomic) => {
    const response = await fetch("/api/v1/deposits", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ amountAtomic, currency: "KRW" }),
    });
    const body = await response.json();
    return { status: response.status, requestId: body.data?.requestId };
  }, principal);
  expect(deposit.status).toBe(201);
  expect(deposit.requestId).toMatch(/^[a-f0-9-]{36}$/);
  const operatorContext = await browser.newContext({ baseURL: ADMIN_ORIGIN });
  let ledgerId: string;
  try {
    const operatorPage = await operatorContext.newPage();
    await completeAdminLoginWithTotp(
      operatorPage,
      operator.email,
      operator.password,
    );
    const grant = await issueCommandFamilyToken(
      operatorPage,
      "DEPOSIT_APPROVE",
    );
    expect(grant.status).toBe(200);
    expect(grant.token).toBeTruthy();
    const approval = await operatorPage.evaluate(
      async (input) => {
        const response = await fetch("/api/v1/admin/deposits/approve", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            confirmation: "APPROVE_DEPOSIT",
            depositRequestId: input.requestId,
            receivedAmountAtomic: input.principal,
            stepUpToken: input.token,
            reason:
              "Isolated Home readability test; actual canonical local deposit approval",
          }),
        });
        const body = await response.json();
        return { status: response.status, ledgerId: body.data?.ledgerId };
      },
      { requestId: deposit.requestId, principal, token: grant.token! },
    );
    expect(approval.status).toBe(200);
    expect(approval.ledgerId).toMatch(/^[a-f0-9-]{36}$/);
    ledgerId = approval.ledgerId;
  } finally {
    await operatorContext.close();
  }
  const depositBefore = await local
    .from("deposit_requests")
    .select("id,status,amount_atomic")
    .eq("id", deposit.requestId)
    .single();
  expect(depositBefore.error).toBeNull();
  expect(depositBefore.data?.status).toBe("APPROVED");
  expect(String(depositBefore.data?.amount_atomic)).toBe(principal);
  await page.reload();
  await expectSettledRoute(page, "/home");
  await expect(
    page
      .locator('#main-content [data-fact="principal"]')
      .filter({ visible: true }),
  ).toContainText(principalLabel);
  finishSetup(true);
  profile.matrixStartedMs = performance.now() - profile.startedAt;
  const records = [];
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
        const label = `funded-home-${width}-${preference}-${theme}-${scale}`;
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
        await measure(profile, "json.attach", () =>
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
        expect(summaryRows.reduce((sum, count) => sum + count, 0)).toBe(
          theme === "dark" ? 4 : 3,
        );
        expect(
          new Set(summaryRows).size,
          `${label}: balanced summary rows`,
        ).toBe(1);
        const shortcuts = page.getByRole("navigation", {
          name: "바로 가기",
          exact: true,
        });
        const primaryActions = shortcuts.locator("[data-home-primary-actions]");
        const visibleLinks = primaryActions.getByRole("link");
        await measure(profile, "layout.async-assertion", () =>
          expect(visibleLinks).toHaveCount(4),
        );
        expect(
          await measure(profile, "layout.hrefs-read", () =>
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
          "layout.action-geometry",
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
        expect(
          actionGeometry.violations,
          `${label}: readable shortcut labels and touch targets`,
        ).toEqual([]);
        expect(actionGeometry.rows.reduce((sum, count) => sum + count, 0)).toBe(
          4,
        );
        expect(
          new Set(actionGeometry.rows).size,
          `${label}: balanced primary shortcut rows`,
        ).toBe(1);
        const aiHelp = shortcuts.getByRole("button", {
          name: "AI 도움",
          exact: true,
        });
        if (theme === "dark") {
          await measure(profile, "layout.async-assertion", () =>
            expect(aiHelp).toBeVisible(),
          );
          const aiLabelFits = await measure(profile, "layout.ai-label", () =>
            aiHelp.evaluate((button) => {
              const bounds = button.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(button.querySelector("strong")!);
              return [...range.getClientRects()].every(
                (text) =>
                  text.left >= bounds.left - 1 &&
                  text.right <= bounds.right + 1,
              );
            }),
          );
          expect(
            aiLabelFits,
            `${label}: complete AI title inside its button`,
          ).toBe(true);
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
          expect(
            placement.inOwnRow
              ? placement.fillsGroupWidth
              : placement.alignedBesideGroup,
            `${label}: AI remains a deliberate help action`,
          ).toBe(true);
        } else {
          await measure(profile, "layout.async-assertion", () =>
            expect(aiHelp).toBeHidden(),
          );
        }
        await measure(profile, "json.attach", () =>
          info.attach(`${label}-shortcut-layout`, {
            body: JSON.stringify(actionGeometry),
            contentType: "application/json",
          }),
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
        await measure(profile, "shortcuts.unlink", () => unlink(shortcutsPng));
        // A locator capture taller than the viewport can include fixed-menu
        // occlusion. Preserve it, and prove each card through actual scrolling.
        if (
          (await measure(profile, "scrolled-card.bounds-read", () =>
            shortcuts.boundingBox(),
          ))!.height >
          page.viewportSize()!.height - 120
        ) {
          const cards = shortcuts.locator(
            "[data-home-primary-actions] a:visible, footer[data-ai-dock] button:visible",
          );
          for (
            let index = 0;
            index <
            (await measure(profile, "scrolled-card.count", () =>
              cards.count(),
            ));
            index++
          ) {
            const card = cards.nth(index);
            await measure(profile, "scrolled-card.scroll", () =>
              card.evaluate((element) => {
                const main = element.closest("main")!;
                const bounds = element.getBoundingClientRect();
                const mainBounds = main.getBoundingClientRect();
                main.scrollTo({
                  top:
                    main.scrollTop +
                    bounds.top -
                    mainBounds.top -
                    (main.clientHeight - bounds.height) / 2,
                  behavior: "instant",
                });
              }),
            );
            const visible = await measure(
              profile,
              "scrolled-card.visibility",
              () =>
                card.evaluate((element) => {
                  const bounds = element.getBoundingClientRect();
                  const mainBounds = element
                    .closest("main")!
                    .getBoundingClientRect();
                  const points = [
                    [(bounds.left + bounds.right) / 2, bounds.top + 3],
                    [(bounds.left + bounds.right) / 2, bounds.bottom - 3],
                    [bounds.left + 3, (bounds.top + bounds.bottom) / 2],
                    [bounds.right - 3, (bounds.top + bounds.bottom) / 2],
                    [
                      (bounds.left + bounds.right) / 2,
                      (bounds.top + bounds.bottom) / 2,
                    ],
                  ];
                  return (
                    bounds.top >= Math.max(0, mainBounds.top) &&
                    bounds.bottom <=
                      Math.min(window.innerHeight, mainBounds.bottom) &&
                    points.every(([x, y]) =>
                      element.contains(document.elementFromPoint(x!, y!)),
                    )
                  );
                }),
            );
            expect(
              visible,
              `${label}: scrolled card ${index + 1} is unobstructed`,
            ).toBe(true);
            const scrolledCardPng = info.outputPath(
              `${label}-scrolled-card-${index + 1}.png`,
            );
            const scrolledCardBytes = (
              await measure(profile, "scrolled-card.screenshot-path-io", () =>
                page.screenshot({
                  animations: "disabled",
                  path: scrolledCardPng,
                }),
              )
            ).length;
            profile.pngBytes += scrolledCardBytes;
            profile.phases[profile.phases.length - 1]!.pngBytes =
              scrolledCardBytes;
            await measure(profile, "scrolled-card.attach-copy-ipc", () =>
              info.attach(`${label}-scrolled-card-${index + 1}`, {
                path: scrolledCardPng,
                contentType: "image/png",
              }),
            );
            await measure(profile, "scrolled-card.unlink", () =>
              unlink(scrolledCardPng),
            );
          }
        }
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
          info.attach(label, { path: pagePng, contentType: "image/png" }),
        );
        await measure(profile, "page.unlink", () => unlink(pagePng));
        records.push({
          width,
          theme,
          preference,
          textScale: scale,
          route: "/home",
          fixture:
            "real approved local deposit, no allocation/session assertion",
          principal,
        });
        cell.completed = true;
        profile.currentCellLabel = undefined;
      }
    }
  }
  expect(records).toHaveLength(112);
  const finishFinalFinance = beginPhase(profile, "finance.final-check");
  const depositAfter = await local
    .from("deposit_requests")
    .select("id,status,amount_atomic")
    .eq("id", deposit.requestId)
    .single();
  expect(depositAfter.error).toBeNull();
  expect(depositAfter.data).toEqual(depositBefore.data);
  finishFinalFinance(true);
  await info.attach("funded-home-actual-deposit-source", {
    body: JSON.stringify({
      principal,
      ledgerId,
      requestId: deposit.requestId,
      externalBankTransfer: "NOT_TESTED",
      miningAllocationOrSession: "NOT_CLAIMED",
    }),
    contentType: "application/json",
  });
  await info.attach("funded-home-typography-matrix", {
    body: JSON.stringify(records),
    contentType: "application/json",
  });
});
