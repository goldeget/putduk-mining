import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  createConfirmedMember,
  createLocalServiceRoleClient,
} from "../fixtures/local-auth";
import {
  prepareMemberThroughStart,
  requireWithdrawalDataKey,
} from "./helpers/journey";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
  registerDestinationViaProductionApi,
} from "./helpers/member-session";
import { nextTotpCode } from "./helpers/admin-totp";
import {
  reauthenticateDestination,
  type ReauthDestination,
} from "./helpers/withdrawal-reauth";

// Password/OTP/proof requests must not enter persisted browser traces/videos.
// Explicit evidence screenshots mask every credential and destination control.
test.use({ trace: "off", video: "off", screenshot: "off" });
const URL = "/api/v1/withdrawals/destinations";
const MATERIAL: Record<"KRW_BANK" | "USDT_ADDRESS", ReauthDestination> = {
  KRW_BANK: {
    method: "KRW_BANK",
    bankCode: "KB",
    accountHolder: "퍼뜩테스트",
    accountNumber: "110123456789",
  },
  USDT_ADDRESS: {
    method: "USDT_ADDRESS",
    network: "ERC20",
    address: "0x" + "a".repeat(40),
  },
};
const REPLACEMENT: typeof MATERIAL = {
  KRW_BANK: {
    method: "KRW_BANK",
    bankCode: "KB",
    accountHolder: "퍼뜩테스트",
    accountNumber: "110987654321",
  },
  USDT_ADDRESS: {
    method: "USDT_ADDRESS",
    network: "ERC20",
    address: "0x" + "b".repeat(40),
  },
};

async function noMoney(ownerId: string) {
  const db = createLocalServiceRoleClient();
  for (const [table, ownerColumn] of [
    ["withdrawal_requests", "user_id"],
    ["transaction_receipts", "user_id"],
    ["deposit_requests", "user_id"],
  ] as const) {
    let query = db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(ownerColumn, ownerId);
    if (table === "transaction_receipts")
      query = query.eq("source_type", "withdrawal_request");
    const { count, error } = await query;
    expect(error).toBeNull();
    expect(count, `${table} remains empty`).toBe(0);
  }
  const outbox = await db
    .from("outbox_events")
    .select("id", { count: "exact", head: true })
    .eq("actor_user_id", ownerId)
    .eq("event_type", "WITHDRAWAL_REQUESTED.v1");
  expect(outbox.error).toBeNull();
  expect(outbox.count).toBe(0);
  const wallet = await db
    .from("wallet_balance_snapshots")
    .select("balance_atomic,available_balance_atomic")
    .eq("user_id", ownerId)
    .eq("currency", "KRW")
    .single();
  expect(wallet.error).toBeNull();
  expect(wallet.data?.balance_atomic).toBe(
    wallet.data?.available_balance_atomic,
  );
}
async function proofStates(ownerId: string) {
  const result = await createLocalServiceRoleClient()
    .from("withdrawal_destination_step_ups")
    .select("status")
    .eq("user_id", ownerId)
    .order("created_at");
  expect(result.error).toBeNull();
  return result.data?.map((row) => row.status);
}
async function evidence(page: Page, name: string) {
  const screenshotPath = test.info().outputPath(`${name}.png`);
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    mask: [
      page.locator(
        'input[name="destinationReauthPassword"],input[name="destinationReauthTotp"],input[name="accountHolder"],input[name="accountNumber"],input[name="address"]',
      ),
    ],
  });
  await test.info().attach(name, {
    contentType: "image/png",
    path: screenshotPath,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
async function fillChange(page: Page, destination: ReauthDestination) {
  await page.goto("/wallet/withdraw");
  await dismissGuidedQuestIfPresent(page);
  await expect(page.locator("#withdrawal-amount")).toBeVisible();
  if (destination.method === "USDT_ADDRESS")
    await page
      .locator('input[name="withdrawalMethod"][value="USDT_ADDRESS"]')
      .check();
  await page
    .getByRole("button", { name: "다른 목적지로 변경", exact: true })
    .click();
  await page.locator("#withdrawal-amount").fill("1000");
  if (destination.method === "KRW_BANK") {
    await page
      .locator('select[name="bankCode"]')
      .selectOption(destination.bankCode);
    await page
      .locator('input[name="accountHolder"]')
      .fill(destination.accountHolder);
    await page
      .locator('input[name="accountNumber"]')
      .fill(destination.accountNumber);
  } else {
    await page
      .locator('select[name="network"]')
      .selectOption(destination.network);
    await page.locator('input[name="address"]').fill(destination.address);
  }
}
test.beforeAll(() => requireWithdrawalDataKey());

for (const method of ["KRW_BANK", "USDT_ADDRESS"] as const) {
  test(`${method}: exact destination, owner, session, single use and concurrent replacement`, async ({
    page,
    context,
  }) => {
    const member = await createConfirmedMember(
      `reauth-${method.toLowerCase()}`,
    );
    await loginAsMember(page, member);
    await registerDestinationViaProductionApi(page, MATERIAL[method]);
    const replacement = REPLACEMENT[method];
    const missing = await page.request.post(URL, { data: replacement });
    expect(missing.status()).toBe(403);
    expect((await missing.json()).error.code).toBe(
      "WITHDRAWAL_REAUTH_REQUIRED",
    );
    const random = await page.request.post(URL, {
      data: replacement,
      headers: { "Withdrawal-Reauth": "x".repeat(43) },
    });
    expect(random.status()).toBe(403);
    const proof = await reauthenticateDestination(
      page,
      replacement,
      member.password,
    );
    const changedMaterial =
      method === "KRW_BANK"
        ? { ...REPLACEMENT.KRW_BANK, accountNumber: "110000000001" }
        : { ...REPLACEMENT.USDT_ADDRESS, address: "0x" + "c".repeat(40) };
    expect(
      (
        await page.request.post(URL, {
          data: changedMaterial,
          headers: { "Withdrawal-Reauth": proof },
        })
      ).status(),
    ).toBe(403);
    const otherMethod = method === "KRW_BANK" ? "USDT_ADDRESS" : "KRW_BANK";
    expect(
      (
        await page.request.post(URL, {
          data: REPLACEMENT[otherMethod],
          headers: { "Withdrawal-Reauth": proof },
        })
      ).status(),
    ).toBe(403);

    const secondContext = await context.browser()!.newContext({
      baseURL:
        test.info().project.use.baseURL ??
        `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "3000"}`,
    });
    try {
      const second = await secondContext.newPage();
      await loginAsMember(second, member);
      expect(
        (
          await second.request.post(URL, {
            data: replacement,
            headers: { "Withdrawal-Reauth": proof },
          })
        ).status(),
      ).toBe(403);
      const other = await createConfirmedMember("reauth-other");
      await loginAsMember(second, other);
      await registerDestinationViaProductionApi(second, MATERIAL[method]);
      expect(
        (
          await second.request.post(URL, {
            data: replacement,
            headers: { "Withdrawal-Reauth": proof },
          })
        ).status(),
      ).toBe(403);
      await noMoney(other.userId);
    } finally {
      await secondContext.close();
    }

    const results = await Promise.all(
      [1, 2].map(() =>
        page.request.post(URL, {
          data: replacement,
          headers: { "Withdrawal-Reauth": proof },
        }),
      ),
    );
    expect(results.map((res) => res.status()).sort()).toEqual([201, 403]);
    expect(
      (
        await page.request.post(URL, {
          data: replacement,
          headers: { "Withdrawal-Reauth": proof },
        })
      ).status(),
    ).toBe(403);
    expect(await proofStates(member.userId)).toEqual(["CONSUMED"]);
    const db = createLocalServiceRoleClient();
    const history = await db
      .from("withdrawal_destination_history")
      .select("id", { count: "exact", head: true })
      .eq("user_id", member.userId);
    expect(history.error).toBeNull();
    expect(history.count).toBe(3);
    const active = await db
      .from("withdrawal_destinations")
      .select("protection_until")
      .eq("user_id", member.userId)
      .is("replaced_at", null)
      .single();
    expect(active.error).toBeNull();
    expect(Date.parse(active.data!.protection_until)).toBeGreaterThan(
      Date.now() + 23 * 60 * 60 * 1000,
    );
    await noMoney(member.userId);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`${method}: ${theme} real password UI, safe replacement and response-loss recovery`, async ({
      page,
    }) => {
      const { member } = await prepareMemberThroughStart(
        page,
        `reauth-ui-${theme}-${method.toLowerCase()}`,
      );
      await registerDestinationViaProductionApi(page, MATERIAL[method]);
      await page.evaluate((value) => {
        localStorage.setItem("putduk-theme", value);
        document.documentElement.dataset.theme = value;
        document.documentElement.style.colorScheme = value;
      }, theme);
      await page.emulateMedia({ colorScheme: theme });
      await fillChange(page, REPLACEMENT[method]);
      await expect(
        page.getByRole("heading", { name: "변경 전 비밀번호 확인" }),
      ).toBeVisible();
      const password = page.locator('input[name="destinationReauthPassword"]');
      await password.fill("Incorrect-local-password-Aa1");
      await page
        .getByRole("button", { name: "비밀번호 보기", exact: true })
        .click();
      await expect(password).toHaveAttribute("type", "text");
      await page
        .getByRole("button", { name: "비밀번호 가리기", exact: true })
        .click();
      await evidence(page, `${method}-${theme}-reauth`);
      if (test.info().project.name === "chromium") {
        const viewport = page.viewportSize()!;
        await page.setViewportSize({ width: 834, height: 1112 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await password.focus();
        await expect(password).toBeFocused();
        await evidence(page, `${method}-${theme}-tablet-reduced-motion`);
        await page.setViewportSize(viewport);
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
      await page
        .getByRole("button", { name: "변경 확인", exact: true })
        .click();
      await expect(page.locator("#withdrawal-request-feedback")).toContainText(
        "비밀번호",
        { timeout: 60_000 },
      );
      await expect(password).toHaveValue("");
      expect(await proofStates(member.userId)).toEqual(["DENIED"]);
      await evidence(page, `${method}-${theme}-error`);

      let committedStatus = 0;
      let registrations = 0;
      let holds = 0;
      page.on("request", (req) => {
        if (req.url().endsWith("/withdrawals/hold") && req.method() === "POST")
          holds++;
      });
      await page.route("**/api/v1/withdrawals/destinations", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        registrations++;
        if (theme === "dark" && registrations === 1) {
          const upstream = await route.fetch();
          committedStatus = upstream.status();
          await route.abort("connectionreset");
        } else await route.continue();
      });
      await password.fill(member.password);
      await page
        .getByRole("button", { name: "변경 확인", exact: true })
        .click();
      if (theme === "dark") {
        await expect(
          page.locator("#withdrawal-request-feedback"),
        ).toContainText("인터넷 연결", { timeout: 60_000 });
        expect(committedStatus).toBe(201);
        await page.reload();
        await dismissGuidedQuestIfPresent(page);
        await expect(
          page.locator("#withdrawal-request-feedback"),
        ).toContainText("이전 요청을 정리했어요", { timeout: 60_000 });
      } else {
        await expect(
          page.locator("#withdrawal-request-feedback"),
        ).toContainText("계좌·주소를 변경했어요", { timeout: 60_000 });
      }
      await expect(
        page.getByText(
          "방금 변경한 목적지는 보호 시간이 끝난 뒤 출금할 수 있어요.",
          { exact: false },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "출금 요청하기", exact: true }),
      ).toBeDisabled();
      await evidence(page, `${method}-${theme}-protected`);
      expect(registrations).toBe(1);
      expect(holds).toBe(0);
      expect(await proofStates(member.userId)).toEqual(["DENIED", "CONSUMED"]);
      const local = await page.evaluate(() =>
        JSON.stringify(Object.entries(localStorage)),
      );
      expect(local.includes(member.password)).toBe(false);
      expect(local.includes("destinationReauthPassword")).toBe(false);
      const logical = await createLocalServiceRoleClient()
        .from("withdrawal_logical_requests")
        .select("state,withdrawal_id")
        .eq("user_id", member.userId)
        .single();
      expect(logical.error).toBeNull();
      expect(logical.data?.state).toBe("CANCELLED");
      expect(logical.data?.withdrawal_id).toBeNull();
      await noMoney(member.userId);
    });
  }
}

test("five failed password attempts are durable and sixth is rate limited", async ({
  page,
}) => {
  const member = await createConfirmedMember("reauth-limit");
  await loginAsMember(page, member);
  for (let n = 0; n < 5; n++) {
    const response = await page.request.post(`${URL}/reauth`, {
      data: {
        destination: REPLACEMENT.KRW_BANK,
        password: "Incorrect-local-password-Aa1",
      },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error.code).toBe("WITHDRAWAL_REAUTH_FAILED");
  }
  const limited = await page.request.post(`${URL}/reauth`, {
    data: { destination: REPLACEMENT.KRW_BANK, password: member.password },
  });
  expect(limited.status()).toBe(429);
  expect((await limited.json()).error.code).toBe(
    "WITHDRAWAL_REAUTH_RATE_LIMITED",
  );
  expect(await proofStates(member.userId)).toEqual(Array(5).fill("DENIED"));
  await noMoney(member.userId);
});

test("configured MFA requires a real TOTP challenge; password alone cannot authorize replacement", async ({
  page,
}) => {
  const member = await createConfirmedMember("reauth-mfa");
  await loginAsMember(page, member);
  await registerDestinationViaProductionApi(page, MATERIAL.KRW_BANK);
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (
    !apiUrl.startsWith("http://127.0.0.1:") &&
    !apiUrl.startsWith("http://localhost:")
  )
    throw new Error("BLOCKED_TARGET_SCOPE");
  const auth = createClient(
    apiUrl,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signedIn = await auth.auth.signInWithPassword({
    email: member.email,
    password: member.password,
  });
  expect(signedIn.error).toBeNull();
  const factor = await auth.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "local-member-reauth",
  });
  expect(factor.error).toBeNull();
  if (!factor.data || factor.data.type !== "totp")
    throw new Error("LOCAL_MFA_ENROLLMENT_FAILED");
  const verified = await auth.auth.mfa.challengeAndVerify({
    factorId: factor.data.id,
    code: await nextTotpCode(factor.data.totp.secret),
  });
  expect(verified.error).toBeNull();
  // Enrolling MFA can revoke earlier Auth sessions. Obtain the current ordinary
  // browser session after enrollment; the proof must bind to that session.
  await loginAsMember(page, member);
  const passwordOnly = await page.request.post(`${URL}/reauth`, {
    data: { destination: REPLACEMENT.KRW_BANK, password: member.password },
  });
  expect(passwordOnly.status()).toBe(403);
  expect((await passwordOnly.json()).error.code).toBe(
    "WITHDRAWAL_REAUTH_MFA_REQUIRED",
  );
  const db = createLocalServiceRoleClient();
  const before = await db
    .from("withdrawal_destination_step_ups")
    .select("auth_session_id")
    .eq("user_id", member.userId)
    .eq("status", "DENIED")
    .single();
  expect(before.error).toBeNull();
  const proof = await reauthenticateDestination(
    page,
    REPLACEMENT.KRW_BANK,
    member.password,
    await nextTotpCode(factor.data.totp.secret),
  );
  const verifiedProof = await db
    .from("withdrawal_destination_step_ups")
    .select("auth_session_id")
    .eq("user_id", member.userId)
    .eq("status", "VERIFIED")
    .single();
  expect(verifiedProof.error).toBeNull();
  expect(
    Boolean(before.data?.auth_session_id) &&
      before.data?.auth_session_id === verifiedProof.data?.auth_session_id,
  ).toBe(true);
  const changed = await page.request.post(URL, {
    data: REPLACEMENT.KRW_BANK,
    headers: { "Withdrawal-Reauth": proof },
  });
  expect(changed.status()).toBe(201);
  expect(await proofStates(member.userId)).toEqual(["DENIED", "CONSUMED"]);
  await page.goto("/wallet/withdraw");
  await expect(
    page.getByRole("heading", { name: "출금하기", exact: true }),
  ).toBeVisible();
  await auth.auth.signOut({ scope: "local" });
  await noMoney(member.userId);
});
