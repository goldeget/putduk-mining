import { describe, expect, it } from "vitest";
import {
  emptyMiningServerDisplay,
  parseMiningServerDisplay,
  type MiningServerDisplay,
} from "@/lib/product/mining-server-display";
import {
  presentMiningTrial,
  presentMiningReferenceFacts,
  resolveMiningPresentation,
} from "@/lib/product/mining-presentation";

function funded(
  stop?: "SAFE_MODE" | "CAPACITY_USED" | "NO_ACTIVE_ALLOCATION",
): MiningServerDisplay {
  const inactive = stop === "NO_ACTIVE_ALLOCATION";
  const display = parseMiningServerDisplay({
    available: true,
    eligible_principal_micro_krw: "5000000000000",
    tier_code: "L5",
    tier_activated: true,
    cycle_started_at: "2026-10-06T00:00:00.000000Z",
    cycle_end: "2026-11-05T00:00:00.000000Z",
    effective_capacity_micro_krw: "200000000000",
    remaining_capacity_micro_krw: "123456789012",
    used_capacity_micro_krw: "76543210988",
    speed_multiplier_bps: "10000",
    pending_micro_krw: "250000000",
    retention_unconfirmed_micro_krw: "1500000000",
    funded_runtime: {
      schema_version: 2,
      runtime_version: 2,
      state_revision: "123",
      condition_revision: "456",
      accepted_cursor_at: "2026-10-06T00:01:00.123456Z",
      evaluated_at: "2026-10-06T00:02:00.654321Z",
      allocation_bps: inactive ? "0" : "5000",
      committed_reward_total_atomic: "9876543210987654321",
      reward_carry: { numerator: "1", denominator: "7", unit: "KRW" },
      conditional_maintenance: {
        numerator: "4501",
        denominator: "3",
        unit: "KRW",
        qualification: "UNCONFIRMED",
      },
      status: stop ? "STOPPED" : "ACTIVE",
      stop_reason: stop ?? null,
      speed: {
        product_multiplier_bps: "10000",
        user_multiplier_bps: "10000",
        common_multiplier: { numerator: "1", denominator: "1" },
        effective_global_multiplier: {
          numerator: inactive ? "0" : "1",
          denominator: "2",
        },
      },
    },
  });
  if (!display) throw new Error("fixture must satisfy the strict server DTO");
  return display;
}

const legacy = { status: "NORMAL", world_name_ko: "코리아" };
const resolve = (
  display: MiningServerDisplay | null,
  session = legacy,
  displayError = false,
  sessionError = false,
) =>
  resolveMiningPresentation({ display, session, displayError, sessionError });

describe("mining reference presentation source boundary", () => {
  it("prioritizes authoritative funded ACTIVE even when legacy is stopped or failed", () => {
    expect(
      resolve(
        funded(),
        { status: "STOPPED", world_name_ko: "미국" },
        false,
        true,
      ),
    ).toMatchObject({
      source: "funded",
      running: true,
      label: "채굴 중",
      action: "allocation",
    });
  });
  for (const [reason, label, action] of [
    ["SAFE_MODE", "안전 모드로 잠시 멈춤", "reload"],
    ["CAPACITY_USED", "이번 한도 완료", "allocation"],
    ["NO_ACTIVE_ALLOCATION", "배분 대기", "allocation"],
  ] as const) {
    it(`preserves ${reason} and all prior accepted receipt facts`, () => {
      const display = funded(reason);
      const before = JSON.stringify(display);
      expect(resolve(display)).toMatchObject({
        source: "funded",
        running: false,
        label,
        action,
      });
      expect(JSON.stringify(display)).toBe(before);
      expect(display.funded_runtime?.committed_reward_total_atomic).toBe(
        "9876543210987654321",
      );
      expect(display.funded_runtime?.reward_carry).toEqual({
        numerator: "1",
        denominator: "7",
        unit: "KRW",
      });
      expect(display.funded_runtime?.accepted_cursor_at).toBe(
        "2026-10-06T00:01:00.123456Z",
      );
    });
  }
  it("never treats v1, missing paid proof, failed read, or no display as legacy running", () => {
    const current = funded();
    const receipt = Object.fromEntries(
      Object.entries(current.funded_runtime!).filter(
        ([key]) => !["status", "stop_reason", "speed"].includes(key),
      ),
    );
    const v1 = parseMiningServerDisplay({
      ...current,
      funded_runtime: { ...receipt, schema_version: 1 },
    });
    const noRuntime = { ...current };
    delete noRuntime.funded_runtime;
    for (const display of [v1, noRuntime, null]) {
      expect(resolve(display)).toMatchObject({
        source: "unknown",
        running: false,
        action: "reload",
      });
    }
    expect(resolve(current, legacy, true)).toMatchObject({
      source: "unknown",
      running: false,
    });
  });
  it("uses genuine legacy states only after the paid source is verified absent", () => {
    expect(resolve(emptyMiningServerDisplay)).toMatchObject({
      source: "legacy",
      running: true,
      title: "코리아 · 채굴 중",
    });
    expect(
      resolve(emptyMiningServerDisplay, {
        status: "MAINTENANCE",
        world_name_ko: "미국",
      }),
    ).toMatchObject({ source: "legacy", running: false, label: "점검 중" });
    expect(
      resolve(emptyMiningServerDisplay, {
        status: "NEW_STATE",
        world_name_ko: "한국",
      }),
    ).toMatchObject({ source: "unknown", running: false, action: "reload" });
    expect(
      resolve(emptyMiningServerDisplay, legacy, false, true),
    ).toMatchObject({ source: "unknown", running: false });
    expect(
      resolveMiningPresentation({
        display: emptyMiningServerDisplay,
        displayError: false,
        session: null,
        sessionError: false,
      }),
    ).toMatchObject({ source: "empty", running: false, action: "start" });
  });
});

describe("facts are formatted server facts, not economics", () => {
  it("keeps unknown daily total, exact large accepted sum and server 0.5 multiplier", () => {
    const facts = presentMiningReferenceFacts(funded());
    expect(facts).toMatchObject({
      principal: "5,000,000원",
      tier: "L5",
      today: "확인할 수 없어요",
      speed: "0.5배",
      pending: "250원",
      committed: "9,876,543,210,987,654,321원",
      used: "76,543.210988원",
      remaining: "123,456.789012원",
    });
  });
  it("never presents the legacy policy multiplier as the missing paid current speed", () => {
    const current = { ...funded() };
    delete current.funded_runtime;
    expect(presentMiningReferenceFacts(current).speed).toBe("확인할 수 없어요");
  });
  it("does not show absent, failed or nullable financial facts as zero", () => {
    for (const facts of [
      presentMiningReferenceFacts(null),
      presentMiningReferenceFacts(emptyMiningServerDisplay),
      presentMiningReferenceFacts(funded(), true),
    ]) {
      for (const value of Object.values(facts))
        expect(value).toBe("확인할 수 없어요");
    }
    const current = funded();
    expect(
      presentMiningReferenceFacts({
        ...current,
        eligible_principal_micro_krw: null,
        remaining_capacity_micro_krw: null,
        pending_micro_krw: null,
      }),
    ).toMatchObject({
      principal: "확인할 수 없어요",
      remaining: "확인할 수 없어요",
      pending: "확인할 수 없어요",
      committed: "9,876,543,210,987,654,321원",
    });
  });
});

describe("independent START proof", () => {
  it.each([
    ["READY", "PUTDUK START 확인"],
    ["ACTIVE", "START 계속하기"],
    ["COMPLETED", "START 결과 보기"],
    ["EXPIRED", "START 결과 보기"],
  ])(
    "uses verified %s without changing paid permission",
    (status, actionLabel) => {
      expect(presentMiningTrial(status)).toMatchObject({
        known: true,
        actionLabel,
      });
      const display = { ...funded() };
      delete display.funded_runtime;
      expect(resolve(display)).toMatchObject({
        source: "unknown",
        running: false,
        action: "reload",
      });
    },
  );
  it("does not infer trial readiness from an absent, failed, or unknown snapshot", () => {
    for (const status of [null, undefined, "FUTURE_STATE", "UNAVAILABLE"])
      expect(presentMiningTrial(status)).toMatchObject({
        known: false,
        actionLabel: "START 상태 다시 확인",
      });
    expect(presentMiningTrial("ACTIVE", true)).toMatchObject({ known: false });
  });
});
