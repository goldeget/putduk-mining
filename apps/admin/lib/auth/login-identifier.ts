import "server-only";
import { z } from "zod";
import { createAdminServiceClient } from "../supabase/service";

export const ADMIN_LOGIN_ID = /^[a-z][a-z0-9_]{3,19}$/;
type Resolution = { email: string | null; serviceAvailable: boolean };

/** Identifies a password-login target only. Actual Auth, live roles and MFA grant authority. */
export async function resolveAdminLoginEmail(
  identifier: string,
): Promise<Resolution> {
  const normalized = identifier.trim().toLowerCase();
  const email = z.email().safeParse(normalized);
  if (email.success) return { email: email.data, serviceAvailable: true };
  if (!ADMIN_LOGIN_ID.test(normalized))
    return { email: null, serviceAvailable: true };
  try {
    const service = createAdminServiceClient();
    const alias = await service.rpc("resolve_operator_login_email", {
      p_login_id: normalized,
    });
    if (alias.error) return { email: null, serviceAvailable: false };
    // An error/ambiguous alias must never fall through to a different member identity.
    if (alias.data !== null) {
      const resolved = z
        .email()
        .safeParse(
          typeof alias.data === "string"
            ? alias.data.trim().toLowerCase()
            : alias.data,
        );
      return resolved.success
        ? { email: resolved.data, serviceAvailable: true }
        : { email: null, serviceAvailable: false };
    }
    const member = await service.rpc("resolve_login_email", {
      p_login_id: normalized,
    });
    if (member.error) return { email: null, serviceAvailable: false };
    if (member.data === null) return { email: null, serviceAvailable: true };
    const resolved = z
      .email()
      .safeParse(
        typeof member.data === "string"
          ? member.data.trim().toLowerCase()
          : member.data,
      );
    return resolved.success
      ? { email: resolved.data, serviceAvailable: true }
      : { email: null, serviceAvailable: false };
  } catch {
    return { email: null, serviceAvailable: false };
  }
}
