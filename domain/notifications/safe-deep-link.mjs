const exactRoutes = new Set([
  "/workroom",
  "/workroom/history",
  "/workroom/points",
  "/workroom/guide",
  "/workroom/support",
  "/workroom/cash",
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
export function safeNotificationDeepLink(value) {
  if (
    typeof value === "string" &&
    /^\/(?:(?:workroom\/support|support)\?thread=|workroom\/history\?round=)[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$/.test(
      value,
    )
  )
    return value;
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
