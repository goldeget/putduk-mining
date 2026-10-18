type UsageWindow = {
  used: number;
  limit: number;
  nextAvailableAt: string | null;
};

export type OwnUsage = {
  ownerId: string;
  observedAt: string;
  providerAttempts?: unknown;
  rolling24h: UsageWindow;
  rollingMinute: UsageWindow;
};

/** Consume the same { data } envelope emitted by apiSuccess; unknown reads stay unknown. */
export function readOwnUsageResponse(
  value: unknown,
  ownerId: string,
): OwnUsage | null {
  if (!value || typeof value !== "object" || !("data" in value)) return null;
  if (!value.data || typeof value.data !== "object") return null;
  const data = value.data as Partial<OwnUsage>;
  if (
    data.ownerId !== ownerId ||
    typeof data.observedAt !== "string" ||
    !Number.isFinite(Date.parse(data.observedAt))
  )
    return null;
  for (const window of [data.rolling24h, data.rollingMinute]) {
    if (
      !window ||
      !Number.isSafeInteger(window.used) ||
      window.used < 0 ||
      !Number.isSafeInteger(window.limit) ||
      window.limit < 1 ||
      (window.nextAvailableAt !== null &&
        (typeof window.nextAvailableAt !== "string" ||
          !Number.isFinite(Date.parse(window.nextAvailableAt))))
    )
      return null;
  }
  return data as OwnUsage;
}
