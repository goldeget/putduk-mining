import "server-only";
import { getVerifiedIdentity } from "@/lib/auth/session";

const SESSION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Shared verified identity only. Each domain still enforces its live DB admission. */
export async function getVerifiedMemberSession() {
  const identity = await getVerifiedIdentity();
  if (!identity) return null;
  const [
    { data: user, error: userError },
    { data: claims, error: claimsError },
  ] = await Promise.all([
    identity.supabase.auth.getUser(),
    identity.supabase.auth.getClaims(),
  ]);
  const session = claims?.claims?.session_id;
  if (
    userError ||
    claimsError ||
    user.user?.id !== identity.userId ||
    claims?.claims?.sub !== identity.userId ||
    typeof session !== "string" ||
    !SESSION_UUID.test(session)
  )
    return null;
  return {
    supabase: identity.supabase,
    userId: identity.userId,
    authSessionId: session.toLowerCase(),
  };
}
