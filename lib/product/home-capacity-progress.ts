import type { MiningServerDisplay } from "./mining-server-display";

/** Display ratio only. The server owns every capacity amount and economic rule. */
export function presentHomeCapacityProgress(
  display: MiningServerDisplay | null | undefined,
  unavailable = false,
): { usedBps: number; usedLabel: string } | null {
  if (unavailable || !display?.available) return null;
  const amounts = [
    display.effective_capacity_micro_krw,
    display.used_capacity_micro_krw,
    display.remaining_capacity_micro_krw,
  ];
  if (amounts.some((value) => value == null || !/^\d+$/.test(value)))
    return null;
  const [capacity, used, remaining] = amounts.map((value) => BigInt(value!));
  if (
    capacity! <= 0n ||
    used! > capacity! ||
    remaining! > capacity! ||
    used! + remaining! > capacity! ||
    capacity! - used! - remaining! > 1n
  )
    return null;

  // The server independently truncates exact rational capacity/used/remaining
  // to micro-KRW. A conserved triple can therefore have a one-micro remainder;
  // larger deficits and any surplus remain contradictory. Do not alter amounts.
  // Convert only the bounded display ratio, never the underlying money.
  const bps = (used! * 10_000n) / capacity!;
  const fraction = (bps % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  const percent = `${bps / 100n}${fraction ? `.${fraction}` : ""}`;
  return {
    usedBps: Number(bps),
    usedLabel:
      used! > 0n && bps === 0n ? "0.01% 미만 사용" : `${percent}% 사용`,
  };
}
