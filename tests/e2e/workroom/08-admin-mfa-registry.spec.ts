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
  await adminLogin(page, user);
  const client = service();
  const registered = await client
    .from("admin_sessions")
    .select("id")
    .eq("user_id", user.userId)
    .is("revoked_at", null);
  expect(registered.error).toBeNull();
  expect(registered.data).toHaveLength(1);
  const revoked = await client.rpc("revoke_all_admin_sessions", {
    p_user_id: user.userId,
    p_actor: user.userId,
    p_reason: "Disposable WORKROOM acceptance revocation",
  });
  expect(revoked.error).toBeNull();
  expect(
    (await adminRequest(page, "GET", "/api/v1/admin/workroom/state")).status(),
  ).toBe(403);
});
