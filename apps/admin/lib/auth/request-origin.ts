import "server-only";

import { getAdminEnv } from "@/lib/env";

/** Compare only the configured admin origin, never an untrusted host header. */
export function hasAdminCommandOrigin(
  requestHeaders: Pick<Headers, "get">,
): boolean {
  const adminEnv = getAdminEnv();
  const expectedOrigin = new URL(adminEnv.ADMIN_APP_URL).origin;
  const requestOrigin = requestHeaders.get("origin");
  if (requestOrigin === expectedOrigin) return true;

  // The isolated workerd preview has one exact loopback origin; production never enables this.
  return (
    adminEnv.APP_ENV === "test" &&
    requestOrigin === "http://127.0.0.1:3100"
  );
}
