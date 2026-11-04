import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { operator, adminLogin, adminCommand, adminState } from "./helpers";
test("real administrator creates and disables an invite with immutable audited reads", async ({
  page,
}) => {
  await adminLogin(page, await operator());
  const reason = `Acceptance ${randomUUID()}`;
  const created = await adminCommand(page, "INVITE_CREATE", {
    label: "Disposable acceptance",
    maxUses: 1,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    reason,
  });
  expect(created.status()).toBe(200);
  const invitation = (await created.json()).data;
  expect(invitation.code).toMatch(/^WR-[A-F0-9]{32}$/);
  const disabled = await adminCommand(page, "INVITE_STATUS", {
    id: invitation.id,
    enabled: false,
    reason,
  });
  expect(disabled.status()).toBe(200);
  const current = await adminState(page);
  expect(
    current.invites.find((row: { id: string }) => row.id === invitation.id)
      .enabled,
  ).toBe(false);
  expect(
    current.audit.some(
      (row: { input: { reason?: string } }) => row.input.reason === reason,
    ),
  ).toBe(true);
});
