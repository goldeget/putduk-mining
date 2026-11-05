import { test, expect } from "@playwright/test";
import { auth, identity, sql } from "./helpers";
test("GoTrue rejects invalid code with atomic auth/profile/workroom rollback", async () => {
  const user = identity();
  const before = sql(
    "select jsonb_build_array((select count(*) from auth.users),(select count(*) from public.user_profiles),(select count(*) from app_private.workroom_accounts),(select count(*) from app_private.workroom_ledger))::text;",
  );
  const result = await auth().auth.signUp({
    email: user.email,
    password: user.password,
    options: {
      data: { ...user.metadata, referralCode: "WR-INVALIDINVITATION12345" },
    },
  });
  expect(result.error).toBeTruthy();
  expect(result.data.session).toBeNull();
  expect(
    sql(`select count(*) from auth.users where email='${user.email}';`),
  ).toBe("0");
  expect(
    sql(
      "select jsonb_build_array((select count(*) from auth.users),(select count(*) from public.user_profiles),(select count(*) from app_private.workroom_accounts),(select count(*) from app_private.workroom_ledger))::text;",
    ),
  ).toBe(before);
});
