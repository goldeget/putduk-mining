import { NextResponse } from "next/server";

import { ADMIN_ROLES } from "@/lib/auth/policy";
import { requireAdminCommand } from "@/lib/auth/principal";
import { recordAdminSecurityEvent } from "@/lib/security/events";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await requireAdminCommand(request, ADMIN_ROLES);
  if (!access.ok) {
    return NextResponse.json(
      { error: { code: access.code } },
      { status: access.status },
    );
  }
  const recorded = await recordAdminSecurityEvent({
    eventType: "ADMIN_MFA_VERIFIED",
    userId: access.principal.userId,
    userAgent: request.headers.get("user-agent"),
  });
  return recorded
    ? NextResponse.json(
        { data: { recorded: true } },
        { headers: { "Cache-Control": "private, no-store" } },
      )
    : NextResponse.json(
        { error: { code: "SECURITY_EVENT_FAILED" } },
        { status: 503 },
      );
}
