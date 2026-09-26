export const SUPPORTED_LOCALES = ["ko-KR", "ja-JP"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const DISPLAY_TIME_ZONES: Readonly<Record<SupportedLocale, string>> = {
  "ja-JP": "Asia/Tokyo",
  "ko-KR": "Asia/Seoul",
};

export function formatProductDateTime(
  value: Date | string,
  locale: SupportedLocale = "ko-KR",
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("A valid UTC-compatible timestamp is required.");
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONES[locale],
  }).format(date);
}

export function toCanonicalUtcIso(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new RangeError("A valid timestamp is required.");
  }
  return value.toISOString();
}
