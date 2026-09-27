export const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "CONTENT_ADMIN",
  "SUPPORT_ADMIN",
  "VIEWER",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export const HIGH_IMPACT_ROLES: readonly AdminRole[] = ["SUPER_ADMIN", "ADMIN"];
export const STEP_UP_MAX_AGE_SECONDS = 10 * 60;

export type AuthenticationMethod = { method?: unknown; timestamp?: unknown };

export function isAdminRole(value: unknown): value is AdminRole {
  return (
    typeof value === "string" &&
    (ADMIN_ROLES as readonly string[]).includes(value)
  );
}

export function pickHighestRole(values: readonly unknown[]): AdminRole | null {
  return ADMIN_ROLES.find((role) => values.includes(role)) ?? null;
}

export function hasRecentTotpStepUp(
  methods: readonly AuthenticationMethod[] | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return Boolean(
    methods?.some(
      ({ method, timestamp }) =>
        method === "totp" &&
        typeof timestamp === "number" &&
        timestamp <= nowSeconds &&
        nowSeconds - timestamp <= STEP_UP_MAX_AGE_SECONDS,
    ),
  );
}

export type AdminAccessDecision =
  | "ALLOW"
  | "UNAUTHENTICATED"
  | "ROLE_REQUIRED"
  | "MFA_REQUIRED"
  | "ROLE_FORBIDDEN"
  | "STEP_UP_REQUIRED";

export function decideAdminAccess(input: {
  authenticated: boolean;
  role: AdminRole | null;
  aal: string | null;
  allowedRoles?: readonly AdminRole[];
  recentTotp?: boolean;
}): AdminAccessDecision {
  if (!input.authenticated) return "UNAUTHENTICATED";
  if (!input.role) return "ROLE_REQUIRED";
  if (input.aal !== "aal2") return "MFA_REQUIRED";
  if (input.allowedRoles && !input.allowedRoles.includes(input.role))
    return "ROLE_FORBIDDEN";
  if (input.recentTotp === false) return "STEP_UP_REQUIRED";
  return "ALLOW";
}
