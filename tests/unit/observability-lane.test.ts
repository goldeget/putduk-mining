import { describe, expect, it } from "vitest";

import { countCoreFunnel } from "@/domain/analytics/funnel";
import {
  SESSION_REPLAY_MODE,
  allowedAnalyticsOrigins,
  browserAnalyticsEnabled,
  buildClientErrorProperties,
  buildWebVitalProperties,
  readAppRelease,
  sanitizeAnalyticsProperties,
  serverAnalyticsEnabled,
  toStructuralReplayStep,
} from "@/domain/analytics/observability";

const sessionId = "a8098c1a-f86e-4f2a-af37-248e7e0f7a14";

describe("observability lane", () => {
  it("keeps browser analytics off for tests, automation, and loopback", () => {
    expect(
      browserAnalyticsEnabled({
        hostname: "mining.putduk.com",
        nodeEnv: "production",
        webdriver: false,
      }),
    ).toBe(true);
    expect(
      browserAnalyticsEnabled({
        hostname: "mining.putduk.com",
        nodeEnv: "test",
        webdriver: false,
      }),
    ).toBe(false);
    expect(
      browserAnalyticsEnabled({
        hostname: "127.0.0.1",
        nodeEnv: "production",
        webdriver: false,
      }),
    ).toBe(false);
    expect(
      browserAnalyticsEnabled({
        hostname: "mining.putduk.com",
        nodeEnv: "production",
        webdriver: true,
      }),
    ).toBe(false);
    expect(serverAnalyticsEnabled("production")).toBe(true);
    expect(serverAnalyticsEnabled("test")).toBe(false);
  });

  it("drops secrets and keeps a safe release token", () => {
    expect(readAppRelease("d94bf8bd")).toBe("d94bf8bd");
    expect(readAppRelease("secret token")).toBeUndefined();
    expect(
      sanitizeAnalyticsProperties(
        {
          amount_atomic: 5000,
          email: "private@example.com",
          path: "/start?next=/wallet",
        },
        "d94bf8bd",
      ),
    ).toEqual({ app_release: "d94bf8bd", path: "/start" });
  });

  it("replays only a structural path", () => {
    expect(SESSION_REPLAY_MODE).toBe("structural_path_only");
    expect(
      toStructuralReplayStep({
        path: "/wallet?address=0xabc123456789",
        properties: { path: "/wallet" },
        sessionId,
      }),
    ).toEqual({ path: "/wallet", sessionId });
    expect(
      toStructuralReplayStep({
        path: "/home",
        properties: { balance: 5000 },
        sessionId,
      }),
    ).toBeNull();
  });

  it("reports an error class without the message", () => {
    const error = new Error("잔액 5000원과 private@example.com");
    error.name = "TypeError";
    Object.assign(error, { digest: "digest_1" });
    const properties = buildClientErrorProperties(error);
    expect(properties).toEqual({
      error_digest: "digest_1",
      error_name: "TypeError",
    });
    expect(JSON.stringify(properties)).not.toContain("private@example.com");
    expect(JSON.stringify(properties)).not.toContain("5000");
  });

  it("rates web vitals without a money field", () => {
    expect(buildWebVitalProperties({ name: "LCP", raw: 1800 })).toEqual({
      vital_name: "LCP",
      vital_rating: "good",
      vital_unit: "ms",
      vital_value: 1800,
    });
    expect(buildWebVitalProperties({ name: "CLS", raw: 0.12 })).toMatchObject({
      vital_rating: "needs_improvement",
      vital_unit: "milli",
      vital_value: 120,
    });
    expect(
      buildWebVitalProperties({ name: "INP", raw: Number.NaN }),
    ).toBeNull();
  });

  it("counts the core funnel in order", () => {
    const counts = countCoreFunnel([
      {
        actorId: "member-a",
        eventName: "signup_complete",
        occurredAt: "2026-10-05T00:00:02.000Z",
      },
      {
        actorId: "member-a",
        eventName: "landing_view",
        occurredAt: "2026-10-05T00:00:01.000Z",
      },
      {
        actorId: "member-b",
        eventName: "landing_view",
        occurredAt: "2026-10-05T00:00:01.000Z",
      },
      {
        actorId: "member-a",
        eventName: "trial_start",
        occurredAt: "2026-10-05T00:00:00.000Z",
      },
    ]);
    expect(counts[0]).toEqual({ actors: 2, step: "landing_view" });
    expect(counts[1]).toEqual({ actors: 1, step: "signup_complete" });
    expect(counts[2]).toEqual({ actors: 0, step: "trial_start" });
  });

  it("accepts the admin origin without treating it as a credential", () => {
    expect(
      allowedAnalyticsOrigins(
        "https://mining.putduk.com",
        "https://admin.mining.putduk.com",
      ),
    ).toEqual(["https://mining.putduk.com", "https://admin.mining.putduk.com"]);
    expect(
      allowedAnalyticsOrigins(
        "https://mining.putduk.com",
        "https://user:secret@admin.mining.putduk.com",
      ),
    ).toEqual(["https://mining.putduk.com"]);
  });
});
