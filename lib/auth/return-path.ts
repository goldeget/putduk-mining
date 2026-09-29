export const PROTECTED_PAGE_PATHS = [
  "/home",
  "/start",
  "/mining",
  "/notifications",
  "/ai",
] as const;

/** `/events`와 `/events/[slug]` 딥링크 반환을 함께 보존한다. */
export const PROTECTED_PAGE_PREFIXES = [
  "/wallet",
  "/menu",
  "/events",
] as const;

export function isSafeProtectedReturnPath(value: string): boolean {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes("#")
  ) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, "https://return-path.invalid");
  } catch {
    return false;
  }

  if (parsed.origin !== "https://return-path.invalid") {
    return false;
  }

  return (
    PROTECTED_PAGE_PATHS.some((path) => parsed.pathname === path) ||
    PROTECTED_PAGE_PREFIXES.some(
      (prefix) =>
        parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`),
    )
  );
}

export function safeProtectedReturnPath(
  value: string | null | undefined,
  fallback = "/home",
): string {
  return value && isSafeProtectedReturnPath(value) ? value : fallback;
}

export function buildLoginPath(returnPath: string): string {
  return `/login?next=${encodeURIComponent(
    safeProtectedReturnPath(returnPath),
  )}`;
}
