import { describe, expect, it } from "vitest";

import {
  presentHomeFundingFacts,
  presentHomeMiningFacts,
  resolveHomeWorldState,
} from "@/lib/product/home-world-state";
import {
  emptyMiningServerDisplay,
  parseMiningServerDisplay,
  type FundedRuntimeDisplay,
  type MiningServerDisplay,
} from "@/lib/product/mining-server-display";

const emptyReads = {
  trial: null,
  mining: null,
  trialUnavailable: false,
  miningUnavailable: false,
  fundedDisplay: emptyMiningServerDisplay,
  fundedUnavailable: false,
};

const acceptedReceipt = {
  schema_version: 1,
  runtime_version: 2,
  state_revision: "1",
  condition_revision: "1",
  accepted_cursor_at: "2026-10-05T10:00:00.000000Z",
  evaluated_at: "2026-10-06T10:00:00.000000Z",
  allocation_bps: "5000",
  committed_reward_total_atomic: "7",
  reward_carry: { numerator: "1", denominator: "2", unit: "KRW" },
  conditional_maintenance: {
    numerator: "9000",
    denominator: "1",
    unit: "KRW",
    qualification: "UNCONFIRMED",
  },
} satisfies FundedRuntimeDisplay;

const activeReceipt = {
  ...acceptedReceipt,
  schema_version: 2,
  status: "ACTIVE",
  stop_reason: null,
  speed: {
    product_multiplier_bps: "10000",
    user_multiplier_bps: "10000",
    common_multiplier: { numerator: "1", denominator: "1" },
    effective_global_multiplier: { numerator: "1", denominator: "2" },
  },
} satisfies FundedRuntimeDisplay;

function paidDisplay(runtime: FundedRuntimeDisplay): MiningServerDisplay {
  return {
    ...emptyMiningServerDisplay,
    available: true,
    funded_runtime: runtime,
  };
}

describe("Home world source truth", () => {
  it.each(["trial", "mining"] as const)(
    "an unavailable %s source cannot turn the other source's absence into readiness",
    (source) => {
      const state = resolveHomeWorldState({
        ...emptyReads,
        [source === "trial" ? "trialUnavailable" : "miningUnavailable"]: true,
      });
      expect(state.needsRequery).toBe(true);
      expect(state.sourceState).toBe("partial");
      expect(state.running).toBe(false);
      expect(state.notStarted).toBe(false);
      expect(state.primary).toEqual({ href: "/home", label: "상태 다시 확인" });
      expect(state.liveLabel).not.toContain("준비 완료");
    },
  );

  it.each(["ACTIVE", "COMPLETED", "EXPIRED"])(
    "failed trial data with %s is discarded rather than displayed as an active/completed source",
    (status) => {
      const state = resolveHomeWorldState({
        ...emptyReads,
        trial: { status, world_name_ko: "오래된 월드" },
        trialUnavailable: true,
      });
      expect(state.running).toBe(false);
      expect(state.worldTitle).not.toBe("오래된 월드");
      expect(state.liveLabel).not.toContain("START");
      expect(state.trialStatusKnown).toBe(false);
      expect(state.needsRequery).toBe(true);
    },
  );

  it("a failed mining response with leftover NORMAL cannot animate", () => {
    const state = resolveHomeWorldState({
      ...emptyReads,
      mining: { status: "NORMAL", world_name_ko: "오래된 월드" },
      miningUnavailable: true,
    });
    expect(state.running).toBe(false);
    expect(state.worldTitle).not.toBe("오래된 월드");
    expect(state.needsRequery).toBe(true);
  });

  it("two failed reads remain an error even with leftover ACTIVE data", () => {
    const state = resolveHomeWorldState({
      ...emptyReads,
      trial: { status: "ACTIVE" },
      mining: { status: "NORMAL" },
      trialUnavailable: true,
      miningUnavailable: true,
    });
    expect(state.sourceState).toBe("error");
    expect(state.running).toBe(false);
    expect(state.notStarted).toBe(false);
  });

  it.each([null, "FUTURE_STATE"])(
    "an unknown trial status %s prevents a guessed primary action even with confirmed NORMAL mining",
    (status) => {
      const state = resolveHomeWorldState({
        ...emptyReads,
        trial: { status },
        mining: { status: "NORMAL" },
      });
      expect(state.sourceState).toBe("unknown");
      expect(state.running).toBe(false);
      expect(state.trialStatusKnown).toBe(false);
      expect(state.primary.href).toBe("/home");
    },
  );

  it("unknown mining status cannot be treated as running merely because trial is ACTIVE", () => {
    const state = resolveHomeWorldState({
      ...emptyReads,
      trial: { status: "ACTIVE" },
      mining: { status: "ACTIVE" },
    });
    expect(state.sourceState).toBe("unknown");
    expect(state.running).toBe(false);
    expect(state.needsRequery).toBe(true);
  });

  it.each(["NORMAL", "REDUCED"])(
    "confirmed %s mining is the source for the running scene and destination",
    (status) => {
      const state = resolveHomeWorldState({
        ...emptyReads,
        trial: { status: "COMPLETED", world_name_ko: "체험 월드" },
        mining: { status, world_name_ko: "실제 월드" },
      });
      expect(state.running).toBe(true);
      expect(state.sourceState).toBe("loaded");
      expect(state.worldTitle).toBe("실제 월드");
      expect(state.primary.href).toBe("/mining");
    },
  );

  it.each(["MAINTENANCE", "PARTIAL_STOP", "STOPPED"])(
    "confirmed %s mining stays static even with a separate ACTIVE trial",
    (status) => {
      const state = resolveHomeWorldState({
        ...emptyReads,
        trial: { status: "ACTIVE" },
        mining: { status },
      });
      expect(state.running).toBe(false);
      expect(state.primary.href).toBe("/mining");
      expect(state.liveLabel).not.toContain("START 진행 중");
    },
  );

  it("confirmed ACTIVE trial can run only after mining read succeeds as empty", () => {
    const state = resolveHomeWorldState({
      ...emptyReads,
      trial: { status: "ACTIVE" },
    });
    expect(state.running).toBe(true);
    expect(state.primary).toEqual({ href: "/start", label: "START 계속하기" });
    expect(state.worldTitle).toBe("한국");
    const incomplete = resolveHomeWorldState({
      ...emptyReads,
      trial: { status: "ACTIVE" },
      miningUnavailable: true,
    });
    expect(incomplete.running).toBe(false);
    expect(incomplete.needsRequery).toBe(true);
  });

  it.each(["COMPLETED", "EXPIRED"])(
    "%s trial returns to results without a first-start claim",
    (status) => {
      const state = resolveHomeWorldState({ ...emptyReads, trial: { status } });
      expect(state.running).toBe(false);
      expect(state.notStarted).toBe(false);
      expect(state.primary.label).toBe("START 결과 보기");
    },
  );

  it("only successful absence of both sources can show the first-start invitation", () => {
    const state = resolveHomeWorldState(emptyReads);
    expect(state.notStarted).toBe(true);
    expect(state.needsRequery).toBe(false);
    expect(state.running).toBe(false);
    expect(state.primary.label).toBe("첫 채굴 시작");
  });
});

describe("Home paid runtime priority", () => {
  it("shows a strict SAFE_MODE stop without changing accepted credits, carry or cursor facts", () => {
    const runtime = {
      ...activeReceipt,
      status: "STOPPED" as const,
      stop_reason: "SAFE_MODE" as const,
    };
    const display = parseMiningServerDisplay(paidDisplay(runtime));
    expect(display).not.toBeNull();
    const before = structuredClone(display);
    const state = resolveHomeWorldState({
      ...emptyReads,
      fundedDisplay: display,
      trial: { status: "ACTIVE" },
      mining: { status: "NORMAL" },
    });
    expect(state.running).toBe(false);
    expect(state.needsRequery).toBe(false);
    expect(state.liveLabel).toBe("안전 모드로 잠시 멈춤");
    expect(state.worldLead).toContain("확인된 채굴 기록은 유지돼요");
    expect(state.primary).toEqual({
      href: "/mining",
      label: "채굴 상태 확인",
    });
    expect(state.notStarted).toBe(false);
    expect(display).toEqual(before);
    expect(display?.funded_runtime).toMatchObject({
      committed_reward_total_atomic: "7",
      reward_carry: { numerator: "1", denominator: "2", unit: "KRW" },
      accepted_cursor_at: "2026-10-05T10:00:00.000000Z",
      allocation_bps: "5000",
      speed: {
        effective_global_multiplier: { numerator: "1", denominator: "2" },
      },
    });
  });

  it("uses confirmed 50% ACTIVE funded proof without a legacy session or START row", () => {
    const state = resolveHomeWorldState({
      ...emptyReads,
      fundedDisplay: paidDisplay(activeReceipt),
    });
    expect(state.running).toBe(true);
    expect(state.primary).toEqual({ href: "/mining", label: "실제 채굴 보기" });
    expect(state.liveLabel).toBe("채굴 중");
    expect(state.notStarted).toBe(false);
    expect(state.needsRequery).toBe(false);
  });

  it("paid ACTIVE remains authoritative when unrelated legacy/START reads fail", () => {
    const state = resolveHomeWorldState({
      ...emptyReads,
      fundedDisplay: paidDisplay(activeReceipt),
      trial: { status: "ACTIVE" },
      mining: { status: "STOPPED" },
      trialUnavailable: true,
      miningUnavailable: true,
    });
    expect(state.running).toBe(true);
    expect(state.needsRequery).toBe(false);
    expect(state.primary.href).toBe("/mining");
    expect(state.sourceState).toBe("partial");
    expect(state.trialStatusKnown).toBe(false);
  });

  it.each(["NO_ACTIVE_ALLOCATION", "CAPACITY_USED"] as const)(
    "confirmed STOPPED %s wins over ACTIVE trial and NORMAL legacy facts",
    (reason) => {
      const runtime = {
        ...activeReceipt,
        status: "STOPPED" as const,
        stop_reason: reason,
        allocation_bps: reason === "NO_ACTIVE_ALLOCATION" ? "0" : "5000",
        speed: {
          ...activeReceipt.speed,
          effective_global_multiplier: {
            numerator: reason === "NO_ACTIVE_ALLOCATION" ? "0" : "1",
            denominator: "2",
          },
        },
      };
      expect(parseMiningServerDisplay(paidDisplay(runtime))).not.toBeNull();
      const state = resolveHomeWorldState({
        ...emptyReads,
        fundedDisplay: paidDisplay(runtime),
        trial: { status: "ACTIVE" },
        mining: { status: "NORMAL" },
      });
      expect(state.running).toBe(false);
      expect(state.needsRequery).toBe(false);
      expect(state.primary.href).toBe("/products/allocation");
      expect(state.liveLabel).toBe(
        reason === "CAPACITY_USED" ? "이번 한도 완료" : "배분 대기",
      );
      expect(state.notStarted).toBe(false);
    },
  );

  it.each([
    ["V1 receipts", paidDisplay(acceptedReceipt)],
    [
      "available paid display without runtime",
      { ...emptyMiningServerDisplay, available: true },
    ],
    ["missing display", null],
  ])(
    "%s never falls back to ACTIVE trial or NORMAL legacy animation",
    (_, display) => {
      const state = resolveHomeWorldState({
        ...emptyReads,
        fundedDisplay: display as MiningServerDisplay | null,
        trial: { status: "ACTIVE" },
        mining: { status: "NORMAL" },
      });
      expect(state.running).toBe(false);
      expect(state.needsRequery).toBe(true);
      expect(state.primary.href).toBe("/home");
      expect(state.sourceState).toBe("unknown");
      expect(state.notStarted).toBe(false);
    },
  );

  it("failed paid read discards leftover ACTIVE proof", () => {
    const state = resolveHomeWorldState({
      ...emptyReads,
      fundedDisplay: paidDisplay(activeReceipt),
      fundedUnavailable: true,
      trial: { status: "ACTIVE" },
      mining: { status: "NORMAL" },
    });
    expect(state.running).toBe(false);
    expect(state.needsRequery).toBe(true);
    expect(state.primary.href).toBe("/home");
    expect(state.liveLabel).toBe("상태를 불러오지 못했어요");
  });

  it("a rejected paid DTO is unknown, not evidence of paid absence", () => {
    const parsed = parseMiningServerDisplay({
      ...paidDisplay(activeReceipt),
      funded_runtime: { ...activeReceipt, status: "FUTURE_ACTIVE" },
    });
    expect(parsed).toBeNull();
    const state = resolveHomeWorldState({
      ...emptyReads,
      fundedDisplay: parsed,
      trial: { status: "ACTIVE" },
      mining: { status: "NORMAL" },
    });
    expect(state.running).toBe(false);
    expect(state.primary.href).toBe("/home");
    expect(state.needsRequery).toBe(true);
  });

  it("contradictory unavailable display with an envelope never activates", () => {
    const state = resolveHomeWorldState({
      ...emptyReads,
      fundedDisplay: {
        ...emptyMiningServerDisplay,
        funded_runtime: activeReceipt,
      },
      trial: { status: "ACTIVE" },
      mining: { status: "NORMAL" },
    });
    expect(state.running).toBe(false);
    expect(state.needsRequery).toBe(true);
    expect(state.notStarted).toBe(false);
  });
});

describe("Home proven receipt totals", () => {
  it.each([acceptedReceipt, activeReceipt])(
    "keeps per-activation committed total separate from conditional money and daily amount",
    (runtime) => {
      expect(presentHomeMiningFacts(runtime)).toEqual({
        today: "확인할 수 없어요",
        committedTotal: "7 KRW",
      });
    },
  );
  it("shows proved whole-KRW zero without declaring zero daily rewards", () => {
    expect(
      presentHomeMiningFacts({
        ...activeReceipt,
        committed_reward_total_atomic: "0",
      }),
    ).toEqual({ today: "확인할 수 없어요", committedTotal: "0 KRW" });
  });
  it("formats accepted whole units beyond Number precision exactly", () => {
    expect(
      presentHomeMiningFacts({
        ...activeReceipt,
        committed_reward_total_atomic: "9007199254740993",
      }).committedTotal,
    ).toBe("9,007,199,254,740,993 KRW");
  });
  it.each([null, undefined])(
    "missing proof %s never becomes zero or no rewards",
    (runtime) => {
      expect(presentHomeMiningFacts(runtime)).toEqual({
        today: "확인할 수 없어요",
        committedTotal: "확인할 수 없어요",
      });
    },
  );
});

describe("Home server funding facts", () => {
  const confirmed = {
    ...paidDisplay(activeReceipt),
    eligible_principal_micro_krw: "9007199254740993000000",
    remaining_capacity_micro_krw: "1500000",
  };

  it("formats server principal and remaining limit without deriving a capacity percentage", () => {
    expect(presentHomeFundingFacts(confirmed)).toEqual({
      principal: "9,007,199,254,740,993원",
      remainingCapacity: "약 1원",
    });
    expect(confirmed.funded_runtime?.committed_reward_total_atomic).toBe("7");
    expect(confirmed.remaining_capacity_micro_krw).toBe("1500000");
  });

  it.each([null, undefined, emptyMiningServerDisplay])(
    "missing funding proof never supplies mock capital or a zero limit: %s",
    (display) => {
      expect(presentHomeFundingFacts(display)).toEqual({
        principal: "확인할 수 없어요",
        remainingCapacity: "확인할 수 없어요",
      });
    },
  );

  it("discards retained amounts on a failed read", () => {
    expect(presentHomeFundingFacts(confirmed, true)).toEqual({
      principal: "확인할 수 없어요",
      remainingCapacity: "확인할 수 없어요",
    });
  });

  it("keeps an individually missing field unknown while retaining the other server fact", () => {
    expect(
      presentHomeFundingFacts({
        ...confirmed,
        remaining_capacity_micro_krw: null,
      }),
    ).toEqual({
      principal: "9,007,199,254,740,993원",
      remainingCapacity: "확인할 수 없어요",
    });
  });

  it("preserves a server-confirmed zero without inventing a percentage or daily total", () => {
    expect(
      presentHomeFundingFacts({
        ...confirmed,
        eligible_principal_micro_krw: "0",
        remaining_capacity_micro_krw: "0",
      }),
    ).toEqual({ principal: "0원", remainingCapacity: "0원" });
    expect(presentHomeMiningFacts(activeReceipt).today).toBe(
      "확인할 수 없어요",
    );
  });
});
