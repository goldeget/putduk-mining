import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getWithdrawalReauthIdentity,
  hashWithdrawalReauthToken,
  isWithdrawalReauthOriginAllowed,
  verifyWithdrawalPassword,
  withdrawalReauthSchema,
} from "@/lib/security/withdrawal-destination-reauth.server";
import { getVerifiedIdentity } from "@/lib/auth/session";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: vi.fn() }));
vi.mock("@/lib/env/public", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: "https://mining.putduk.com" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server-fetch", () => ({
  supabaseServerFetch: vi.fn(),
}));

const OWNER = "11111111-1111-4111-8111-111111111111";
function authClient() {
  const auth = {
    signInWithPassword: vi.fn().mockResolvedValue({
      data: { user: { id: OWNER }, session: {} },
      error: null,
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    mfa: {
      listFactors: vi
        .fn()
        .mockResolvedValue({ data: { all: [] }, error: null }),
      challengeAndVerify: vi.fn().mockResolvedValue({ error: null }),
      getAuthenticatorAssuranceLevel: vi
        .fn()
        .mockResolvedValue({ data: { currentLevel: "aal2" }, error: null }),
    },
  };
  return { auth, client: { auth } as unknown as SupabaseClient };
}
const credentials = {
  userId: OWNER,
  email: "synthetic@putduk.test",
  password: "synthetic-only-password",
};
let current: ReturnType<typeof authClient>;
beforeEach(() => {
  current = authClient();
});
const check = (totpCode?: string) =>
  verifyWithdrawalPassword({ ...credentials, auth: current.client, totpCode });
function withMfa(type = "totp") {
  current.auth.mfa.listFactors.mockResolvedValue({
    data: {
      all: [{ id: "trusted-factor", factor_type: type, status: "verified" }],
    },
    error: null,
  });
}

describe("destination change password/MFA proof", () => {
  it("strong identity binds verified owner and current session from Auth, not metadata", async () => {
    const sessionId = "22222222-2222-4222-8222-222222222222";
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: OWNER, email: credentials.email } },
          error: null,
        }),
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: OWNER, session_id: sessionId } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient;
    vi.mocked(getVerifiedIdentity).mockResolvedValue({
      userId: OWNER,
      supabase,
    });
    expect(await getWithdrawalReauthIdentity()).toMatchObject({
      userId: OWNER,
      sessionId,
    });
  });
  it.each([
    "owner-mismatch",
    "claim-mismatch",
    "bad-session",
    "auth-unavailable",
  ])("strong identity denies %s", async (reason) => {
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: reason === "owner-mismatch" ? "other" : OWNER },
          },
          error: reason === "auth-unavailable" ? {} : null,
        }),
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              sub: reason === "claim-mismatch" ? "other" : OWNER,
              session_id:
                reason === "bad-session"
                  ? "untrusted"
                  : "22222222-2222-4222-8222-222222222222",
            },
          },
          error: null,
        }),
      },
    } as unknown as SupabaseClient;
    vi.mocked(getVerifiedIdentity).mockResolvedValue({
      userId: OWNER,
      supabase,
    });
    expect(await getWithdrawalReauthIdentity()).toBeNull();
  });
  it("verifies an actual password and closes ONLY the transient session", async () => {
    expect(await check()).toBe("VERIFIED");
    expect(current.auth.signInWithPassword).toHaveBeenCalledWith({
      email: credentials.email,
      password: credentials.password,
    });
    expect(current.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("another account's successful sign-in is not proof for this owner", async () => {
    current.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: "other" }, session: {} },
      error: null,
    });
    expect(await check()).toBe("DENIED");
  });
  it.each(["wrong-password", "provider-unavailable"])(
    "denies %s without disclosing provider errors",
    async (reason) => {
      current.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: reason },
      });
      expect(await check()).toBe("DENIED");
    },
  );
  it("requires a returned Auth session, not just a user object", async () => {
    current.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: OWNER }, session: null },
      error: null,
    });
    expect(await check()).toBe("DENIED");
  });
  it("factor lookup failure cannot downgrade MFA to password-only", async () => {
    current.auth.mfa.listFactors.mockResolvedValue({ data: null, error: {} });
    expect(await check()).toBe("DENIED");
  });
  it("a configured TOTP requires the code", async () => {
    withMfa();
    expect(await check()).toBe("MFA_REQUIRED");
    expect(current.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });
  it("unsupported MFA also fails closed, never downgrades", async () => {
    withMfa("phone");
    expect(await check("123456")).toBe("MFA_REQUIRED");
  });
  it("checks TOTP against the factor returned by Auth", async () => {
    withMfa();
    expect(await check("123456")).toBe("VERIFIED");
    expect(current.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({
      factorId: "trusted-factor",
      code: "123456",
    });
  });
  it("rejects invalid TOTP", async () => {
    withMfa();
    current.auth.mfa.challengeAndVerify.mockResolvedValue({ error: {} });
    expect(await check("123456")).toBe("DENIED");
  });
  it("requires actual AAL2 after challenge", async () => {
    withMfa();
    current.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1" },
      error: null,
    });
    expect(await check("123456")).toBe("DENIED");
  });
  it("cleanup failure cannot issue a proof", async () => {
    current.auth.signOut.mockResolvedValue({ error: {} });
    expect(await check()).toBe("DENIED");
  });
  it("provider exceptions still close the transient session", async () => {
    current.auth.signInWithPassword.mockRejectedValue(new Error("network"));
    expect(await check()).toBe("DENIED");
    expect(current.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("stores only the token digest", () => {
    const token = "sensitive-proof-token";
    expect(hashWithdrawalReauthToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashWithdrawalReauthToken(token)).not.toContain(token);
  });
  it.each(["userId", "email", "sessionId", "verified", "user_metadata"])(
    "rejects client authorization field %s",
    (field) => {
      const destination = {
        method: "KRW_BANK",
        accountHolder: "퍼뜩테스트",
        accountNumber: "110123456789",
        bankCode: "KB",
      };
      expect(
        withdrawalReauthSchema.safeParse({
          password: "synthetic",
          destination,
          [field]: "attacker",
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    ["https://mining.putduk.com", "same-origin", "application/json", true],
    ["https://evil.test", "cross-site", "application/json", false],
    ["https://admin.mining.putduk.com", "same-site", "application/json", false],
    [null, "cross-site", "application/json", false],
    [null, null, "text/plain", false],
    [null, null, "application/json", true],
  ])(
    "enforces origin and non-simple JSON (%s, %s, %s)",
    (origin, site, contentType, allowed) => {
      const headers = new Headers({ "content-type": contentType as string });
      if (origin) headers.set("origin", origin as string);
      if (site) headers.set("sec-fetch-site", site as string);
      expect(
        isWithdrawalReauthOriginAllowed(
          new Request("https://mining.putduk.com/api", {
            method: "POST",
            headers,
          }),
        ),
      ).toBe(allowed);
    },
  );
});
