import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import { createLocalServiceRoleClient } from "./helpers/eligibility";
import {
  prepareMemberThroughStart,
  registerFirstKrwDestination,
  requireWithdrawalDataKey,
} from "./helpers/journey";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";
import { execLocalAdminSql } from "./helpers/local-db";

const METHODS = ["KRW_BANK", "USDT_ADDRESS"] as const;
type Method = (typeof METHODS)[number];
const STORAGE = "putduk.withdrawal.logical-request.v2:";
const SAFE_STORAGE_COPY = "출금 요청을 안전하게 저장하지 못했어요.";
const MATERIAL = {
  KRW_BANK: {
    method: "KRW_BANK",
    bankCode: "KB",
    accountHolder: "퍼뜩테스트",
    accountNumber: "110123456789",
  },
  USDT_ADDRESS: {
    method: "USDT_ADDRESS",
    network: "TRC20",
    address: "TXYZaBcDeFgHiJkLmNoPqRsTuVwXyZ1234",
  },
};

async function reopenUnavailableRead(page: Page) {
  // Exercise the real recovery affordance once; never bypass form or money assertions.
  const form = page.locator("#withdrawal-amount");
  const unavailable = page.getByRole("heading", {
    name: "출금 정보를 불러오지 못했어요",
    exact: true,
  });
  await expect(form.or(unavailable).first()).toBeVisible({ timeout: 30_000 });
  if (await unavailable.isVisible()) {
    test.info().annotations.push({
      type: "read-recovery",
      description:
        "Used the production reopen link after an unavailable SSR read.",
    });
    await page
      .getByRole("link", { name: "다시 열기", exact: true })
      .first()
      .click();
    await dismissGuidedQuestIfPresent(page);
  }
  await expect(page.locator("#withdrawal-amount")).toBeVisible({
    timeout: 30_000,
  });
}
async function reloadForRecovery(page: Page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await dismissGuidedQuestIfPresent(page);
  await reopenUnavailableRead(page);
}
async function open(page: Page) {
  await page.goto("/wallet/withdraw");
  await dismissGuidedQuestIfPresent(page);
  await expect(
    page.getByRole("heading", { name: "출금하기", level: 1 }),
  ).toBeVisible();
  await reopenUnavailableRead(page);
}
async function fill(page: Page, method: Method) {
  if (method === "USDT_ADDRESS")
    await page
      .locator('input[name="withdrawalMethod"][value="USDT_ADDRESS"]')
      .check();
  await page.locator("#withdrawal-amount").fill("1000");
  if (method === "KRW_BANK") {
    await page.locator('select[name="bankCode"]').selectOption("KB");
    await page
      .locator('input[name="accountHolder"]')
      .fill(MATERIAL.KRW_BANK.accountHolder);
    await page
      .locator('input[name="accountNumber"]')
      .fill(MATERIAL.KRW_BANK.accountNumber);
  } else {
    await page.locator('select[name="network"]').selectOption("TRC20");
    await page
      .locator('input[name="address"]')
      .fill(MATERIAL.USDT_ADDRESS.address);
  }
}
async function submit(page: Page) {
  await page
    .getByRole("button", { name: "출금 요청하기", exact: true })
    .click();
}
async function success(page: Page) {
  await expect(page.locator("#withdrawal-request-feedback")).toContainText(
    "출금 요청을 접수했어요.",
    { timeout: 60_000 },
  );
}
function hold(route: Route) {
  return {
    key: route.request().headers()["idempotency-key"],
    ...route.request().postDataJSON(),
  } as {
    key: string;
    method: string;
    amountKrw: string;
    destinationId: string;
  };
}
async function effects(ownerId: string, key: string) {
  const db = createLocalServiceRoleClient();
  const { data: requests, error } = await db
    .from("withdrawal_requests")
    .select(
      "id,user_id,idempotency_key,hold_ledger_transaction_id,withdrawal_destination_id,status",
    )
    .eq("user_id", ownerId)
    .eq("idempotency_key", key);
  expect(error).toBeNull();
  const request = requests?.[0];
  const { count: holds, error: he } = await db
    .from("ledger_transactions")
    .select("id", { count: "exact", head: true })
    .eq(
      "id",
      request?.hold_ledger_transaction_id ??
        "00000000-0000-4000-8000-000000000000",
    )
    .eq("idempotency_key", `${key}:hold`);
  const { count: outbox, error: oe } = await db
    .from("outbox_events")
    .select("id", { count: "exact", head: true })
    .eq("actor_user_id", ownerId)
    .eq("aggregate_type", "withdrawal_request")
    .eq("aggregate_id", request?.id ?? "00000000-0000-4000-8000-000000000000")
    .eq("idempotency_key", `${key}:event`)
    .eq("event_type", "WITHDRAWAL_REQUESTED.v1");
  const { count: receipts, error: re } = await db
    .from("transaction_receipts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ownerId)
    .eq("source_type", "withdrawal_request")
    .eq("source_id", request?.id ?? "00000000-0000-4000-8000-000000000000");
  expect([he, oe, re]).toEqual([null, null, null]);
  if (request) {
    expect(request.hold_ledger_transaction_id).toBeTruthy();
    expect(request.status).toBe("HELD");
  }
  return {
    ownerId,
    key,
    requestId: request?.id ?? null,
    destinationId: request?.withdrawal_destination_id ?? null,
    request: requests?.length ?? 0,
    hold: holds ?? 0,
    outbox: outbox ?? 0,
    receipt: receipts ?? 0,
  };
}
async function destination(ownerId: string, id: string) {
  const db = createLocalServiceRoleClient();
  const { data, error } = await db
    .from("withdrawal_destinations")
    .select(
      "id,user_id,destination_type,protection_until,replaced_at,value_fingerprint",
    )
    .eq("user_id", ownerId)
    .eq("id", id)
    .single();
  expect(error).toBeNull();
  const { count, error: historyError } = await db
    .from("withdrawal_destination_history")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ownerId)
    .eq("destination_id", id);
  expect(historyError).toBeNull();
  const { count: destinationCount, error: countError } = await db
    .from("withdrawal_destinations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ownerId)
    .eq("destination_type", data!.destination_type);
  expect(countError).toBeNull();
  expect(destinationCount).toBe(1);
  return { ...data!, destinationCount, historyCount: count };
}
async function evidence(page: Page, name: string, data: unknown) {
  const directory = path.join("test-results", "withdrawal-p1");
  mkdirSync(directory, { recursive: true });
  const suffix = test.info().project.name;
  const file = path.join(directory, `${name}-${suffix}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  await test
    .info()
    .attach(name, { path: file, contentType: "application/json" });
  const shot = path.join(directory, `${name}-${suffix}.png`);
  await page.screenshot({
    path: shot,
    fullPage: true,
    animations: "disabled",
    mask: [
      page.locator('input[name="accountHolder"]'),
      page.locator('input[name="accountNumber"]'),
      page.locator('input[name="address"]'),
    ],
  });
  await test
    .info()
    .attach(`${name}-browser`, { path: shot, contentType: "image/png" });
}

test.beforeAll(() => {
  requireWithdrawalDataKey();
});
for (const method of METHODS) {
  test(`${method}: new destination, committed hold response loss, reload and legitimate later withdrawal`, async ({
    page,
  }) => {
    const { member } = await prepareMemberThroughStart(
      page,
      `p1-hold-${method}`,
    );
    const seen: ReturnType<typeof hold>[] = [];
    let registered: {
      key: string;
      destinationId: string;
      destinationIdentity: string;
    } | null = null;
    let drop = true;
    await page.route("**/api/v1/withdrawals/destinations", async (route) => {
      const upstream = await route.fetch();
      const payload = await upstream.json();
      expect(upstream.status()).toBe(201);
      registered = {
        key: route.request().headers()["idempotency-key"]!,
        destinationId: payload.data.destinationId,
        destinationIdentity: payload.data.destinationIdentity,
      };
      await route.fulfill({ response: upstream });
    });
    await page.route("**/api/v1/withdrawals/hold", async (route) => {
      seen.push(hold(route));
      const upstream = await route.fetch();
      expect(upstream.status()).toBe(201);
      if (drop) {
        drop = false;
        await route.abort("connectionreset");
      } else await route.fulfill({ response: upstream });
    });
    await open(page);
    await fill(page, method);
    await submit(page);
    await expect(page.locator("#withdrawal-request-feedback")).toContainText(
      "인터넷 연결",
      { timeout: 60_000 },
    );
    expect(seen).toHaveLength(1);
    const original = seen[0]!;
    expect(registered!.key).toBe(original.key);
    const before = await destination(member.userId, original.destinationId);
    expect(before.value_fingerprint).toBe(registered!.destinationIdentity);
    await reloadForRecovery(page);
    await expect(page.locator("#withdrawal-amount")).toHaveValue("1000");
    await expect(
      page.locator(`input[name="withdrawalMethod"][value="${method}"]`),
    ).toBeChecked();
    await expect(
      page.getByRole("button", { name: "최소 금액" }),
    ).toBeDisabled();
    await submit(page);
    await success(page);
    expect(seen[1]).toEqual(original);
    const after = await destination(member.userId, original.destinationId);
    expect(after).toEqual(before);
    expect(after.historyCount).toBe(1);
    const one = await effects(member.userId, original.key);
    expect([one.request, one.hold, one.outbox, one.receipt]).toEqual([
      1, 1, 1, 1,
    ]);
    await evidence(page, `hold-loss-${method}`, {
      first: original,
      retry: seen[1],
      before,
      after,
      effects: one,
      observedBeforeCleanup: true,
    });
    // No permanent semantic key: a new explicit request after acknowledgement is legitimate.
    await page.locator("#withdrawal-amount").fill("1000");
    await submit(page);
    await success(page);
    expect(seen).toHaveLength(3);
    expect(seen[2]!.key).not.toBe(original.key);
    const later = await effects(member.userId, seen[2]!.key);
    expect([later.request, later.hold, later.outbox, later.receipt]).toEqual([
      1, 1, 1, 1,
    ]);
  });

  test(`${method}: registration commits then response is lost before any hold`, async ({
    page,
  }) => {
    const { member } = await prepareMemberThroughStart(
      page,
      `p1-register-${method}`,
    );
    let registered: { key: string; destinationId: string } | null = null;
    let holdCount = 0;
    await page.route("**/api/v1/withdrawals/destinations", async (route) => {
      const upstream = await route.fetch();
      expect(upstream.status()).toBe(201);
      const payload = await upstream.json();
      registered = {
        key: route.request().headers()["idempotency-key"]!,
        destinationId: payload.data.destinationId,
      };
      await route.abort("connectionreset");
    });
    await page.route("**/api/v1/withdrawals/hold", async (route) => {
      holdCount++;
      await route.continue();
    });
    await open(page);
    await fill(page, method);
    await submit(page);
    await expect(page.locator("#withdrawal-request-feedback")).toContainText(
      "인터넷 연결",
      { timeout: 60_000 },
    );
    expect(holdCount).toBe(0);
    const zero = await effects(member.userId, registered!.key);
    expect([zero.request, zero.hold, zero.outbox, zero.receipt]).toEqual([
      0, 0, 0, 0,
    ]);
    const before = await destination(member.userId, registered!.destinationId);
    await reloadForRecovery(page);
    await expect(page.locator("#withdrawal-amount")).toHaveValue("1000");
    await submit(page);
    await success(page);
    expect(holdCount).toBe(1);
    // Exercise the registration RPC's explicit replay boundary too.
    const replay = await page.request.post("/api/v1/withdrawals/destinations", {
      headers: { "Idempotency-Key": registered!.key },
      data: MATERIAL[method],
    });
    expect(replay.status()).toBe(201);
    expect((await replay.json()).data.destinationId).toBe(
      registered!.destinationId,
    );
    const after = await destination(member.userId, registered!.destinationId);
    expect(after).toEqual(before);
    const one = await effects(member.userId, registered!.key);
    expect([one.request, one.hold, one.outbox, one.receipt]).toEqual([
      1, 1, 1, 1,
    ]);
    await evidence(page, `registration-loss-${method}`, {
      registered,
      beforeHold: zero,
      before,
      after,
      effects: one,
      observedBeforeCleanup: true,
    });
  });

  for (const fault of ["write-throws", "read-null"] as const) {
    test(`${method}: storage ${fault} blocks destination and money mutations`, async ({
      page,
    }) => {
      const { member } = await prepareMemberThroughStart(
        page,
        `p1-storage-${method}-${fault}`,
      );
      await open(page);
      await fill(page, method);
      await expect(
        page.getByRole("button", { name: "출금 요청하기", exact: true }),
      ).toBeEnabled();
      let destinationCalls = 0;
      let holdCalls = 0;
      let prepareCalls = 0;
      page.on("request", (request) => {
        if (request.method() !== "POST") return;
        if (request.url().endsWith("/withdrawals/destinations"))
          destinationCalls++;
        if (request.url().endsWith("/withdrawals/hold")) holdCalls++;
        if (request.url().endsWith("/withdrawals/intents")) prepareCalls++;
      });
      await page.evaluate(
        ({ prefix, fault }) => {
          const get = Storage.prototype.getItem;
          const set = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key.startsWith(prefix) && fault === "write-throws")
              throw new DOMException("quota", "QuotaExceededError");
            return set.call(this, key, value);
          };
          Storage.prototype.getItem = function (key) {
            return key.startsWith(prefix) && fault === "read-null"
              ? null
              : get.call(this, key);
          };
        },
        { prefix: STORAGE, fault },
      );
      await submit(page);
      await expect(page.locator("#withdrawal-request-feedback")).toContainText(
        SAFE_STORAGE_COPY,
      );
      expect([destinationCalls, holdCalls, prepareCalls]).toEqual([0, 0, 0]);
      const db = createLocalServiceRoleClient();
      const { count: destinations } = await db
        .from("withdrawal_destinations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", member.userId);
      const { count: requests } = await db
        .from("withdrawal_requests")
        .select("id", { count: "exact", head: true })
        .eq("user_id", member.userId);
      const { count: intents } = await db
        .from("withdrawal_logical_requests")
        .select("idempotency_key", { count: "exact", head: true })
        .eq("user_id", member.userId);
      const money = JSON.parse(
        execLocalAdminSql(
          `select json_build_object(
        'holds',(select count(*) from public.ledger_transactions where category='WITHDRAWAL' and metadata->>'phase'='HOLD' and member_user_id=:'owner'::uuid),
        'outbox',(select count(*) from public.outbox_events where actor_user_id=:'owner'::uuid and event_type='WITHDRAWAL_REQUESTED.v1'),
        'receipts',(select count(*) from public.transaction_receipts where user_id=:'owner'::uuid and source_type='withdrawal_request'))`,
          { owner: member.userId },
        ),
      );
      expect([
        destinations,
        requests,
        intents,
        money.holds,
        money.outbox,
        money.receipts,
      ]).toEqual([0, 0, 0, 0, 0, 0]);
      await evidence(page, `storage-${method}-${fault}`, {
        ownerId: member.userId,
        fault,
        destinationCalls,
        holdCalls,
        prepareCalls,
        destinations,
        requests,
        intents,
        ...money,
        observedBeforeCleanup: true,
      });
    });
  }
}

test("expired uncommitted intent stays blocked until explicit serialized cancellation", async ({
  page,
}) => {
  const { member } = await prepareMemberThroughStart(
    page,
    "p1-expired-uncommitted",
  );
  const { data: policy, error } = await createLocalServiceRoleClient()
    .from("withdrawal_policies")
    .select("id,version")
    .eq("destination_type", "KRW_BANK")
    .eq("is_enabled", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  expect(error).toBeNull();
  const input = {
    method: "KRW_BANK",
    amountKrw: "1000",
    policyId: policy!.id,
    policyVersion: policy!.version,
    destinationId: null,
    destination: MATERIAL.KRW_BANK,
  };
  const prepared = await page.request.post("/api/v1/withdrawals/intents", {
    data: input,
  });
  expect(prepared.status()).toBe(201);
  const record = (await prepared.json()).data.record;
  execLocalAdminSql(
    "update public.withdrawal_logical_requests set created_at=statement_timestamp()-interval '2 days', expires_at=statement_timestamp()-interval '1 day' where user_id=:'owner'::uuid and idempotency_key=:'key'",
    { owner: member.userId, key: record.key },
  );
  await open(page);
  await expect(page.locator("#withdrawal-amount")).toHaveValue("1000");
  let mutations = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/withdrawals\/(destinations|hold)$/.test(request.url())
    )
      mutations++;
  });
  await submit(page);
  await expect(page.locator("#withdrawal-request-feedback")).toContainText(
    "이전 출금 요청을 먼저 확인해 주세요.",
  );
  expect(mutations).toBe(0);
  const zero = await effects(member.userId, record.key);
  expect([zero.request, zero.hold, zero.outbox, zero.receipt]).toEqual([
    0, 0, 0, 0,
  ]);
  const retained = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    `${STORAGE}${member.userId}`,
  );
  expect(retained.key).toBe(record.key);
  await evidence(page, "expired-uncommitted", {
    key: record.key,
    effects: zero,
    mutations,
    observedBeforeCleanup: true,
  });
  await page
    .getByRole("button", { name: "입력 다시하기", exact: true })
    .click();
  await expect(page.locator("#withdrawal-amount")).toHaveValue("");
  const resolved = await page.request.get("/api/v1/withdrawals/intents", {
    headers: { "Idempotency-Key": record.key },
  });
  expect((await resolved.json()).data.record.state).toBe("CANCELLED");
  const next = await page.request.post("/api/v1/withdrawals/intents", {
    data: input,
  });
  expect(next.status()).toBe(201);
  expect((await next.json()).data.record.key).not.toBe(record.key);
});

test("corrupt state without a server recovery record fails closed", async ({
  page,
}) => {
  const { member } = await prepareMemberThroughStart(
    page,
    "p1-corrupt-no-server",
  );
  await page.evaluate(
    (key) => localStorage.setItem(key, "{corrupt"),
    `${STORAGE}${member.userId}`,
  );
  let mutations = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/withdrawals\/(intents|destinations|hold)$/.test(request.url())
    )
      mutations++;
  });
  await open(page);
  await expect(page.locator("#withdrawal-request-feedback")).toContainText(
    "이전 출금 요청을 먼저 확인해 주세요.",
  );
  await fill(page, "KRW_BANK");
  await expect(
    page.getByRole("button", { name: "출금 요청하기", exact: true }),
  ).toBeDisabled();
  expect(mutations).toBe(0);
  const zero = await effects(member.userId, "p1-corrupt-no-server");
  expect([zero.request, zero.hold, zero.outbox, zero.receipt]).toEqual([
    0, 0, 0, 0,
  ]);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `${STORAGE}${member.userId}`,
    ),
  ).toBe("{corrupt");
  await evidence(page, "corrupt-no-server", {
    ownerId: member.userId,
    mutations,
    effects: zero,
    observedBeforeCleanup: true,
  });
});

test("another tab recovers the same unresolved key after committed response loss", async ({
  page,
  context,
}) => {
  const { member } = await prepareMemberThroughStart(page, "p1-other-tab");
  await registerFirstKrwDestination(page);
  const seen: ReturnType<typeof hold>[] = [];
  await page.route("**/api/v1/withdrawals/hold", async (route) => {
    seen.push(hold(route));
    const upstream = await route.fetch();
    expect(upstream.status()).toBe(201);
    await route.abort("connectionreset");
  });
  await open(page);
  await page.locator("#withdrawal-amount").fill("1000");
  await submit(page);
  await expect(page.locator("#withdrawal-request-feedback")).toContainText(
    "인터넷 연결",
  );
  const closedTab = await context.newPage();
  await open(closedTab);
  await expect(closedTab.locator("#withdrawal-amount")).toHaveValue("1000");
  await closedTab.close();
  // Closing a recovered tab must not cancel or rotate the durable pending key.
  const other = await context.newPage();
  await open(other);
  await other.route("**/api/v1/withdrawals/hold", async (route) => {
    seen.push(hold(route));
    await route.continue();
  });
  await expect(other.locator("#withdrawal-amount")).toHaveValue("1000");
  await submit(other);
  await success(other);
  expect(seen[1]).toEqual(seen[0]);
  // The first tab is still showing its old unresolved UI. Shared storage was
  // cleared by the other tab; its retry must resolve old success, not mint money.
  await submit(page);
  await success(page);
  expect(seen).toHaveLength(2);
  const one = await effects(member.userId, seen[0]!.key);
  expect([one.request, one.hold, one.outbox, one.receipt]).toEqual([
    1, 1, 1, 1,
  ]);
  await evidence(other, "multi-tab", {
    requests: seen,
    tabCloseReopen: "pending key preserved after closing a recovered tab",
    staleTabAfterAcknowledgement: "old success; zero additional hold calls",
    effects: one,
    observedBeforeCleanup: true,
  });
});

test("account A pending state is not adopted by account B on the same browser", async ({
  page,
}) => {
  const { member: a } = await prepareMemberThroughStart(page, "p1-owner-a");
  await registerFirstKrwDestination(page);
  let captured: ReturnType<typeof hold> | null = null;
  await page.route("**/api/v1/withdrawals/hold", async (route) => {
    captured = hold(route);
    const upstream = await route.fetch();
    expect(upstream.status()).toBe(201);
    await route.abort("connectionreset");
  });
  await open(page);
  await page.locator("#withdrawal-amount").fill("1000");
  await submit(page);
  await expect(page.locator("#withdrawal-request-feedback")).toContainText(
    "인터넷 연결",
  );
  const aRaw = await page.evaluate(
    (key) => localStorage.getItem(key),
    `${STORAGE}${a.userId}`,
  );
  expect(aRaw).toContain(captured!.key);
  await page.unroute("**/api/v1/withdrawals/hold");
  await page.goto("/menu/account");
  await page
    .getByRole("button", { name: "이 기기에서 로그아웃", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?logout=local$/);
  const b = await createConfirmedMember("p1-owner-b");
  await loginAsMember(page, b, "/home");
  const recover = await page.request.get("/api/v1/withdrawals/intents");
  expect(recover.status()).toBe(200);
  expect((await recover.json()).data.record).toBeNull();
  const denied = await page.request.post("/api/v1/withdrawals/hold", {
    headers: { "Idempotency-Key": captured!.key },
    data: {
      method: captured!.method,
      amountKrw: captured!.amountKrw,
      destinationId: captured!.destinationId,
    },
  });
  expect(denied.status()).toBe(409);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `${STORAGE}${b.userId}`,
    ),
  ).toBeNull();
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `${STORAGE}${a.userId}`,
    ),
  ).toBe(aRaw);
  const one = await effects(a.userId, captured!.key);
  expect([one.request, one.hold, one.outbox, one.receipt]).toEqual([
    1, 1, 1, 1,
  ]);
  await evidence(page, "owner-switch", {
    ownerA: a.userId,
    ownerB: b.userId,
    deniedStatus: denied.status(),
    effects: one,
    observedBeforeCleanup: true,
  });
});

test("corrupt browser state plus expired committed server record recovers without a new key", async ({
  page,
}) => {
  const { member } = await prepareMemberThroughStart(page, "p1-corrupt-ttl");
  await registerFirstKrwDestination(page);
  const seen: ReturnType<typeof hold>[] = [];
  let drop = true;
  await page.route("**/api/v1/withdrawals/hold", async (route) => {
    seen.push(hold(route));
    const upstream = await route.fetch();
    expect(upstream.status()).toBe(201);
    if (drop) {
      drop = false;
      await route.abort("connectionreset");
    } else await route.fulfill({ response: upstream });
  });
  await open(page);
  await page.locator("#withdrawal-amount").fill("1000");
  await submit(page);
  await expect(page.locator("#withdrawal-request-feedback")).toContainText(
    "인터넷 연결",
  );
  execLocalAdminSql(
    "update public.withdrawal_logical_requests set created_at=statement_timestamp()-interval '2 days', expires_at=statement_timestamp()-interval '1 day' where user_id=:'owner'::uuid and idempotency_key=:'key'",
    { owner: member.userId, key: seen[0]!.key },
  );
  await page.evaluate(
    (key) => localStorage.setItem(key, "{corrupt"),
    `${STORAGE}${member.userId}`,
  );
  await reloadForRecovery(page);
  await expect(page.locator("#withdrawal-amount")).toHaveValue("1000");
  await submit(page);
  await success(page);
  expect(seen[1]).toEqual(seen[0]);
  const one = await effects(member.userId, seen[0]!.key);
  expect([one.request, one.hold, one.outbox, one.receipt]).toEqual([
    1, 1, 1, 1,
  ]);
  await evidence(page, "corrupt-ttl", {
    requests: seen,
    effects: one,
    observedBeforeCleanup: true,
  });
});
