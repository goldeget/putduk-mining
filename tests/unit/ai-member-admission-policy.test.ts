import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env/server";
import { beginAiRequest } from "@/lib/ai/usage";

// All values are synthetic. Keep the inherited environment as an opaque
// reference only; never inspect it or load an env/auth file.
function syntheticEnv<T>(overrides: Record<string, string>, run: () => T): T {
  const inherited = process.env;
  process.env = {
    NODE_ENV: "test",
    APP_ENV: "test",
    APP_TIMEZONE: "UTC",
    SUPABASE_SECRET_KEY: "SYNTHETIC_LOCAL_TEST_ONLY_SECRET",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:58421",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "SYNTHETIC_LOCAL_PUBLIC_TEST_ONLY",
    ...overrides,
  };
  try {
    return run();
  } finally {
    process.env = inherited;
  }
}

describe("member-wide AI configuration ceilings", () => {
  it("defaults to 2s first content and hard 5/min, 100/day", () => {
    const env = syntheticEnv({}, getServerEnv);
    expect(env.AI_FIRST_TOKEN_TIMEOUT_MS).toBe(2000);
    expect(env.AI_MAX_REQUESTS_PER_MINUTE).toBe(5);
    expect(env.AI_MAX_REQUESTS_PER_DAY).toBe(100);
  });
  it("permits stricter quotas and the existing explicit timeout override", () => {
    const env = syntheticEnv(
      {
        AI_MAX_REQUESTS_PER_MINUTE: "1",
        AI_MAX_REQUESTS_PER_DAY: "10",
        AI_FIRST_TOKEN_TIMEOUT_MS: "15000",
      },
      getServerEnv,
    );
    expect(env.AI_MAX_REQUESTS_PER_MINUTE).toBe(1);
    expect(env.AI_MAX_REQUESTS_PER_DAY).toBe(10);
    expect(env.AI_FIRST_TOKEN_TIMEOUT_MS).toBe(15000);
  });
  it.each([
    ["AI_MAX_REQUESTS_PER_MINUTE", "6"],
    ["AI_MAX_REQUESTS_PER_MINUTE", "60"],
    ["AI_MAX_REQUESTS_PER_MINUTE", "0"],
    ["AI_MAX_REQUESTS_PER_DAY", "101"],
    ["AI_MAX_REQUESTS_PER_DAY", "5000"],
    ["AI_MAX_REQUESTS_PER_DAY", "1.5"],
  ])("rejects an invalid server configuration %s=%s", (key, value) => {
    expect(() => syntheticEnv({ [key]: value }, getServerEnv)).toThrow();
  });
});

function admission() {
  return {
    clientMessageId: "d0000001-0000-4000-8000-000000000001",
    contextScope: "GENERAL_SAFE" as const,
    inputRedacted: { synthetic: true },
    knowledgeVersion: "local-test",
    model: "openai/gpt-oss-20b",
    perDayLimit: 100,
    perMinuteLimit: 5,
    promptHash: "a".repeat(64),
    routeKey: "general_safe",
    routeKind: "general_safe" as const,
    safetyClassification: "GENERAL_SAFE" as const,
    userId: "d0000002-0000-4000-8000-000000000001",
  };
}

describe("common member admission before every provider", () => {
  it("uses the existing atomic RPC without admitting another provider request", async () => {
    const result = {
      data: [{ request_id: "synthetic", is_new: true }],
      error: null,
    };
    const rpc = vi.fn(async () => result);
    expect(
      await beginAiRequest({ rpc } as unknown as SupabaseClient, admission()),
    ).toBe(result);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "begin_ai_request_v2",
      expect.objectContaining({ p_per_minute_limit: 5, p_per_day_limit: 100 }),
    );
  });
  it.each([
    [6, 100],
    [60, 5000],
    [5, 101],
    [0, 100],
    [5, 0],
    [1.5, 100],
    [5, Number.NaN],
    [null, 100],
    [5, undefined],
  ])("rejects invalid limits before any RPC (%s/%s)", async (minute, day) => {
    const rpc = vi.fn();
    await expect(
      beginAiRequest({ rpc } as unknown as SupabaseClient, {
        ...admission(),
        perMinuteLimit: minute as number,
        perDayLimit: day as number,
      }),
    ).rejects.toThrow("AI_LIMIT_POLICY_INVALID");
    expect(rpc).not.toHaveBeenCalled();
  });
});
