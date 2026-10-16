import manifest from "./staging-target.json";

const target = Object.freeze({ ...manifest });

/** Public identifiers only. Changing this target requires a reviewed candidate. */
function reviewedTarget() {
  if (
    !target ||
    target.version !== 1 ||
    target.purpose !== "protected-staging" ||
    target.parentProjectRef !== "osrmyjgmpdspdcwqjwuv" ||
    !/^[a-z0-9]{20}$/.test(target.projectRef) ||
    target.projectRef === target.parentProjectRef ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(target.branchId) ||
    target.apiOrigin !== `https://${target.projectRef}.supabase.co` ||
    !validAppOrigin(target.memberOrigin) ||
    !validAppOrigin(target.adminOrigin) ||
    target.memberOrigin === target.adminOrigin ||
    !Number.isFinite(Date.parse(target.expiresAt))
  )
    throw new Error("STAGING_TARGET_NOT_ADMITTED");
  return target;
}

function validAppOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value === url.origin &&
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !["putduk.com", "mining.putduk.com", "admin.mining.putduk.com"].includes(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}

/** Keep the direct expression: Next inlines it into each browser build. */
export function isStagingBuild(): boolean {
  return process.env.NEXT_PUBLIC_APP_ENV === "staging";
}

export function isReviewedStagingUrl(value: string): boolean {
  try {
    const admitted = reviewedTarget();
    const url = new URL(value);
    return (
      url.origin === admitted.apiOrigin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      ["", "/"].includes(url.pathname)
    );
  } catch {
    return false;
  }
}

function legacyClaims(value: string): { role?: unknown; ref?: unknown } | null {
  const parts = value.split(".");
  if (
    parts.length !== 3 ||
    !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
  )
    return null;
  try {
    const payload: unknown = JSON.parse(
      atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : null;
  } catch {
    return null;
  }
}

export function isReviewedStagingPublicKey(value: string): boolean {
  try {
    const admitted = reviewedTarget();
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
    const claims = legacyClaims(value);
    return claims?.role === "anon" && claims.ref === admitted.projectRef;
  } catch {
    return false;
  }
}

/**
 * Called by server env readers before constructing member/admin clients.
 * The server clock closes admission; a browser clock is never that authority.
 * Opaque key ownership must also be verified against the exact branch at setup.
 */
export function assertStagingServerEnvironment(input: {
  appEnv: string | undefined;
  supabaseUrl: string;
  appUrl: string;
  surface: "member" | "admin";
  secretKey?: string;
}): void {
  if (input.appEnv !== "staging" && !isStagingBuild()) return;
  if (
    input.appEnv !== "staging" ||
    !isStagingBuild() ||
    !isReviewedStagingUrl(input.supabaseUrl)
  )
    throw new Error("STAGING_TARGET_MODE_OR_URL_REJECTED");
  const admitted = reviewedTarget();
  const expectedOrigin =
    input.surface === "member"
      ? admitted.memberOrigin
      : input.surface === "admin"
        ? admitted.adminOrigin
        : null;
  try {
    const url = new URL(input.appUrl);
    if (
      url.origin !== expectedOrigin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/"].includes(url.pathname)
    )
      throw new Error("STAGING_APP_ORIGIN_REJECTED");
  } catch {
    throw new Error("STAGING_APP_ORIGIN_REJECTED");
  }
  if (Date.now() >= Date.parse(admitted.expiresAt))
    throw new Error("STAGING_TARGET_EXPIRED");
  if (input.secretKey !== undefined) {
    const claims = legacyClaims(input.secretKey);
    if (
      !/^sb_secret_[A-Za-z0-9_-]+$/.test(input.secretKey) &&
      !(claims?.role === "service_role" && claims.ref === admitted.projectRef)
    )
      throw new Error("STAGING_SERVER_KEY_REJECTED");
  }
}
