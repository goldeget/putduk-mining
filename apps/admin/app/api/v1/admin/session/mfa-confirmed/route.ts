import { NextResponse } from "next/server";

import { hasAdminAuthServerProof } from "@/lib/auth/failure-limit";
import { ADMIN_ROLES } from "@/lib/auth/policy";
import { getAdminIdentity } from "@/lib/auth/principal";
import { registerAdminAppSession } from "@/lib/auth/session-registry";
import { getAdminEnv } from "@/lib/env";
import { recordAdminSecurityEvent } from "@/lib/security/events";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expectedOrigin = new URL(getAdminEnv().ADMIN_APP_URL).origin;
  if (request.headers.get("origin") !== expectedOrigin) {
    return NextResponse.json(
      { error: { code: "ORIGIN_DENIED" } },
      { status: 403 },
    );
  }

  const identity = await getAdminIdentity();
  if (!identity) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED" } },
      { status: 401 },
    );
  }
  if (!identity.role || !ADMIN_ROLES.includes(identity.role)) {
    return NextResponse.json(
      { error: { code: "ROLE_REQUIRED" } },
      { status: 403 },
    );
  }
  const { data: assurance } =
    await identity.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") {
    return NextResponse.json(
      { error: { code: "MFA_REQUIRED" } },
      { status: 403 },
    );
  }
  if (!identity.sessionId) {
    return NextResponse.json(
      { error: { code: "ADMIN_SESSION_REQUIRED" } },
      { status: 403 },
    );
  }
  const totpProof = await hasAdminAuthServerProof({
    kind: "TOTP",
    userId: identity.userId,
    sessionId: identity.sessionId,
  });
  if (totpProof === null) {
    return NextResponse.json(
      { error: { code: "AUTH_UNAVAILABLE" } },
      { status: 503 },
    );
  }
  if (!totpProof) {
    return NextResponse.json(
      { error: { code: "MFA_REQUIRED" } },
      { status: 403 },
    );
  }

  const adminSessionId = await registerAdminAppSession({
    userId: identity.userId,
    authSessionId: identity.sessionId,
    userAgent: request.headers.get("user-agent"),
  });
  if (!adminSessionId) {
    return NextResponse.json(
      { error: { code: "ADMIN_SESSION_REGISTER_FAILED" } },
      { status: 503 },
    );
  }

  const recorded = await recordAdminSecurityEvent({
    eventType: "ADMIN_MFA_VERIFIED",
    userId: identity.userId,
    userAgent: request.headers.get("user-agent"),
  });
  if (!recorded) {
    return NextResponse.json(
      { error: { code: "SECURITY_EVENT_FAILED" } },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { data: { recorded: true, adminSessionId } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
