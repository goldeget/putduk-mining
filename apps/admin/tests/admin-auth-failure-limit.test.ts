import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ADMIN_AUTH_FAILURE_MAX,
  decideFailureLimit,
} from "@/lib/auth/failure-limit-policy";
import {
  createSecurityEventFailureStore,
  readAdminAuthFailureBudget,
  recordAdminAuthFailure,
  type FailureLimitStore,
} from "@/lib/auth/failure-limit";
import { adminAuthFailureBucket } from "../../../lib/security/rate-limit-bucket";

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path: string) {
  return readFileSync(join(adminRoot, path), "utf8");
}

describe("admin auth failure limit", () => {
  it("allows five failures and limits the next one inside the window", () => {
    expect(decideFailureLimit(ADMIN_AUTH_FAILURE_MAX - 1)).toBe("ALLOW");
    expect(decideFailureLimit(ADMIN_AUTH_FAILURE_MAX)).toBe("RATE_LIMITED");
    expect(decideFailureLimit(Number.NaN)).toBe("RATE_LIMITED");
  });

  it("counts password failures in security_events, not a memory map", async () => {
    const inserted: Record<string, unknown>[] = [];
    let failures = 0;
    const events = createSecurityEventFailureStore({
      rpc: async () => ({ data: null, error: null }),
      from(table) {
        expect(table).toBe("security_events");
        const chain = {
          select() {
            return chain;
          },
          eq() {
            return chain;
          },
          contains() {
            return chain;
          },
          gte() {
            return chain;
          },
          limit: async () => ({ data: [], error: null }),
          insert: async (row: Record<string, unknown>) => {
            inserted.push(row);
            failures += 1;
            return { error: null };
          },
          then(
            resolve: (value: { count: number; error: null }) => unknown,
            reject?: (reason: unknown) => unknown,
          ) {
            return Promise.resolve({ count: failures, error: null }).then(
              resolve,
              reject,
            );
          },
        };
        return chain;
      },
    } as Parameters<typeof createSecurityEventFailureStore>[0]);

    const subject = "operator@example.com";
    for (let attempt = 0; attempt < ADMIN_AUTH_FAILURE_MAX; attempt += 1) {
      expect(
        await readAdminAuthFailureBudget("PASSWORD", subject, events),
      ).toBe("ALLOW");
      expect(await recordAdminAuthFailure("PASSWORD", subject, events)).toBe(
        true,
      );
    }
    expect(await readAdminAuthFailureBudget("PASSWORD", subject, events)).toBe(
      "RATE_LIMITED",
    );

    const row = inserted[0];
    expect(row?.user_id).toBeNull();
    expect(row?.user_agent).toBeNull();
    expect(row?.trusted_client_ip).toBeNull();
    expect(row?.event_type).toBe("ADMIN_AUTH_FAILURE");
    const context = row?.device_context as { bucket: string; scope: string };
    expect(context.scope).toBe("PASSWORD");
    expect(context.bucket).toBe(adminAuthFailureBucket("PASSWORD", subject));
    expect(context.bucket).not.toContain(subject);
    expect(JSON.stringify(row)).not.toMatch(/token|stepUp/i);
  });

  it("fails closed when the shared store cannot be read", async () => {
    const events: FailureLimitStore = {
      admitAttempt: async () => ({ allowed: false, code: "UNAVAILABLE" }),
      finishAttempt: async () => false,
      countFailures: async () => null,
      insertFailure: async () => false,
      insertProof: async () => false,
      hasProof: async () => null,
    };
    expect(await readAdminAuthFailureBudget("TOTP", "user-1", events)).toBe(
      "UNAVAILABLE",
    );
  });

  it("wires login and TOTP through the server failure path", () => {
    const login = read("app/actions.ts");
    const rateLimit = read("lib/auth/rate-limit.ts");
    const gate = read("components/mfa-gate.tsx");
    const stepUp = read("components/step-up-token-field.tsx");
    const totp = read("app/api/v1/admin/session/totp-verify/route.ts");
    const confirmed = read("app/api/v1/admin/session/mfa-confirmed/route.ts");
    const issue = read("app/api/v1/admin/session/step-up/route.ts");
    const approve = read("app/api/v1/admin/deposits/approve/route.ts");

    expect(login.indexOf("admitAdminAuthAttempt")).toBeLessThan(
      login.indexOf("signInWithPassword"),
    );
    expect(login).toContain("finishAdminAuthAttempt");
    expect(rateLimit).not.toContain("new Map");
    expect(rateLimit).toContain("security_events");
    expect(gate).not.toContain("challengeAndVerify");
    expect(stepUp).not.toContain("challengeAndVerify");
    expect(totp).toContain("admitAdminAuthAttempt");
    expect(totp).toContain("finishAdminAuthAttempt");
    expect(totp).toContain("challengeAndVerify");
    expect(totp).toContain("postVerifySessionId");
    expect(totp).toContain("sessionTarget.sessionId");
    expect(confirmed).toContain("getAuthenticatorAssuranceLevel");
    expect(confirmed).toContain("hasAdminAuthServerProof");
    expect(issue).toContain("hasAdminAuthServerProof");
    expect(approve).toContain("p_operator_id: access.principal.userId");
    expect(approve).not.toContain("p_actor");
  });
});
