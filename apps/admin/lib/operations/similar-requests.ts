export type PendingRequestReference = {
  id: string;
  userId: string;
  method: string;
  amount: string | number;
};

function exactAmount(value: string | number): string | null {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const text = String(value);
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return null;
  const [integer = "", fraction = ""] = text.split(".");
  return `${BigInt(integer)}.${fraction.replace(/0+$/, "")}`;
}

/** Displayed pending requests only; similarity is not evidence of duplicate transfer. */
export function similarPendingRequests(
  rows: readonly PendingRequestReference[],
): ReadonlyMap<string, number> {
  const groups = new Map<string, Set<string>>();
  const keys = new Map<string, string>();
  for (const row of rows) {
    const amount = exactAmount(row.amount);
    if (!amount || !row.userId || !row.method) continue;
    const key = JSON.stringify([row.userId, row.method, amount]);
    const ids = groups.get(key) ?? new Set<string>();
    ids.add(row.id);
    groups.set(key, ids);
    keys.set(row.id, key);
  }
  const result = new Map<string, number>();
  for (const [id, key] of keys) {
    const count = groups.get(key)?.size ?? 0;
    if (count > 1) result.set(id, count);
  }
  return result;
}
