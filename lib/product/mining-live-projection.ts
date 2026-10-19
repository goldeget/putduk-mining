/**
 * Presentation-only projection of the server's "정산 전" (pending) amount.
 *
 * Authority boundary
 * - Every input is a value the server already issued in the same receipt
 *   (pending, reward carry, accepted cursor, evaluation instant, remaining
 *   capacity, cycle end). The browser never reads a rate, formula or policy.
 * - The server-side caller derives the profile once per receipt; the client only
 *   evaluates it against a monotonic elapsed time since the receipt arrived.
 * - All money is bigint micro-KRW. Floating point is used for time only, and is
 *   converted to integer microseconds before it touches money.
 * - Every rounding step rounds toward LESS money, so the display can never be
 *   ahead of the server's own evaluation of the same instant.
 *
 * The device wall clock is never read. Elapsed time comes from a monotonic clock
 * that starts at the instant a server receipt was received, so a wrong device
 * date, a timezone change or a manual clock edit cannot move the amount.
 */

const MICRO_KRW_PER_KRW = 1_000_000n;
const INTEGER_TEXT = /^(0|[1-9][0-9]*)$/;
const POSITIVE_INTEGER_TEXT = /^[1-9][0-9]*$/;

/** Below this accrued amount the observed window is too noisy to extrapolate. */
export const LIVE_PROJECTION_MIN_ACCRUED_MICRO_KRW = 10_000n;
/** A receipt may be extrapolated for at most this long (two minutes). */
export const LIVE_PROJECTION_HORIZON_MICROS = 120_000_000n;
/** The headline pending amount shows this many decimals, truncated, never rounded up. */
export const LIVE_AMOUNT_DECIMALS = 4;

export type MiningLiveProjection = {
  /** Server accrual observed inside the window, reduced by one micro for truncation. */
  accruedMicroKrw: string;
  /** Server interval the accrual was observed over, in microseconds. */
  windowMicros: string;
  /** Pending can never be shown above this server-issued bound. */
  ceilingMicroKrw: string;
  /** Maximum extrapolation after receipt, in microseconds. */
  horizonMicros: string;
};

export type LiveProjectionInput = {
  status: "ACTIVE" | "STOPPED";
  pendingMicroKrw: string;
  remainingMicroKrw: string;
  /** Exact KRW carry ratio that opened the accrual window. */
  carry: { numerator: string; denominator: string };
  acceptedCursorAt: string;
  evaluatedAt: string;
  cycleEnd: string;
};

/** Microseconds since epoch from a six-digit server instant, or null. */
export function parseServerInstantMicros(value: string): bigint | null {
  const match = /\.([0-9]{6})(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(value);
  if (!match) return null;
  const milliseconds = Date.parse(value.slice(0, match.index) + match[2]);
  return Number.isFinite(milliseconds)
    ? BigInt(milliseconds) * 1000n + BigInt(match[1]!)
    : null;
}

/**
 * Server-side derivation. Returns null whenever the observed window cannot
 * support an honest extrapolation, in which case the UI stays flat.
 */
export function deriveLiveProjection(
  input: LiveProjectionInput,
): MiningLiveProjection | null {
  if (input.status !== "ACTIVE") return null;
  if (
    !INTEGER_TEXT.test(input.pendingMicroKrw) ||
    !INTEGER_TEXT.test(input.remainingMicroKrw) ||
    !INTEGER_TEXT.test(input.carry.numerator) ||
    !POSITIVE_INTEGER_TEXT.test(input.carry.denominator)
  )
    return null;
  const cursor = parseServerInstantMicros(input.acceptedCursorAt);
  const evaluated = parseServerInstantMicros(input.evaluatedAt);
  const end = parseServerInstantMicros(input.cycleEnd);
  if (cursor === null || evaluated === null || end === null) return null;

  const window = evaluated - cursor;
  const untilCycleEnd = end - evaluated;
  if (window <= 0n || untilCycleEnd <= 0n) return null;

  const pending = BigInt(input.pendingMicroKrw);
  const remaining = BigInt(input.remainingMicroKrw);
  if (remaining === 0n) return null;
  const carryMicro =
    (BigInt(input.carry.numerator) * MICRO_KRW_PER_KRW) /
    BigInt(input.carry.denominator);
  // Pending and carry are each truncated by up to one micro: subtract one more
  // so the slope can only be under-stated.
  const accrued = pending - carryMicro - 1n;
  if (accrued < LIVE_PROJECTION_MIN_ACCRUED_MICRO_KRW) return null;

  const horizon =
    untilCycleEnd < LIVE_PROJECTION_HORIZON_MICROS
      ? untilCycleEnd
      : LIVE_PROJECTION_HORIZON_MICROS;
  return {
    accruedMicroKrw: accrued.toString(),
    windowMicros: window.toString(),
    ceilingMicroKrw: (pending + remaining).toString(),
    horizonMicros: horizon.toString(),
  };
}

/** Strictly validates a projection coming from the wire. */
export function isMiningLiveProjection(
  value: unknown,
): value is MiningLiveProjection {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v).sort().join(",");
  return (
    keys === "accruedMicroKrw,ceilingMicroKrw,horizonMicros,windowMicros" &&
    typeof v.accruedMicroKrw === "string" &&
    POSITIVE_INTEGER_TEXT.test(v.accruedMicroKrw) &&
    typeof v.windowMicros === "string" &&
    POSITIVE_INTEGER_TEXT.test(v.windowMicros) &&
    typeof v.ceilingMicroKrw === "string" &&
    INTEGER_TEXT.test(v.ceilingMicroKrw) &&
    typeof v.horizonMicros === "string" &&
    POSITIVE_INTEGER_TEXT.test(v.horizonMicros)
  );
}

/**
 * Server-offset clock. The anchor is the server `evaluatedAt` of one receipt and
 * the monotonic reading taken when that response finished arriving. Using the
 * arrival time (not the request start) can only under-state elapsed time.
 */
export type ServerClock = Readonly<{
  evaluatedAtMicros: bigint;
  receivedAtMonotonicMs: number;
}>;

export function createServerClock(
  evaluatedAt: string,
  receivedAtMonotonicMs: number,
): ServerClock | null {
  const evaluatedAtMicros = parseServerInstantMicros(evaluatedAt);
  if (evaluatedAtMicros === null || !Number.isFinite(receivedAtMonotonicMs))
    return null;
  return { evaluatedAtMicros, receivedAtMonotonicMs };
}

/** Elapsed server microseconds since evaluation; never negative, never NaN. */
export function elapsedServerMicros(
  clock: ServerClock,
  nowMonotonicMs: number,
): bigint {
  const delta = nowMonotonicMs - clock.receivedAtMonotonicMs;
  if (!Number.isFinite(delta) || delta <= 0) return 0n;
  return BigInt(Math.floor(delta * 1000));
}

/** Estimated server instant for diagnostics; derived from the offset, not the device date. */
export function estimatedServerMicros(
  clock: ServerClock,
  nowMonotonicMs: number,
): bigint {
  return clock.evaluatedAtMicros + elapsedServerMicros(clock, nowMonotonicMs);
}

/**
 * Pending shown after `elapsedMicros`. Monotonic non-decreasing in elapsed time,
 * equal to the server value at 0, flat after the horizon, and never above the
 * server-issued ceiling.
 */
export function projectPendingMicroKrw(
  pendingMicroKrw: string,
  projection: MiningLiveProjection,
  elapsedMicros: bigint,
): string {
  const pending = BigInt(pendingMicroKrw);
  const horizon = BigInt(projection.horizonMicros);
  const bounded =
    elapsedMicros <= 0n
      ? 0n
      : elapsedMicros < horizon
        ? elapsedMicros
        : horizon;
  const added =
    (BigInt(projection.accruedMicroKrw) * bounded) /
    BigInt(projection.windowMicros);
  const ceiling = BigInt(projection.ceilingMicroKrw);
  const shown = pending + added;
  return (shown > ceiling ? ceiling : shown).toString();
}

/**
 * The one micro-KRW text formatter for live mining amounts.
 * Without `fixedDecimals` it is exact (trailing zeros trimmed). With it the text
 * has a fixed width and is truncated, never rounded up.
 */
export function formatMicroKrwText(
  microKrw: string,
  fixedDecimals?: number,
): string {
  if (!INTEGER_TEXT.test(microKrw)) return "확인할 수 없어요";
  const micro = BigInt(microKrw);
  const wholeText = (micro / MICRO_KRW_PER_KRW).toLocaleString("ko-KR");
  const digits = (micro % MICRO_KRW_PER_KRW).toString().padStart(6, "0");
  if (fixedDecimals === undefined) {
    const fraction = digits.replace(/0+$/, "");
    return `${wholeText}${fraction ? `.${fraction}` : ""}원`;
  }
  const places = Math.min(6, Math.max(0, Math.floor(fixedDecimals)));
  return places === 0
    ? `${wholeText}원`
    : `${wholeText}.${digits.slice(0, places)}원`;
}

/** Fixed-width truncated KRW text such as `1,234.5678원`. Truncates; never rounds up. */
export function formatLiveAmountFixed(
  microKrw: string,
  decimals: number = LIVE_AMOUNT_DECIMALS,
): string {
  return formatMicroKrwText(microKrw, decimals);
}

/**
 * A settlement cue exists only when a newer accepted server receipt shows more
 * committed KRW than the previous accepted receipt of this session. Returns the
 * difference in whole KRW, or null. Replays, older receipts, equal or lower
 * totals and initial mounts never produce a cue.
 */
export function settlementCueKrw(
  previous: { stateRevision: string; committedKrw: string } | null,
  next: { stateRevision: string; committedKrw: string },
): string | null {
  if (!previous) return null;
  if (
    !INTEGER_TEXT.test(previous.stateRevision) ||
    !INTEGER_TEXT.test(next.stateRevision) ||
    !INTEGER_TEXT.test(previous.committedKrw) ||
    !INTEGER_TEXT.test(next.committedKrw)
  )
    return null;
  if (BigInt(next.stateRevision) <= BigInt(previous.stateRevision)) return null;
  const delta = BigInt(next.committedKrw) - BigInt(previous.committedKrw);
  return delta > 0n ? delta.toString() : null;
}
