import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import { createLocalServiceRoleClient } from "./helpers/eligibility";
import { grantNamedAdminRole } from "./helpers/admin-kyc-ui";

test.describe("admin Member 360 product states", () => {
  test("labelled navigation keeps member work above the fold across screen sizes", async ({
    page,
  }, testInfo) => {
    const operator = await createConfirmedMember("admin-members-nav");
    await grantAdminRole(operator.userId);
    await completeAdminLoginWithTotp(page, operator.email, operator.password);
    await page.goto(`${ADMIN_ORIGIN}/members`);
    const heading = page.getByRole("heading", { name: "회원 한 사람의 맥락" });
    await expect(heading).toBeVisible({ timeout: 60_000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });

    const menu = page.getByRole("button", { name: "운영 메뉴" });
    const navigation = page.getByRole("navigation", { name: "운영자 주 메뉴" });
    const logout = page.getByRole("button", { name: "이 기기 로그아웃" });
    for (const width of [320, 390, 834, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["system", "light", "dark"]) {
        await page.getByLabel("화면 테마").selectOption(theme);
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(heading).toBeInViewport();
        await expect(
          page.getByRole("button", { name: "안전 조회" }),
        ).toBeInViewport();
        const headingBox = await heading.boundingBox();
        expect(headingBox!.y).toBeLessThan(280);
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
          )
          .toBe(true);

        if (width < 1100) {
          await expect(menu).toBeVisible();
          await expect(menu).toHaveAttribute("aria-expanded", "false");
          await expect(navigation).toBeHidden();
          await expect(logout).toBeHidden();
          const menuBox = await menu.boundingBox();
          expect(menuBox!.height).toBeGreaterThanOrEqual(44);
          await menu.focus();
          await menu.press("Enter");
          await expect(menu).toHaveAttribute("aria-expanded", "true");
          await expect(navigation.getByRole("link")).toHaveCount(12);
          await expect(logout).toBeVisible();
          await expect(
            page.getByRole("button", { name: "모든 세션 종료" }),
          ).toBeVisible();
          await expect(page.locator(".operator-card")).toHaveCSS(
            "position",
            "static",
          );
          for (const destination of await navigation.getByRole("link").all()) {
            const box = await destination.boundingBox();
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(box!.x).toBeGreaterThanOrEqual(16);
            expect(box!.x + box!.width).toBeLessThanOrEqual(width - 16);
          }
          await page.screenshot({
            path: testInfo.outputPath(`admin-menu-open-${width}-${theme}.png`),
          });
          await menu.press("Tab");
          await expect(navigation.getByRole("link").first()).toBeFocused();
          await page.keyboard.press("Escape");
          await expect(menu).toHaveAttribute("aria-expanded", "false");
          await expect(menu).toBeFocused();
          await expect(navigation).toBeHidden();
        } else {
          await expect(menu).toBeHidden();
          await expect(navigation).toBeVisible();
          await expect(logout).toBeVisible();
          const railBox = await page.locator(".control-rail").boundingBox();
          expect(railBox!.width).toBe(250);
        }
        await page.screenshot({
          path: testInfo.outputPath(`admin-menu-closed-${width}-${theme}.png`),
        });
      }
      if (width < 1100) {
        await menu.click();
        await navigation
          .getByRole("link", { name: /오늘의 퍼뜩/ })
          .press("Enter");
        await expect(page).toHaveURL(`${ADMIN_ORIGIN}/`);
        await expect(menu).toHaveAttribute("aria-expanded", "false");
        await expect(navigation).toBeHidden();
        await menu.click();
        await navigation.getByRole("link", { name: /회원 종합 정보/ }).click();
        await expect(page).toHaveURL(`${ADMIN_ORIGIN}/members`);
        await expect(menu).toHaveAttribute("aria-expanded", "false");
        await expect(heading).toBeInViewport();
      }
    }
    // The canonical desktop rail starts at 1100px; tablets retain the disclosure.
    await page.setViewportSize({ width: 1099, height: 900 });
    await expect(menu).toBeVisible();
    await expect(navigation).toBeHidden();
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(menu).toBeHidden();
    await expect(navigation).toBeVisible();

    await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    try {
      await menu.click();
      await expect(navigation).toBeVisible();
      const rail = await page.locator(".control-rail").boundingBox();
      const brand = await page.locator(".brand-lockup--rail").boundingBox();
      const toggle = await menu.boundingBox();
      expect(brand!.x + brand!.width).toBeLessThanOrEqual(390);
      expect(toggle!.x + toggle!.width).toBeLessThanOrEqual(390);
      expect(
        brand!.y + brand!.height <= toggle!.y ||
          brand!.x + brand!.width <= toggle!.x,
      ).toBe(true);
      expect(rail!.width).toBeLessThanOrEqual(390);
      await page.screenshot({
        path: testInfo.outputPath("admin-menu-200-percent-390-dark.png"),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      await expect(navigation).toBeHidden();
    } finally {
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
    }
  });

  test("authorized empty, invalid lookup, and owned member evidence", async ({
    page,
  }, testInfo) => {
    const operator = await createConfirmedMember("admin-members-op");
    await grantAdminRole(operator.userId);
    await completeAdminLoginWithTotp(page, operator.email, operator.password);

    await page.goto(`${ADMIN_ORIGIN}/members`);
    await expect(
      page.getByRole("heading", { name: "회원 한 사람의 맥락" }),
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("조회할 회원을 선택하세요.")).toBeVisible();
    await expect(page.getByLabel("이름·아이디·전화번호")).toBeVisible();

    // Existing exact-UUID deep links still reject malformed identifiers.
    await page.goto(`${ADMIN_ORIGIN}/members?id=not-a-uuid`);
    await expect(
      page.getByRole("alert").filter({
        hasText: "올바른 회원 식별자를 입력해 주세요.",
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("이름·아이디·전화번호")).toHaveValue(
      "not-a-uuid",
    );

    const member = await createConfirmedMember("admin-members-target");
    await page.goto(`${ADMIN_ORIGIN}/members?id=${member.userId}`);
    const selectedIdentity = page.locator(".member-identity code");
    await expect(selectedIdentity).toHaveText(member.userId, {
      timeout: 60_000,
    });
    await expect(selectedIdentity).toBeVisible();
    await expect(page.getByText("채굴 · 정산")).toBeVisible();
    // 채굴 건수는 실패를 0으로 위장하지 않는다. SELECT 권한이 있으면 숫자다.
    const miningCard = page.locator(".member-module-grid article").filter({
      hasText: "채굴 · 정산",
    });
    await expect(miningCard.locator("strong")).toHaveText(
      /^(확인 필요|\d[\d,]*)$/,
    );
    await expect(
      page.getByRole("heading", { name: "계정 상태" }),
    ).toBeVisible();
    await expect(
      page.getByText("원화 입금 기록 없음", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("USDT 입금 기록 없음", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("출금 기록 없음")).toBeVisible();

    const sources = page.locator("#evidence-money-sources");
    const sourceValue = (label: string) =>
      sources
        .locator("dl > div")
        .filter({
          has: page.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }),
        })
        .locator("dd");
    await expect(sourceValue("채굴 인정 원금")).toHaveText("0원");
    await expect(sourceValue("누적 채굴 수익")).toHaveText("확인 필요");
    await expect(sourceValue("확정 채굴 수익")).toHaveText("확인 필요");
    await expect(sourceValue("정산 전 대기 수익")).toBeVisible();
    await expect(sourceValue("아직 확정 전")).toBeVisible();
    await expect(sources.getByText("확정된 수익이 아니에요")).toBeVisible();
    const db = createLocalServiceRoleClient();
    const created = await db.rpc("create_deposit_request", {
      p_user_id: member.userId,
      p_currency: "KRW",
      p_amount_atomic: "3000",
      p_idempotency_key: `member-source-request-${randomUUID()}`,
    });
    expect(created.error).toBeNull();
    const approved = await db.rpc("approve_deposit_request", {
      p_deposit_request_id: created.data,
      p_operator_id: operator.userId,
      p_received_amount_atomic: "3000",
      p_ledger_idempotency_key: `member-source-credit-${randomUUID()}`,
      p_reason: "new source capture fixture bank transfer confirmed",
      p_request_id: randomUUID(),
    });
    expect(approved.error).toBeNull();
    const usdtId = randomUUID();
    const submitted = await db.from("usdt_manual_deposits").insert({
      id: usdtId,
      user_id: member.userId,
      network: "TRC20",
      tx_hash: randomUUID().replaceAll("-", "").repeat(2),
      sent_usdt_amount: "10.000001",
      deposit_address_snapshot: "TLOCALMONEYSOURCEFIXTURE000001",
      network_snapshot: "TRC20",
      idempotency_key: `member-source-usdt-${usdtId}`,
    });
    expect(submitted.error).toBeNull();
    const confirmed = await db.rpc("confirm_usdt_manual_deposit", {
      p_deposit_id: usdtId,
      p_credited_krw: "7000",
      p_actor: operator.userId,
      p_reason: "new source capture fixture manual USDT confirmed",
      p_idempotency_key: `member-source-usdt-credit-${usdtId}`,
    });
    expect(confirmed.error).toBeNull();
    await page.reload();
    await expect(sourceValue("채굴 인정 원금")).toHaveText("10,000원");
    await expect(sourceValue("누적 원화 원금 입금")).toHaveText("3,000원");
    await expect(sourceValue("누적 USDT 환산 원금")).toHaveText("7,000원");
    const capture = await db
      .from("money_source_movements")
      .select("id,source_bucket")
      .eq("user_id", member.userId);
    expect(capture.error).toBeNull();
    expect(capture.data).toHaveLength(2);
    expect(
      capture.data!.every((row) => row.source_bucket === "PRINCIPAL"),
    ).toBe(true);

    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    async function saveSources(state: string) {
      for (const width of [320, 390, 834, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ["system", "light", "dark"]) {
          await page.getByLabel("화면 테마").selectOption(theme);
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  document.documentElement.scrollWidth <= window.innerWidth + 1,
              ),
            )
            .toBe(true);
          await sources.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: testInfo.outputPath(
              `money-sources-${state}-${width}-${theme}.png`,
            ),
            fullPage: true,
          });
          await sources.screenshot({
            path: testInfo.outputPath(
              `money-source-panel-${state}-${width}-${theme}.png`,
            ),
          });
        }
      }
    }
    await saveSources("confirmed");
    const wallet = await db
      .from("wallet_accounts")
      .select("id")
      .eq("user_id", member.userId)
      .eq("currency", "KRW")
      .single();
    expect(wallet.error).toBeNull();
    const ambiguous = await db.from("wallet_ledger").insert({
      wallet_account_id: wallet.data!.id,
      user_id: member.userId,
      direction: "CREDIT",
      entry_type: "ADMIN_ADJUSTMENT",
      amount_atomic: "5000",
      idempotency_key: `unknown-source-${randomUUID()}`,
      reference_type: "local_ambiguous_history_fixture",
      reference_id: randomUUID(),
      reason: "unknown historical source fixture",
    });
    expect(ambiguous.error).toBeNull();
    await page.reload();
    await expect(sourceValue("채굴 인정 원금")).toHaveText("확인 필요");
    await expect(sourceValue("누적 원화 원금 입금")).toHaveText("확인 필요");
    await expect(sources.getByRole("status")).toContainText("자금 출처를 확인");
    await expect(
      sources.getByText("기록 시작 이후 확인된 입금", { exact: true }),
    ).toBeVisible();
    await saveSources("unresolved");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("증거 구역")).toBeVisible();
    await expect(page.getByRole("link", { name: "계정" })).toBeVisible();
  });

  test("unknown member uuid stays non-enumerating", async ({ page }) => {
    const operator = await createConfirmedMember("admin-members-miss");
    await grantAdminRole(operator.userId);
    await completeAdminLoginWithTotp(page, operator.email, operator.password);

    await page.goto(
      `${ADMIN_ORIGIN}/members?id=00000000-0000-4000-8000-000000000099`,
    );
    await expect(
      page.getByRole("heading", { name: "회원을 찾지 못했습니다." }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: "다시 조회" })).toBeVisible();
  });

  test("name, login ID, UUID and formatted phone searches return masked audited choices", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(300_000);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const name = `검색검증${suffix}`;
    const phone = `+8210${String(BigInt(`0x${suffix}`) % 100000000n).padStart(8, "0")}`;
    const member = await createConfirmedMember("admin-member-search-target", {
      legalName: name,
      phoneE164: phone,
    });
    await createConfirmedMember("admin-member-search-namesake", {
      legalName: name,
    });
    const db = createLocalServiceRoleClient();
    const identity = await db
      .from("user_identity_profiles")
      .select("login_id")
      .eq("user_id", member.userId)
      .single();
    expect(identity.error).toBeNull();
    const loginId = String(identity.data!.login_id);
    const operator = await createConfirmedMember("admin-member-search-op");
    await grantAdminRole(operator.userId);
    await completeAdminLoginWithTotp(page, operator.email, operator.password);
    await page.goto(`${ADMIN_ORIGIN}/members`);

    async function search(query: string) {
      await page.getByLabel("이름·아이디·전화번호").fill(query);
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/admin/members/search") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "안전 조회" }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      const payload = await response.json();
      expect(JSON.stringify(payload)).not.toContain(phone);
      expect(JSON.stringify(payload)).not.toContain(name);
      expect(JSON.stringify(payload)).not.toContain(loginId);
      await expect(
        page.getByRole("list", { name: "회원 검색 결과" }),
      ).toBeVisible();
      await expect(page).toHaveURL(`${ADMIN_ORIGIN}/members`);
      return payload.data.members as { userId: string }[];
    }

    const named = await search(name.slice(0, -2));
    expect(named.map((row) => row.userId)).toContain(member.userId);
    expect(named).toHaveLength(2);
    const searchResults = page.getByRole("list", { name: "회원 검색 결과" });
    for (const width of [390, 834, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["system", "light", "dark"]) {
        await page.getByLabel("화면 테마").selectOption(theme);
        await expect(searchResults.getByRole("link")).toHaveCount(2);
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          )
          .toBe(true);
        const target = await searchResults
          .getByRole("link")
          .first()
          .boundingBox();
        expect(target!.height).toBeGreaterThanOrEqual(44);
        await page.screenshot({
          path: testInfo.outputPath(
            `member-search-results-${width}-${theme}.png`,
          ),
          fullPage: true,
        });
      }
    }
    expect(
      (await search(loginId.toUpperCase())).map((row) => row.userId),
    ).toEqual([member.userId]);
    expect((await search(member.userId)).map((row) => row.userId)).toEqual([
      member.userId,
    ]);
    const localPhone = `0${phone.slice(3)}`;
    for (const query of [
      localPhone,
      `${localPhone.slice(0, 3)}-${localPhone.slice(3, 7)}-${localPhone.slice(7)}`,
      phone,
    ])
      expect((await search(query)).map((row) => row.userId)).toEqual([
        member.userId,
      ]);
    const results = page.getByRole("list", { name: "회원 검색 결과" });
    await expect(results).toContainText(phone.slice(-4));
    expect(await results.innerText()).not.toContain(phone);
    await results.locator(`a[href="/members?id=${member.userId}"]`).click();
    await expect(page.locator(".member-identity code")).toHaveText(
      member.userId,
      { timeout: 60_000 },
    );
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await page.getByText("다른 회원 찾기", { exact: true }).click();
    await expect(page.getByLabel("이름·아이디·전화번호")).toBeVisible();

    const audits = await db
      .from("audit_logs")
      .select("actor_role,metadata,reason")
      .eq("actor_user_id", operator.userId)
      .eq("action", "ADMIN_MEMBER_SEARCH");
    expect(audits.error).toBeNull();
    expect(audits.data!.length).toBeGreaterThanOrEqual(6);
    const auditText = JSON.stringify(audits.data);
    for (const privateQuery of [name, phone, loginId, member.userId])
      expect(auditText).not.toContain(privateQuery);

    // Existing SUPPORT_ADMIN Member 360 capability stays masked; KYC stays denied.
    const support = await createConfirmedMember("admin-member-search-support");
    await grantNamedAdminRole(support.userId, "SUPPORT_ADMIN");
    const supportContext = await browser.newContext();
    const supportPage = await supportContext.newPage();
    try {
      await completeAdminLoginWithTotp(
        supportPage,
        support.email,
        support.password,
      );
      await supportPage.goto(`${ADMIN_ORIGIN}/members`);
      await supportPage.getByLabel("이름·아이디·전화번호").fill(localPhone);
      await supportPage.getByRole("button", { name: "안전 조회" }).click();
      const choices = supportPage.getByRole("list", { name: "회원 검색 결과" });
      await expect(
        choices.locator(`a[href="/members?id=${member.userId}"]`),
      ).toBeVisible();
      expect(await choices.innerText()).not.toContain(phone);
      await choices.locator(`a[href="/members?id=${member.userId}"]`).click();
      await expect(supportPage.locator("#evidence-kyc")).toContainText(
        "현재 역할에는 본인 확인 조회 권한이 없습니다.",
      );
    } finally {
      await supportContext.close();
    }

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(`${ADMIN_ORIGIN}/login`);
      const anonymous = await guestPage.evaluate(async () => {
        const response = await fetch("/api/v1/admin/members/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "퍼뜩" }),
        });
        return { status: response.status, body: await response.json() };
      });
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.data).toBeUndefined();
      await guestPage.locator('input[name="email"]').fill(member.email);
      await guestPage.locator('input[name="password"]').fill(member.password);
      await guestPage.getByRole("button", { name: "보안 로그인" }).click();
      await expect(
        guestPage.getByRole("alert").filter({
          hasText: "입력한 정보로 운영자 로그인을 완료할 수 없습니다.",
        }),
      ).toBeVisible({ timeout: 30_000 });
      const ordinaryMember = await guestPage.evaluate(async () => {
        const response = await fetch("/api/v1/admin/members/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "퍼뜩" }),
        });
        return { status: response.status, body: await response.json() };
      });
      expect(ordinaryMember.status).toBe(401);
      expect(ordinaryMember.body.data).toBeUndefined();
    } finally {
      await guestContext.close();
    }
  });
});
