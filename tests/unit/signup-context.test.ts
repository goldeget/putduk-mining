import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordSignupContext } from "@/lib/security/signup-context.server";

const state = vi.hoisted(() => ({ headers: new Headers(), insert: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: () => ({ insert: state.insert }) }),
}));

describe("production signup context edge formats", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv("APP_ENV", "production");
    state.insert.mockReset().mockResolvedValue({ error: null });
    state.headers = new Headers({
      host: "workroom.putduk.com",
      "cf-connecting-ip": "203.0.113.10",
      "cf-ray": "abcdef0123456789",
    });
  });
  it.each(["abcdef0123456789", "abcdef0123456789-ICN"])(
    "records the provider client IP for supported edge identifier %s",
    async (ray) => {
      state.headers.set("cf-ray", ray);
      await recordSignupContext("member-id", "INVITATION", true);
      expect(state.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          signup_ip: "203.0.113.10",
          ip_source: "CLOUDFLARE_VERIFIED",
        }),
      );
    },
  );
  it.each(["", "not-an-edge-id", "abcdef0123456789-INVALID"])(
    "does not trust an invalid edge identifier %s",
    async (ray) => {
      state.headers.set("cf-ray", ray);
      await recordSignupContext("member-id", "INVITATION", true);
      expect(state.insert).toHaveBeenCalledWith(
        expect.objectContaining({ signup_ip: null, ip_source: "NONE" }),
      );
    },
  );
  it.each(["localhost:3000", "workroom.putduk.com.attacker.example"])(
    "does not trust client headers outside an approved host %s",
    async (host) => {
      state.headers.set("host", host);
      await recordSignupContext("member-id", "INVITATION", true);
      expect(state.insert).toHaveBeenCalledWith(
        expect.objectContaining({ signup_ip: null, ip_source: "NONE" }),
      );
    },
  );
  it("does not accept forwarded IPs or preview requests", async () => {
    vi.stubEnv("APP_ENV", "test");
    state.headers.set("x-forwarded-for", "198.51.100.8");
    await recordSignupContext("member-id", "INVITATION", true);
    expect(state.insert).toHaveBeenCalledWith(
      expect.objectContaining({ signup_ip: null, ip_source: "NONE" }),
    );
  });
});
