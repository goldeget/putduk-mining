/** Percent text is display input only; transport uses exact integer basis points. */
export function allocationPercentToBps(value: string): string | null {
  const match = /^(0|[1-9][0-9]{0,2})(?:\.([0-9]{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const bps =
    BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return bps > 0n && bps <= 10000n ? bps.toString() : null;
}
export function allocationBpsToPercent(value: string): string {
  if (!/^[1-9][0-9]{0,4}$/.test(value) || BigInt(value) > 10000n)
    throw new Error("INVALID_ALLOCATION_BPS");
  const bps = BigInt(value);
  return `${bps / 100n}${bps % 100n === 0n ? "" : `.${(bps % 100n).toString().padStart(2, "0").replace(/0$/, "")}`}`;
}
