export type PreferenceKey =
  | "events_enabled"
  | "marketing_enabled"
  | "mining_enabled"
  | "service_enabled"
  | "wallet_enabled";
export type NotificationPreferences = Record<PreferenceKey, boolean>;
export const preferenceKeys: readonly PreferenceKey[] = [
  "events_enabled",
  "marketing_enabled",
  "mining_enabled",
  "service_enabled",
  "wallet_enabled",
];

export function isNotificationPreferences(
  value: unknown,
): value is NotificationPreferences {
  return (
    typeof value === "object" &&
    value !== null &&
    preferenceKeys.every(
      (key) => typeof (value as Record<string, unknown>)[key] === "boolean",
    )
  );
}

export function presentNotificationPreferencesRead(
  data: unknown,
  error: unknown,
): {
  state: "loaded" | "empty" | "error";
  preferences: NotificationPreferences | null;
} {
  if (error) return { state: "error", preferences: null };
  if (data === null) return { state: "empty", preferences: null };
  return isNotificationPreferences(data)
    ? { state: "loaded", preferences: data }
    : { state: "error", preferences: null };
}
