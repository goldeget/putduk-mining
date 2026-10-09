import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import { grantAdminRole } from "./helpers/admin-totp";
import {
  createLocalServiceRoleClient,
  ensureOperatorActor,
} from "./helpers/eligibility";

test("revoking a per-test admin preserves the shared operator and bootstrap history", async () => {
  const shared = await ensureOperatorActor();
  const specific = await createConfirmedMember("operator-isolation");
  expect(specific.userId).not.toBe(shared.userId);
  await grantAdminRole(specific.userId);

  const db = createLocalServiceRoleClient();
  const revokedAt = new Date().toISOString();
  const revoked = await db
    .from("user_roles")
    .update({ revoked_at: revokedAt })
    .eq("user_id", specific.userId)
    .eq("role", "ADMIN")
    .is("revoked_at", null);
  expect(revoked.error).toBeNull();

  const recovered = await ensureOperatorActor();
  expect(recovered.userId).toBe(shared.userId);
  expect(recovered.role).toBe(shared.role);
  const active = await db
    .from("user_roles")
    .select("user_id,role")
    .eq("user_id", shared.userId)
    .eq("role", shared.role)
    .is("revoked_at", null)
    .single();
  expect(active.error).toBeNull();
  expect(active.data).toEqual({
    user_id: shared.userId,
    role: shared.role,
  });

  // Revoked history stays intact, and the real one-time guard stays closed.
  const history = await db
    .from("user_roles")
    .select("revoked_at")
    .eq("user_id", specific.userId)
    .eq("role", "ADMIN")
    .single();
  expect(history.error).toBeNull();
  expect(Date.parse(history.data!.revoked_at)).toBe(Date.parse(revokedAt));
  const repeatedBootstrap = await db.rpc("bootstrap_first_super_admin", {
    p_user_id: specific.userId,
    p_reason: "Local fixture test must not reopen the first-admin bootstrap",
    p_confirmation: "BOOTSTRAP_FIRST_SUPER_ADMIN",
    p_request_id: randomUUID(),
  });
  expect(repeatedBootstrap.error?.message).toContain(
    "FIRST_ADMIN_ALREADY_BOOTSTRAPPED",
  );
});
