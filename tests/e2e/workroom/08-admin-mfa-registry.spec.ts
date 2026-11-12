import { test, expect } from "@playwright/test";
import { required, sql, adminLogin, adminRequest, service } from "./helpers";
test("real TOTP admin session is registered and live revocation immediately denies access", async ({
  page,
}) => {
  const user = {
    userId: required("WORKROOM_OPERATOR_ID"),
    email: required("WORKROOM_OPERATOR_LOGIN_ID"),
    password: required("WORKROOM_OPERATOR_PASSWORD"),
  };
  expect(user.userId).toMatch(/^[0-9a-f-]{36}$/);
  expect(
    sql(
      `select count(*) from public.user_identity_profiles where user_id='${user.userId}';`,
    ),
  ).toBe("0");
  await page.clock.install();
  await adminLogin(page, user);
  const client = service();
  const registered = await client
    .from("admin_sessions")
    .select("id")
    .eq("user_id", user.userId)
    .is("revoked_at", null);
  expect(registered.error).toBeNull();
  expect(registered.data).toHaveLength(1);
  const registeredSession = registered.data?.[0];
  if (!registeredSession) throw new Error("ADMIN_SESSION_NOT_REGISTERED");
  const appSessionId = registeredSession.id;
  const absoluteDeadline = sql(
    `select absolute_expires_at::text from public.admin_sessions where id='${appSessionId}';`,
  );
  expect(
    Number(
      sql(
        `select extract(epoch from absolute_expires_at-created_at)::int from public.admin_sessions where id='${appSessionId}';`,
      ),
    ),
  ).toBeGreaterThanOrEqual(43200);
  sql(
    `update public.admin_sessions set last_seen_at=statement_timestamp()-interval '40 minutes',idle_expires_at=statement_timestamp()+interval '80 minutes' where id='${appSessionId}';`,
  );
  await page.getByRole("heading").first().click();
  const heartbeat = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/admin/session/heartbeat") &&
      response.request().method() === "POST",
  );
  await page.clock.fastForward(61_000);
  expect((await heartbeat).status()).toBe(200);
  expect(
    Number(
      sql(
        `select extract(epoch from idle_expires_at-statement_timestamp())::int from public.admin_sessions where id='${appSessionId}';`,
      ),
    ),
  ).toBeGreaterThan(7100);
  expect(
    sql(
      `select absolute_expires_at::text from public.admin_sessions where id='${appSessionId}';`,
    ),
  ).toBe(absoluteDeadline);
  const revoked = await client.rpc("revoke_all_admin_sessions", {
    p_user_id: user.userId,
    p_actor: user.userId,
    p_reason: "Disposable WORKROOM acceptance revocation",
  });
  expect(revoked.error).toBeNull();
  expect(
    (await adminRequest(page, "GET", "/api/v1/admin/workroom/state")).status(),
  ).toBe(403);
  expect(
    (
      await adminRequest(page, "POST", "/api/v1/admin/session/heartbeat")
    ).status(),
  ).toBe(403);
});
