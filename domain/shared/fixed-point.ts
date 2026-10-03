import "server-only";

export const BASIS_POINTS_SCALE = 10_000n;
export const MILLISECONDS_PER_SECOND = 1_000n;

export function assertNonNegative(value: bigint, field: string): void {
  if (value < 0n) {
    throw new RangeError(`${field} must be non-negative.`);
  }
}

export function assertBasisPoints(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
}

export function calculateFixedPointAmount({
  baseRateAtomicPerSecond,
  elapsedMilliseconds,
  multipliersBps,
}: {
  baseRateAtomicPerSecond: bigint;
  elapsedMilliseconds: bigint;
  multipliersBps: readonly number[];
}): bigint {
  assertNonNegative(baseRateAtomicPerSecond, "baseRateAtomicPerSecond");
  assertNonNegative(elapsedMilliseconds, "elapsedMilliseconds");
  multipliersBps.forEach((value, index) =>
    assertBasisPoints(value, `multipliersBps[${index}]`),
  );

  const multiplied = multipliersBps.reduce(
    (value, multiplier) => value * BigInt(multiplier),
    baseRateAtomicPerSecond * elapsedMilliseconds,
  );
  const divisor =
    MILLISECONDS_PER_SECOND *
    BASIS_POINTS_SCALE ** BigInt(multipliersBps.length);

  return multiplied / divisor;
}
