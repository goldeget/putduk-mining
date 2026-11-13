import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import {
  auth,
  command,
  login,
  member,
  service,
  sql,
  started,
  state,
} from "./helpers";

/** Disposable native DB only. The committed snapshot is never shortened after
 * START; this waits out a genuine 30-second round with no owner page open.
 * Deployed cron/DO execution is a separate Worker acceptance receipt.
 */
async function startThirtySecondRound(page: Page) {
  const previous = Number(
    sql(
      "select duration from app_private.workroom_config where instrument='usd';",
    ),
  );
  sql(
    "update app_private.workroom_config set duration=30,version=version+1 where instrument='usd';",
  );
  try {
    return await started(page);
  } finally {
    sql(
      `update app_private.workroom_config set duration=${previous},version=version+1 where instrument='usd';`,
    );
  }
}
async function recover(memberId: string, roundId: string) {
  const result = await service().rpc("workroom_app_worker", {
    p_operation: "RECOVER",
    p_input: { memberId, roundId, limit: 1 },
  });
  expect(result.error).toBeNull();
  return result.data;
}
async function completeWithoutBrowser(memberId: string, roundId: string) {
  await expect
    .poll(
      async () => {
        await recover(memberId, roundId);
        return sql(
          `select count(*) from app_private.workroom_app_jobs where round_id='${roundId}' and settled_at is not null;`,
        );
      },
      { timeout: 45_000, intervals: [500, 1_000, 1_000] },
    )
    .toBe("1");
}
async function inbox(page: Page) {
  const result = await page.request.get(
    "/api/v1/workroom-app?operation=NOTIFICATIONS_READ&limit=50",
  );
  expect(result.status()).toBe(200);
  return (await result.json()).data.items as {
    id: string;
    type: string;
    title: string;
    route: string;
  }[];
}

test("service scheduler settles a genuine 30-second round with owner browser closed and duplicate recovery/SYNC emits one completion", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const owner = await member();
  await login(page, owner);
  const round = await startThirtySecondRound(page);
  const active = round.state.active!;
  expect(active.duration).toBe(30);
  const context = page.context();
  await page.close();
  await completeWithoutBrowser(owner.userId, active.id);
  expect((await recover(owner.userId, active.id)).settled).toBe(0);
  const returned = await context.newPage();
  await login(returned, owner);
  await Promise.all([
    command(returned, "SYNC"),
    recover(owner.userId, active.id),
    command(returned, "SYNC"),
  ]);
  expect(
    sql(
      `select count(*) from app_private.workroom_ledger where kind='SETTLEMENT' and round_id='${active.id}';`,
    ),
  ).toBe("1");
  expect(
    sql(
      `select count(*) from app_private.workroom_app_events where kind='ROUND_COMPLETED' and resource_id='${active.id}' and member_id='${owner.userId}';`,
    ),
  ).toBe("1");
  expect(
    sql(
      `select count(*) from app_private.workroom_app_inbox i join app_private.workroom_app_events e on e.id=i.event_id where e.kind='ROUND_COMPLETED' and e.resource_id='${active.id}' and i.recipient='${owner.userId}' and i.audience='MEMBER';`,
    ),
  ).toBe("1");
  const current = await state(returned);
  expect(current.active).toBeNull();
  const completed = current.history.find((row) => row.id === active.id)!;
  expect(current.member?.balance).toBe(100_000 + completed.profit!);
  const notifications = (await inbox(returned)).filter(
    (item) =>
      item.type === "ROUND_COMPLETED" &&
      item.route === `/workroom/history?round=${active.id}`,
  );
  expect(notifications).toHaveLength(1);
  await returned.goto("/notifications");
  await expect(
    returned
      .getByRole("main")
      .getByText(notifications[0]!.title, { exact: true })
      .first(),
  ).toBeVisible();
  await returned.goto(`/workroom/history?round=${active.id}`);
  await expect(
    returned.getByRole("heading", { name: "참여 결과", exact: true }),
  ).toBeVisible();
  await expect(
    returned.getByRole("heading", { name: "달러환율", exact: true }),
  ).toBeVisible();
});

test("another real member cannot run scheduler or read/mark the owner's background completion", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const owner = await member();
  await login(page, owner);
  const round = await startThirtySecondRound(page);
  const active = round.state.active!;
  const ownerContext = page.context();
  await page.close();
  const otherUser = await member();
  const otherContext = await browser.newContext({ baseURL: baseURL! });
  try {
    const other = await otherContext.newPage();
    await login(other, otherUser);
    const signed = auth();
    expect(
      (
        await signed.auth.signInWithPassword({
          email: otherUser.email,
          password: otherUser.password,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await signed.rpc("workroom_app_worker", {
          p_operation: "RECOVER",
          p_input: { memberId: owner.userId, roundId: active.id },
        })
      ).error,
    ).toBeTruthy();
    await completeWithoutBrowser(owner.userId, active.id);
    const returned = await ownerContext.newPage();
    await login(returned, owner);
    const notification = (await inbox(returned)).find(
      (item) =>
        item.type === "ROUND_COMPLETED" &&
        item.route === `/workroom/history?round=${active.id}`,
    )!;
    expect(notification).toBeTruthy();
    expect(
      (await inbox(other)).some((item) => item.id === notification.id),
    ).toBe(false);
    const denied = await other.request.post("/api/v1/workroom-app", {
      headers: {
        Origin: new URL(other.url()).origin,
        "Idempotency-Key": randomUUID(),
      },
      data: { operation: "NOTIFICATION_READ", input: { id: notification.id } },
    });
    expect([403, 404]).toContain(denied.status());
    expect((await command(other, "FINISH", { id: active.id })).status()).toBe(
      404,
    );
    expect((await state(other)).member?.balance).toBe(100_000);
    expect(
      sql(
        `select read_at is null from app_private.workroom_app_inbox where id='${notification.id}' and recipient='${owner.userId}';`,
      ),
    ).toBe("t");
  } finally {
    await otherContext.close();
  }
});
