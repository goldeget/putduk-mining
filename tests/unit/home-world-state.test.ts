import { describe, expect, it } from "vitest";

import { resolveHomeWorldState } from "@/lib/product/home-world-state";

const emptyReads = {
  trial: null,
  mining: null,
  trialUnavailable: false,
  miningUnavailable: false,
};

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
