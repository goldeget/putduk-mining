const SAFE_ADMIN_PATHS = [
  "/",
  "/assistant",
  "/ai-conversations",
  "/content",
  "/members",
  "/support",
  "/notifications",
  "/deposits/usdt",
  "/deposits/krw",
  "/withdrawals/krw-bank",
  "/withdrawals/usdt",
  "/kyc",
  "/exceptions",
  "/restrictions",
  "/economy",
  "/session-expired",
  "/reauth",
  "/unauthorized",
] as const;

export function safeAdminReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/";
  }
  try {
    const url = new URL(value, "https://admin.workroom.putduk.com");
    if (url.origin !== "https://admin.workroom.putduk.com") return "/";
    return SAFE_ADMIN_PATHS.some(
      (path) =>
        url.pathname === path ||
        (path !== "/" &&
          path !== "/assistant" &&
          url.pathname.startsWith(`${path}/`)),
    )
      ? `${url.pathname}${url.search}`
      : "/";
  } catch {
    return "/";
  }
}

export function adminLoginPath(returnPath: string): string {
  const safe = safeAdminReturnPath(returnPath);
  return safe === "/"
    ? "/login"
    : `/login?returnTo=${encodeURIComponent(safe)}`;
}
