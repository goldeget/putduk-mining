import { createECDH } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadJobLocalAllowlist } from "../../scripts/capture-local-supabase-env.mjs";
import {
  approvedLocalPushConfig,
  runApprovedLocalPush,
} from "../../workers/push-runtime.mjs";
function fixtureEnv() {
  const key = createECDH("prime256v1");
  key.generateKeys();
  const target = loadJobLocalAllowlist();
  return {
    APP_ENV: "test",
    PUTDUK_PUSH_SEND_APPROVED: "true",
    SUPABASE_SECRET_KEY: "test-only-secret",
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${target.apiPort}`,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: key.getPublicKey().toString("base64url"),
    VAPID_PRIVATE_KEY: key.getPrivateKey().toString("base64url"),
    VAPID_SUBJECT: "mailto:local-qa@putduk.test",
  };
}
describe("explicit local push runtime gate (network zero)", () => {
  it.each(["", "false", undefined])(
    "requires separate affirmative sending approval %s before claim or transport",
    async (flag) => {
      const rpc = vi.fn();
      const send = vi.fn();
      await expect(
        runApprovedLocalPush({
          env: { ...fixtureEnv(), PUTDUK_PUSH_SEND_APPROVED: flag },
          client: { rpc },
          send,
        }),
      ).rejects.toThrow("PUSH_SEND_APPROVAL_REQUIRED");
      expect(rpc).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("rejects production and project mismatch", () => {
    expect(() =>
      approvedLocalPushConfig({ ...fixtureEnv(), APP_ENV: "production" }),
    ).toThrow("PUSH_SEND_APPROVAL_REQUIRED");
    expect(() =>
      approvedLocalPushConfig({
        ...fixtureEnv(),
        SUPABASE_PROJECT_REF: "osrmyjgmpdspdcwqjwuv",
      }),
    ).toThrow("PUSH_LOCAL_PROJECT_SCOPE_REJECTED");
  });
  it("rejects mismatched VAPID key pairs before leasing", async () => {
    const rpc = vi.fn();
    const send = vi.fn();
    const env = fixtureEnv();
    await expect(
      runApprovedLocalPush({
        env: {
          ...env,
          NEXT_PUBLIC_VAPID_PUBLIC_KEY:
            fixtureEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        },
        client: { rpc },
        send,
      }),
    ).rejects.toThrow("PUSH_SERVER_CONFIG_INVALID");
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("uses the configured fresh local API port and emits no sends for an empty durable queue", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const send = vi.fn();
    const env = fixtureEnv();
    expect(approvedLocalPushConfig(env).url).toBe(env.NEXT_PUBLIC_SUPABASE_URL);
    expect(
      (await runApprovedLocalPush({ env, client: { rpc }, send })).claimed,
    ).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
