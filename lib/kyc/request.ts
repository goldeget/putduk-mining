import "server-only";
import { getPublicEnv } from "@/lib/env/public";

export function hasKycOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  try {
    return (
      request.headers.get("origin") ===
        new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).origin &&
      (site === null || site === "same-origin" || site === "none")
    );
  } catch {
    return false;
  }
}
