import { afterEach, describe, expect, it, vi } from "vitest";

import { getAiAvailability } from "@/lib/ai/availability";

afterEach(() => vi.unstubAllEnvs());

describe("AI display configuration boundary", () => {
  it("needs a complete valid provider tuple without requiring unrelated secrets", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("APP_ENV", "invalid-for-a-server-command");
    vi.stubEnv("AI_PROVIDER", "nvidia");
    vi.stubEnv("AI_API_KEY", "test-only-key-never-sent-to-a-provider");
    vi.stubEnv("AI_MODEL_LOW_COST", "openai/gpt-oss-20b");
    expect(getAiAvailability()).toMatchObject({ providerConfigured: true });
    expect(Object.keys(getAiAvailability()).sort()).toEqual([
      "knowledgeVersion",
      "providerConfigured",
    ]);
  });

  it("accepts the server-only NVIDIA alias but blocks trial inference in production", () => {
    vi.stubEnv("AI_PROVIDER", "nvidia");
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("NVIDIA_API_KEY", "test-only-key-never-sent-to-a-provider");
    vi.stubEnv("AI_MODEL_LOW_COST", "openai/gpt-oss-20b");
    vi.stubEnv("APP_ENV", "development");
    expect(getAiAvailability().providerConfigured).toBe(true);
    vi.stubEnv("APP_ENV", "production");
    expect(getAiAvailability().providerConfigured).toBe(false);
  });

  it("rejects conflicting NVIDIA aliases and unapproved primary models", () => {
    vi.stubEnv("AI_PROVIDER", "nvidia");
    vi.stubEnv("AI_API_KEY", "test-only-first-key-never-sent");
    vi.stubEnv("NVIDIA_API_KEY", "test-only-another-key-never-sent");
    vi.stubEnv("AI_MODEL_LOW_COST", "openai/gpt-oss-20b");
    expect(getAiAvailability().providerConfigured).toBe(false);
    vi.stubEnv("NVIDIA_API_KEY", "");
    vi.stubEnv("AI_MODEL_LOW_COST", "arbitrary/paid-model");
    expect(getAiAvailability().providerConfigured).toBe(false);
  });

  it.each([
    { provider: "", key: "", model: "" },
    { provider: "openai", key: "", model: "test-model" },
    { provider: "unsupported", key: "x".repeat(32), model: "test-model" },
    { provider: "openai", key: "short", model: "test-model" },
    { provider: "openai", key: "x".repeat(32), model: "../invalid-model" },
  ])(
    "does not label absent or invalid configuration as configured",
    (input) => {
      vi.stubEnv("AI_PROVIDER", input.provider);
      vi.stubEnv("AI_API_KEY", input.key);
      vi.stubEnv("AI_MODEL_LOW_COST", input.model);
      expect(getAiAvailability().providerConfigured).toBe(false);
    },
  );
});
