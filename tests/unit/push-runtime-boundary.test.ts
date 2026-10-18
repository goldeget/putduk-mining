import { createECDH } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadJobLocalAllowlist } from "../../scripts/capture-local-supabase-env.mjs";
import {
  approvedLocalPushConfig,
  runApprovedLocalPush,
} from "../../workers/push-runtime.mjs";
function fixtureEnv() {
  const target = loadJobLocalAllowlist();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const key = createECDH("prime256v1");
    key.generateKeys();
    const publicKey = key.getPublicKey(null, "uncompressed");
    const privateKey = key.getPrivateKey();
    const check = createECDH("prime256v1");
    check.setPrivateKey(privateKey);
    if (!check.getPublicKey(null, "uncompressed").equals(publicKey)) continue;
    return {
      APP_ENV: "test",
      PUTDUK_PUSH_SEND_APPROVED: "true",
      SUPABASE_SECRET_KEY: "test-only-secret",
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${target.apiPort}`,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: publicKey.toString("base64url"),
      VAPID_PRIVATE_KEY: privateKey.toString("base64url"),
      VAPID_SUBJECT: "mailto:local-qa@putduk.test",
    };
  }
  throw new Error("PUSH_TEST_KEY_UNAVAILABLE");
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
      (
        await runApprovedLocalPush({
          env,
          client: { rpc, from: safeModeTable([]) },
          send,
        })
      ).claimed,
    ).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("claims nothing and sends nothing while GLOBAL or NOTIFICATION safe mode is active", async () => {
    for (const component of ["GLOBAL", "NOTIFICATION"]) {
      const rpc = vi.fn();
      const send = vi.fn();
      const summary = await runApprovedLocalPush({
        env: fixtureEnv(),
        client: {
          rpc,
          from: safeModeTable([
            {
              component,
              is_paused: true,
              starts_at: "2026-01-01T00:00:00.000Z",
            },
          ]),
        },
        send,
      });
      expect(summary).toMatchObject({ claimed: 0, safeModePaused: true });
      expect(rpc).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("does not let an unrelated component or a future start pause push", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const summary = await runApprovedLocalPush({
      env: fixtureEnv(),
      client: {
        rpc,
        from: safeModeTable([
          { component: "AI", is_paused: true, starts_at: "2026-01-01T00:00:00Z" },
          {
            component: "NOTIFICATION",
            is_paused: true,
            starts_at: "2999-01-01T00:00:00Z",
          },
        ]),
      },
      send: vi.fn(),
    });
    expect(summary.claimed).toBe(0);
    expect(summary.safeModePaused).toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed when safe mode cannot be read", async () => {
    const rpc = vi.fn();
    const send = vi.fn();
    await expect(
      runApprovedLocalPush({
        env: fixtureEnv(),
        client: { rpc },
        send,
      }),
    ).rejects.toThrow("PUSH_SAFE_MODE_UNKNOWN");
    await expect(
      runApprovedLocalPush({
        env: fixtureEnv(),
        client: {
          rpc,
          from: () => ({
            select: () => ({
              in: async () => ({ data: null, error: { message: "boom" } }),
            }),
          }),
        },
        send,
      }),
    ).rejects.toThrow("PUSH_SAFE_MODE_UNKNOWN");
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

function safeModeTable(rows: unknown[]) {
  return () => ({
    select: () => ({
      in: async (_column: string, values: readonly string[]) => ({
        data: (rows as { component: string }[]).filter((row) =>
          values.includes(row.component),
        ),
        error: null,
      }),
    }),
  });
}
