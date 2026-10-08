const exactRoutes = new Set([
  "/",
  "/home",
  "/start",
  "/mining",
  "/wallet",
  "/wallet/deposit",
  "/wallet/withdraw",
  "/products",
  "/products/allocation",
  "/events",
  "/notifications",
  "/menu",
  "/menu/account",
  "/menu/notifications",
  "/support",
  "/ai",
]);
/** Approved navigations only; no auth actions, commands, ambiguous encodings or private query receipts. */
export function safeNotificationDeepLink(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\%?#\s\u0000-\u001f\u007f]/.test(value)
  )
    return null;
  if (exactRoutes.has(value)) return value;
  return /^\/events\/(?:notices\/)?[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    ? value
    : null;
}
