import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { register } from "../../instrumentation";
import { getServerEnv } from "../../lib/env/server";

vi.mock("../../lib/env/server", () => ({ getServerEnv: vi.fn() }));

describe("public landing startup validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", undefined);
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("APP_TIMEZONE", "UTC");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://putduk.com");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://osrmyjgmpdspdcwqjwuv.supabase.co",
    );
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_public_landing_test_not_a_real_key",
    );
    vi.stubEnv("SUPABASE_SECRET_KEY", undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("validates the actual public tuple without requiring a server secret", async () => {
    await expect(register()).resolves.toBeUndefined();
    expect(getServerEnv).not.toHaveBeenCalled();
    expect(process.env.SUPABASE_SECRET_KEY).toBeUndefined();
  });

  it.each([
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined],
    [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_secret_private_key_must_never_be_public",
    ],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://mhchzipznxbwbocdihlg.supabase.co"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://wrongproject.supabase.co"],
    ["NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"],
    ["APP_TIMEZONE", "Asia/Seoul"],
    ["APP_TIMEZONE", undefined],
  ])("rejects invalid public startup input %s", async (name, value) => {
    vi.stubEnv(name, value);
    await expect(register()).rejects.toThrow();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it.each([
    ["production", "https://mining.putduk.com"],
    ["production", undefined],
    ["staging", "https://putduk.com"],
    ["production", "https://putduk.com.attacker.test"],
  ])("retains full server validation for %s/%s", async (environment, url) => {
    vi.stubEnv("APP_ENV", environment);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", url);
    await register();
    expect(getServerEnv).toHaveBeenCalledOnce();
  });

  it.each([
    ["NODE_ENV", "development"],
    ["NEXT_PHASE", "phase-production-build"],
    ["NEXT_RUNTIME", "edge"],
  ])(
    "keeps existing non-runtime-start behavior for %s",
    async (name, value) => {
      vi.stubEnv(name, value);
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
      await expect(register()).resolves.toBeUndefined();
      expect(getServerEnv).not.toHaveBeenCalled();
    },
  );
});
