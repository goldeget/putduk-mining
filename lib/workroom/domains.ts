export const WORKROOM_ORIGINS = {
  member: "https://workroom.putduk.com",
  admin: "https://admin.workroom.putduk.com",
} as const;

const legacyHosts = {
  member: "mining.putduk.com",
  admin: "admin.mining.putduk.com",
} as const;

/** Fixed destinations only. Never infer a trusted origin from forwarded headers. */
export function canonicalWorkroomRedirect(
  requestUrl: string,
  method: string,
  surface: keyof typeof WORKROOM_ORIGINS,
): URL | null {
  if (method !== "GET" && method !== "HEAD") return null;
  try {
    const source = new URL(requestUrl);
    if (
      source.hostname !== legacyHosts[surface] ||
      source.port ||
      source.username ||
      source.password ||
      !["https:", "http:"].includes(source.protocol)
    )
      return null;
    const target = new URL(WORKROOM_ORIGINS[surface]);
    target.pathname = source.pathname;
    target.search = source.search;
    return target;
  } catch {
    return null;
  }
}

// These are the original member proxy paths. Public canonical pages bypass
// session refresh even though the host redirect now also covers their URLs.
const memberSessionPrefixes = [
  "/workroom",
  "/api/v1/workroom",
  "/api/v1/mining",
  "/api/v1/products",
  "/api/v1/events",
  "/home",
  "/start",
  "/mining",
  "/products",
  "/wallet",
  "/events",
  "/notifications",
  "/menu",
  "/api/v1/me",
  "/api/v1/trial",
  "/api/v1/wallet",
  "/api/v1/deposits",
  "/api/v1/withdrawals",
  "/api/v1/notifications",
  "/api/v1/analytics",
  "/api/v1/ai",
  "/api/v1/support",
] as const;
export function isMemberSessionPath(pathname: string): boolean {
  return (
    pathname === "/ai" ||
    memberSessionPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  );
}
