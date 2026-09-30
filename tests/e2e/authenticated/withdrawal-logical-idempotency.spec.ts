import { expect, test, type Page, type Route } from "@playwright/test";

import { createLocalServiceRoleClient } from "./helpers/eligibility";
import {
  prepareMemberThroughStart,
  registerFirstKrwDestination,
  requireWithdrawalDataKey,
} from "./helpers/journey";
import { dismissGuidedQuestIfPresent } from "./helpers/member-session";

/**
 * 응답 유실 주입은 이 스펙의 Playwright route 안에서만 한다.
 * 서버에 공개 디버그 경로를 두지 않는다. 프로덕션 번들에는 이 가로채기가 없다.
 * route.fetch 로 홀드 API가 커밋한 뒤, 브라우저에는 연결 끊김만 전달한다.
 */

function trackHydration(page: Page) {
  const hydration: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (
      text.includes("react.dev/link/hydration-mismatch") ||
      text.includes("hydration-mismatch") ||
      text.includes("Hydration failed because") ||
      text.includes("A tree hydrated but some attributes") ||
      /Text content did not match/i.test(text)
    ) {
      hydration.push(text.slice(0, 500));
    }
  });
  return hydration;
}

type CapturedHold = {
  amountKrw: string;
  destinationId: string;
  key: string;
  method: string;
};

function readHold(route: Route): CapturedHold {
  const body = route.request().postDataJSON() as {
    amountKrw?: string;
    destinationId?: string;
    method?: string;
  };
  return {
    amountKrw: body.amountKrw ?? "",
    destinationId: body.destinationId ?? "",
    key: route.request().headers()["idempotency-key"] ?? "",
    method: body.method ?? "",
  };
}

test.beforeAll(() => {
  requireWithdrawalDataKey();
});

test("응답이 유실돼도 같은 출금 요청은 홀드·영수증을 한 번만 만든다", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const hydration = trackHydration(page);
  const { member } = await prepareMemberThroughStart(page, "wd-logical-key");
  await registerFirstKrwDestination(page);
  hydration.length = 0;

  const seen: CapturedHold[] = [];
  let committedStatus = 0;
  let dropResponse = true;

  await page.route("**/api/v1/withdrawals/hold", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    seen.push(readHold(route));
    if (!dropResponse) {
      await route.continue();
      return;
    }
    dropResponse = false;
    const upstream = await route.fetch();
    committedStatus = upstream.status();
    // 서버 응답은 버리고, 브라우저에는 전송 후 단절만 보이게 한다.
    await route.abort("connectionreset");
  });

  await page.goto("/wallet/withdraw");
  await dismissGuidedQuestIfPresent(page);
  await expect(
    page.getByRole("heading", { name: "출금하기", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "최소 금액" }).click();
  await page.getByRole("button", { name: "출금 요청하기" }).click();
  await expect(page.locator("#withdrawal-request-feedback")).toContainText(
    "인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
    { timeout: 60_000 },
  );
  await expect(page.getByText("relation")).toHaveCount(0);
  expect(committedStatus).toBe(201);
  expect(seen).toHaveLength(1);

  // 새로고침 뒤에도 같은 논리 요청 키를 쓰는지 확인한다.
  await page.reload({ waitUntil: "domcontentloaded" });
  await dismissGuidedQuestIfPresent(page);
  await expect(
    page.getByRole("heading", { name: "출금하기", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "최소 금액" }).click();
  await page.getByRole("button", { name: "출금 요청하기" }).click();
  await expect(page.locator("#withdrawal-request-feedback")).toContainText(
    "출금 요청을 접수했어요.",
    { timeout: 60_000 },
  );

  expect(seen).toHaveLength(2);
  expect(seen[1]?.key).toBe(seen[0]?.key);
  expect(seen[1]?.key.length).toBeGreaterThanOrEqual(8);
  expect(seen[1]?.amountKrw).toBe(seen[0]?.amountKrw);
  expect(seen[1]?.destinationId).toBe(seen[0]?.destinationId);
  expect(seen[1]?.method).toBe(seen[0]?.method);
  expect(hydration).toEqual([]);

  const idempotencyKey = seen[0]?.key ?? "";
  const client = createLocalServiceRoleClient();
  const { data: requests, error: requestError } = await client
    .from("withdrawal_requests")
    .select(
      "id, idempotency_key, hold_ledger_transaction_id, welcome_reward_conversion_id, status",
    )
    .eq("user_id", member.userId)
    .is("welcome_reward_conversion_id", null);
  expect(requestError).toBeNull();
  expect(requests).toHaveLength(1);
  expect(requests?.[0]?.idempotency_key).toBe(idempotencyKey);
  expect(requests?.[0]?.status).toBe("HELD");
  expect(requests?.[0]?.hold_ledger_transaction_id).toBeTruthy();

  const requestId = requests?.[0]?.id ?? "";
  const { count: holdCount, error: holdError } = await client
    .from("ledger_transactions")
    .select("id", { count: "exact", head: true })
    .eq("idempotency_key", `${idempotencyKey}:hold`);
  expect(holdError).toBeNull();
  expect(holdCount).toBe(1);

  const { count: outboxCount, error: outboxError } = await client
    .from("outbox_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "WITHDRAWAL_REQUESTED.v1")
    .eq("idempotency_key", `${idempotencyKey}:event`)
    .eq("aggregate_id", requestId);
  expect(outboxError).toBeNull();
  expect(outboxCount).toBe(1);

  const { count: receiptCount, error: receiptError } = await client
    .from("transaction_receipts")
    .select("id", { count: "exact", head: true })
    .eq("source_type", "withdrawal_request")
    .eq("source_id", requestId);
  expect(receiptError).toBeNull();
  expect(receiptCount).toBe(1);
});
