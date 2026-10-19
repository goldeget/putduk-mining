import { deriveLiveProjection } from "../../../lib/product/mining-live-projection";

/**
 * Synthetic stand-in for the member mining display server. It exists only in
 * this local fixture harness: no real member, money, policy or backend. It uses
 * its own clock to play the part of the server and issues the same receipt shape
 * as `/api/v1/mining/display`, including the server-derived projection.
 */
const parameters = new URLSearchParams(window.location.search);
const loadedAt = Date.now();
const RATE_MICRO_KRW_PER_SECOND = 386n;
const CAPACITY_MICRO_KRW = 1_000_000_000n;
const USED_BEFORE_PENDING_MICRO_KRW = 200_000_000n;
const cycleStartMs = loadedAt - 18 * 86_400_000;
const cycleEndMs = cycleStartMs + 30 * 86_400_000;

function instant(milliseconds) {
  return new Date(milliseconds).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

export const fixtureOwner = parameters.get("owner") ?? "fixture-owner";

/** `?settle=1` simulates the worker accepting a receipt 25 s after load. */
export function buildFixtureSnapshot(now = Date.now()) {
  const settled = parameters.has("settle") && now - loadedAt > 25_000;
  const cursorMs = settled ? loadedAt + 25_000 : loadedAt - 100_000;
  const pending = (RATE_MICRO_KRW_PER_SECOND * BigInt(now - cursorMs)) / 1000n;
  const used = USED_BEFORE_PENDING_MICRO_KRW + pending;
  const remaining = CAPACITY_MICRO_KRW - used;
  const base = {
    scope: "GLOBAL_CYCLE",
    cycleStartedAt: instant(cycleStartMs),
    cycleEnd: instant(cycleEndMs),
    stateRevision: settled ? "11" : "10",
    conditionRevision: "2",
    acceptedCursorAt: instant(cursorMs),
    evaluatedAt: instant(now),
    status: "ACTIVE",
    stopReason: null,
    pendingMicroKrw: pending.toString(),
    committedKrw: settled ? "15" : "12",
    capacityMicroKrw: CAPACITY_MICRO_KRW.toString(),
    usedMicroKrw: used.toString(),
    remainingMicroKrw: remaining.toString(),
  };
  return {
    ...base,
    projection:
      deriveLiveProjection({
        status: "ACTIVE",
        pendingMicroKrw: base.pendingMicroKrw,
        remainingMicroKrw: base.remainingMicroKrw,
        carry: { numerator: "0", denominator: "1" },
        acceptedCursorAt: base.acceptedCursorAt,
        evaluatedAt: base.evaluatedAt,
        cycleEnd: base.cycleEnd,
      }) ?? null,
  };
}

export function miningDisplayResponse() {
  return Response.json({
    data: { ownerId: fixtureOwner, snapshot: buildFixtureSnapshot() },
  });
}
