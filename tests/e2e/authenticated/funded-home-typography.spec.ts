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

test.beforeAll(async () => {
  await ensureLocalTrialProgram();
});

test("approved deposit Home retains real principal and readable shortcuts across 112 layouts", async ({
  page,
  browser,
}, info) => {
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
  await expect(page.locator('[data-fact="principal"]')).toContainText(
    principalLabel,
  );
  const records = [];
  // Start with the newly exposed 430px breakpoint, then cover every requested width.
  for (const width of [430, 320, 360, 390, 834, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 834 ? 1112 : 900 });
    for (const { theme, preference } of [
      { theme: "dark", preference: "dark" },
      { theme: "light", preference: "light" },
      { theme: "dark", preference: "system" },
      { theme: "light", preference: "system" },
    ] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page
        .getByRole("combobox", { name: "화면 테마" })
        .first()
        .selectOption(preference);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const scale of [100, 125, 150, 200]) {
        const label = `funded-home-${width}-${preference}-${theme}-${scale}`;
        await page.evaluate(async (value) => {
          document.documentElement.style.fontSize = `${(16 * value) / 100}px`;
          await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        }, scale);
        const overflows = await page.getByRole("main").evaluate((main) =>
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
        );
        await info.attach(`${label}-intrinsic-overflows`, {
          body: JSON.stringify(overflows),
          contentType: "application/json",
        });
        await assertViewportFits(page, info, label);
        await assertTypographyClean(page, label, info);
        const summaryRows = await page
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
          });
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
        await expect(visibleLinks).toHaveCount(4);
        expect(
          await visibleLinks.evaluateAll((links) =>
            links.map((link) => link.getAttribute("href")),
          ),
        ).toEqual([
          "/mining",
          "/wallet/deposit",
          "/wallet/withdraw",
          theme === "dark" ? "/events" : "/wallet?view=history",
        ]);
        const actionGeometry = await primaryActions.evaluate((grid) => {
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
                (text) =>
                  text.left < rect.left - 1 || text.right > rect.right + 1,
              )
            )
              violations.push("label outside card");
          }
          return { rows: [...rows.values()], violations };
        });
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
          await expect(aiHelp).toBeVisible();
          const aiLabelFits = await aiHelp.evaluate((button) => {
            const bounds = button.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(button.querySelector("strong")!);
            return [...range.getClientRects()].every(
              (text) =>
                text.left >= bounds.left - 1 && text.right <= bounds.right + 1,
            );
          });
          expect(
            aiLabelFits,
            `${label}: complete AI title inside its button`,
          ).toBe(true);
          const placement = await shortcuts.evaluate((nav) => {
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
          });
          expect(
            placement.inOwnRow
              ? placement.fillsGroupWidth
              : placement.alignedBesideGroup,
            `${label}: AI remains a deliberate help action`,
          ).toBe(true);
        } else {
          await expect(aiHelp).toBeHidden();
        }
        await info.attach(`${label}-shortcut-layout`, {
          body: JSON.stringify(actionGeometry),
          contentType: "application/json",
        });
        await info.attach(`${label}-shortcuts`, {
          body: await shortcuts.screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });
        // A locator capture taller than the viewport can include fixed-menu
        // occlusion. Preserve it, and prove each card through actual scrolling.
        if (
          (await shortcuts.boundingBox())!.height >
          page.viewportSize()!.height - 120
        ) {
          const cards = shortcuts.locator(
            "[data-home-primary-actions] a:visible, footer[data-ai-dock] button:visible",
          );
          for (let index = 0; index < (await cards.count()); index++) {
            const card = cards.nth(index);
            await card.evaluate((element) => {
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
            });
            const visible = await card.evaluate((element) => {
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
            });
            expect(
              visible,
              `${label}: scrolled card ${index + 1} is unobstructed`,
            ).toBe(true);
            await info.attach(`${label}-scrolled-card-${index + 1}`, {
              body: await page.screenshot({ animations: "disabled" }),
              contentType: "image/png",
            });
          }
        }
        await page
          .getByRole("main")
          .evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
        await info.attach(label, {
          body: await page.screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });
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
      }
    }
  }
  expect(records).toHaveLength(112);
  const depositAfter = await local
    .from("deposit_requests")
    .select("id,status,amount_atomic")
    .eq("id", deposit.requestId)
    .single();
  expect(depositAfter.error).toBeNull();
  expect(depositAfter.data).toEqual(depositBefore.data);
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
