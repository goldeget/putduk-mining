import {
  isNotificationPreferences,
  preferenceKeys,
  type NotificationPreferences,
} from "@/lib/product/notification-preferences-read";

export const notificationPreferencesSaveWaitMs = 15_000;

/** Stop waiting for a response locally; this never proves a PATCH rolled back. */
export function waitForNotificationPreferencesSave<T>(
  result: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const pending = Promise.resolve(result);
    const aborted = () =>
      reject(new DOMException("Preference result unavailable", "AbortError"));
    if (signal.aborted) {
      void pending.catch(() => undefined);
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Accept only the existing success envelope and its five displayed booleans. */
export function readNotificationPreferencesSaved(
  payload: unknown,
): NotificationPreferences | null {
  const envelope = record(payload);
  if (
    !envelope ||
    Object.keys(envelope).length !== 1 ||
    !Object.hasOwn(envelope, "data")
  )
    return null;
  const data = record(envelope.data);
  if (
    !data ||
    Object.keys(data).length !== 1 ||
    !Object.hasOwn(data, "preferences") ||
    !isNotificationPreferences(data.preferences)
  )
    return null;
  const saved = data.preferences;
  return Object.fromEntries(
    preferenceKeys.map((key) => [key, saved[key]]),
  ) as NotificationPreferences;
}
