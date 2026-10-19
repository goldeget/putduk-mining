import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_PROJECTION_HORIZON_MICROS,
  createServerClock,
  deriveLiveProjection,
  elapsedServerMicros,
  estimatedServerMicros,
  formatLiveAmountFixed,
  isMiningLiveProjection,
  projectPendingMicroKrw,
  settlementCueKrw,
  type LiveProjectionInput,
  type MiningLiveProjection,
} from "@/lib/product/mining-live-projection";

/** 100 server seconds observed; 38,600 micro-KRW accrued (386 micro-KRW/s). */
const input: LiveProjectionInput = {
  status: "ACTIVE",
  pendingMicroKrw: "38600",
  remainingMicroKrw: "9000000",
  carry: { numerator: "0", denominator: "1" },
  acceptedCursorAt: "2026-10-13T00:00:00.000000Z",
  evaluatedAt: "2026-10-13T00:01:40.000000Z",
  cycleEnd: "2026-11-01T00:00:00.000000Z",
};
const projection = deriveLiveProjection(input) as MiningLiveProjection;
const SECOND = 1_000_000n;

afterEach(() => vi.restoreAllMocks());

describe("server-side projection profile", () => {
  it("derives only from server-issued receipt facts, under-stating the slope", () => {
    expect(projection).toEqual({
      accruedMicroKrw: "38599",
      windowMicros: "100000000",
      ceilingMicroKrw: "9038600",
      horizonMicros: "120000000",
    });
  });
  it("removes the opening carry from the accrued amount", () => {
    const withCarry = deriveLiveProjection({
      ...input,
      pendingMicroKrw: "48600",
      carry: { numerator: "1", denominator: "100" },
    });
    expect(withCarry?.accruedMicroKrw).toBe("38599");
  });
  it.each([
    ["stopped", { status: "STOPPED" as const }],
    ["accrual too small to extrapolate", { pendingMicroKrw: "5000" }],
    ["no remaining capacity", { remainingMicroKrw: "0" }],
    ["empty window", { acceptedCursorAt: "2026-10-13T00:01:40.000000Z" }],
    [
      "cursor after evaluation",
      { acceptedCursorAt: "2026-10-13T00:02:00.000000Z" },
    ],
    ["cycle already ended", { cycleEnd: "2026-10-13T00:01:40.000000Z" }],
    ["bad carry denominator", { carry: { numerator: "0", denominator: "0" } }],
    ["non-integer pending", { pendingMicroKrw: "1e3" }],
    ["instant without microseconds", { evaluatedAt: "2026-10-13T00:01:40Z" }],
  ])("stays flat for %s", (_name, change) => {
    expect(deriveLiveProjection({ ...input, ...change })).toBeNull();
  });
  it("never extrapolates beyond the cycle end", () => {
    const nearEnd = deriveLiveProjection({
      ...input,
      cycleEnd: "2026-10-13T00:02:10.000000Z",
    });
    expect(nearEnd?.horizonMicros).toBe((30n * SECOND).toString());
    expect(LIVE_PROJECTION_HORIZON_MICROS).toBe(120n * SECOND);
  });
  it("validates a wire projection strictly", () => {
    expect(isMiningLiveProjection(projection)).toBe(true);
    expect(isMiningLiveProjection({ ...projection, rate: "1" })).toBe(false);
    expect(
      isMiningLiveProjection({ ...projection, accruedMicroKrw: "0" }),
    ).toBe(false);
    expect(isMiningLiveProjection({ ...projection, windowMicros: "1.5" })).toBe(
      false,
    );
    expect(isMiningLiveProjection(null)).toBe(false);
  });
});

describe("server-offset interpolation", () => {
  it("starts exactly at the server value and rises with elapsed server time", () => {
    expect(projectPendingMicroKrw("38600", projection, 0n)).toBe("38600");
    // 38599 * 10s / 100s = 3859.9, truncated to 3859.
    expect(projectPendingMicroKrw("38600", projection, 10n * SECOND)).toBe(
      "42459",
    );
  });
  it("is monotonic with no negative drift and flat after the horizon", () => {
    let previous = -1n;
    for (let seconds = -5n; seconds <= 400n; seconds += 7n) {
      const shown = BigInt(
        projectPendingMicroKrw("38600", projection, seconds * SECOND),
      );
      expect(shown >= previous).toBe(true);
      expect(shown >= 38600n).toBe(true);
      previous = shown;
    }
    expect(projectPendingMicroKrw("38600", projection, 120n * SECOND)).toBe(
      projectPendingMicroKrw("38600", projection, 100_000n * SECOND),
    );
  });
  it("never exceeds the server-issued ceiling", () => {
    const capped = { ...projection, ceilingMicroKrw: "38700" };
    expect(projectPendingMicroKrw("38600", capped, 120n * SECOND)).toBe(
      "38700",
    );
  });
  it("never overstates the server's own value for the same elapsed time", () => {
    // Exact server value after 10s at the true slope 386/s is 42460.
    expect(
      BigInt(projectPendingMicroKrw("38600", projection, 10n * SECOND)) <=
        42_460n,
    ).toBe(true);
  });
  it("keeps exact bigint arithmetic beyond the safe-integer range", () => {
    const large: MiningLiveProjection = {
      accruedMicroKrw: "9007199254740993",
      windowMicros: "100000000",
      ceilingMicroKrw: "9007199254740993000000000",
      horizonMicros: "120000000",
    };
    const pending = "9007199254740993000001";
    const elapsed = 37n * SECOND + 123_457n;
    const expected =
      BigInt(pending) + (9007199254740993n * elapsed) / 100000000n;
    expect(projectPendingMicroKrw(pending, large, elapsed)).toBe(
      expected.toString(),
    );
  });
});

describe("server clock anchoring", () => {
  const clock = createServerClock("2026-10-13T00:01:40.000000Z", 1_000)!;
  it("measures elapsed time from receipt arrival with a monotonic reading", () => {
    expect(elapsedServerMicros(clock, 1_000)).toBe(0n);
    expect(elapsedServerMicros(clock, 1_500)).toBe(500_000n);
    expect(estimatedServerMicros(clock, 1_500)).toBe(
      clock.evaluatedAtMicros + 500_000n,
    );
  });
  it("treats a backwards or non-finite reading as zero elapsed time", () => {
    expect(elapsedServerMicros(clock, 900)).toBe(0n);
    expect(elapsedServerMicros(clock, Number.NaN)).toBe(0n);
    expect(elapsedServerMicros(clock, Number.POSITIVE_INFINITY)).toBe(0n);
  });
  it("rejects an unparseable server instant or monotonic anchor", () => {
    expect(createServerClock("2026-10-13T00:01:40Z", 1)).toBeNull();
    expect(
      createServerClock("2026-10-13T00:01:40.000000Z", Number.NaN),
    ).toBeNull();
  });
  it("is independent of the device date, timezone and manual clock changes", () => {
    const wrongDevice = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("device clock must not be read");
    });
    expect(elapsedServerMicros(clock, 3_000)).toBe(2_000_000n);
    // 38599 * 2s / 100s = 771.98, truncated to 771.
    expect(projectPendingMicroKrw("38600", projection, 2_000_000n)).toBe(
      "39371",
    );
    expect(wrongDevice).not.toHaveBeenCalled();
  });
  it("after sleep stays at the horizon, then a fresh receipt restarts from the server value", () => {
    // Ten hours of monotonic time pass while the tab sleeps.
    const sleepy = elapsedServerMicros(clock, 1_000 + 36_000_000);
    const frozen = projectPendingMicroKrw("38600", projection, sleepy);
    expect(frozen).toBe(
      projectPendingMicroKrw("38600", projection, 120n * SECOND),
    );
    // Resync: a newer receipt (for example after a settlement) replaces it
    // outright, even though it is lower than what was on screen.
    const fresh = createServerClock("2026-10-13T10:00:05.000000Z", 40_000_000)!;
    expect(
      projectPendingMicroKrw(
        "12000",
        projection,
        elapsedServerMicros(fresh, 40_000_000),
      ),
    ).toBe("12000");
    expect(BigInt("12000") < BigInt(frozen)).toBe(true);
  });
  it("shows the same value after going offline and reconnecting to an unchanged receipt", () => {
    const offline = elapsedServerMicros(clock, 1_000 + 30_000);
    const reconnected = elapsedServerMicros(clock, 1_000 + 30_000);
    expect(projectPendingMicroKrw("38600", projection, offline)).toBe(
      projectPendingMicroKrw("38600", projection, reconnected),
    );
  });
});

describe("fixed truncated amount text", () => {
  it("truncates and never rounds up", () => {
    expect(formatLiveAmountFixed("1234567")).toBe("1.2345원");
    expect(formatLiveAmountFixed("999999")).toBe("0.9999원");
    expect(formatLiveAmountFixed("1234567", 0)).toBe("1원");
    expect(formatLiveAmountFixed("1000000")).toBe("1.0000원");
  });
  it("keeps large integers exact and rejects malformed input", () => {
    expect(formatLiveAmountFixed("9007199254740993000001")).toBe(
      "9,007,199,254,740,993.0000원",
    );
    expect(formatLiveAmountFixed("1.5")).toBe("확인할 수 없어요");
    expect(formatLiveAmountFixed("-1")).toBe("확인할 수 없어요");
  });
});

describe("truthful settlement cue", () => {
  const before = { stateRevision: "10", committedKrw: "12" };
  it("fires only for a newer accepted receipt with more committed KRW", () => {
    expect(
      settlementCueKrw(before, { stateRevision: "11", committedKrw: "15" }),
    ).toBe("3");
  });
  it.each([
    ["initial mount", null, { stateRevision: "11", committedKrw: "15" }],
    ["replayed receipt", before, { stateRevision: "10", committedKrw: "15" }],
    ["older receipt", before, { stateRevision: "9", committedKrw: "20" }],
    ["unchanged total", before, { stateRevision: "11", committedKrw: "12" }],
    ["lower total", before, { stateRevision: "11", committedKrw: "11" }],
    ["malformed total", before, { stateRevision: "11", committedKrw: "1.5" }],
  ])("stays silent for %s", (_name, previous, next) => {
    expect(settlementCueKrw(previous, next)).toBeNull();
  });
});

describe("module boundary", () => {
  it("has no storage, network, timers, randomness or device clock reads", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/product/mining-live-projection.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|setInterval|setTimeout|requestAnimationFrame|Math\.random|Date\.now|new Date\(|performance\.now/,
    );
  });
});
