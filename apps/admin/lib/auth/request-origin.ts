import "server-only";

import { getAdminEnv } from "@/lib/env";

/** Compare only the configured admin origin, never an untrusted host header. */
export function hasAdminCommandOrigin(
  requestHeaders: Pick<Headers, "get">,
): boolean {
  const expectedOrigin = new URL(getAdminEnv().ADMIN_APP_URL).origin;
  return requestHeaders.get("origin") === expectedOrigin;
}
