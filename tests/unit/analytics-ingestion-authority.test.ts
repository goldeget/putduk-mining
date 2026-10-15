import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/v1/analytics/route";
import { analyticsEventSchema } from "@/domain/analytics/events";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

const ORIGIN = "https://mining.putduk.com";
const insert = vi.fn();
const from = vi.fn();
const serverFacts = [
  "signup_complete",
  "trial_start",
  "trial_first_reward",
  "trial_progress",
  "trial_complete",
  "trial_conversion_complete",
  "trial_50_percent",
  "mining_start",
  "mining_stop",
  "deposit_complete",
  "withdrawal_complete",
  "welcome_withdrawal_requested",
  "referral_stage_qualified",
  "referral_reward_paid",
  "funding_promotion_qualified",
  "funding_promotion_reward_paid",
  "notification_delivered",
  "welcome_reward_qualified",
  "welcome_reward_auto_hold",
  "welcome_reward_converted",
  "welcome_withdrawal_complete",
  "withdrawal_complete_no_funding",
  "first_funding",
  "first_real_mining",
  "real_mining_start",
  "first_real_settlement",
  "active_7d",
  "active_30d",
  "long_term_active",
  "event_join",
] as const;

function event(eventName: string) {
  return {
    eventId: "6d2caee8-166f-4d99-8507-0ebd774173e0",
    eventName,
    occurredAt: new Date().toISOString(),
    properties: {},
    sessionId: "a8098c1a-f86e-4f2a-af37-248e7e0f7a14",
  };
}

function request(eventName: string) {
  return new NextRequest(`${ORIGIN}/api/v1/analytics`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(event(eventName)),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServerEnv).mockReturnValue({
    APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: ORIGIN,
  } as ReturnType<typeof getServerEnv>);
  vi.mocked(getVerifiedIdentity).mockResolvedValue({
    userId: "11111111-1111-4111-8111-111111111111",
    supabase: {} as SupabaseClient,
  });
  insert.mockResolvedValue({ error: null });
  from.mockReturnValue({ insert });
  vi.mocked(createSupabaseAdminClient).mockReturnValue({
    from,
  } as unknown as SupabaseClient);
});

describe("browser analytics authority boundary", () => {
  it.each(serverFacts)(
    "rejects browser self-reported %s before identity or DB admission",
    async (name) => {
      const response = await POST(request(name));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_EVENT");
      expect(getVerifiedIdentity).not.toHaveBeenCalled();
      expect(createSupabaseAdminClient).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
      // Trusted server/outbox producers retain the canonical event vocabulary.
      expect(analyticsEventSchema.safeParse(event(name)).success).toBe(true);
    },
  );

  it.each([
    "screen_view",
    "withdrawal_start",
    "deposit_start",
    "ai_open",
    "web_vital",
    "client_error",
  ])(
    "retains browser interaction %s with verified attribution",
    async (name) => {
      const response = await POST(request(name));
      expect(response.status).toBe(202);
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_name: name,
          user_id: "11111111-1111-4111-8111-111111111111",
        }),
      );
    },
  );

  it("keeps anonymous interaction acceptance and first-party attribution", async () => {
    vi.mocked(getVerifiedIdentity).mockResolvedValue(null);
    const response = await POST(request("landing_view"));
    expect(response.status).toBe(202);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        anonymous_id: expect.any(String),
        user_id: null,
      }),
    );
    expect(response.cookies.get("__Host-putduk-aid")?.value).toBeTruthy();
  });

  it("retains idempotent browser retry acceptance", async () => {
    insert.mockResolvedValue({ error: { code: "23505" } });
    expect((await POST(request("screen_view"))).status).toBe(202);
  });
});
