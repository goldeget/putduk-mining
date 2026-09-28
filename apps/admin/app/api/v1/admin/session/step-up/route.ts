import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminCommandFamily } from "@/lib/auth/command-families";
import { hasRecentTotpStepUp, HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { requireAdminCommand } from "@/lib/auth/principal";
import { issueAdminStepUpGrant } from "@/lib/auth/step-up";

const bodySchema = z.object({
  commandFamily: z.string().trim().min(3).max(64),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await requireAdminCommand(request, HIGH_IMPACT_ROLES);
  if (!access.ok) {
    return NextResponse.json(
      { error: { code: access.code } },
      { status: access.status },
    );
  }

  if (!hasRecentTotpStepUp(access.principal.amr)) {
    return NextResponse.json(
      { error: { code: "STEP_UP_REQUIRED" } },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isAdminCommandFamily(parsed.data.commandFamily)) {
    return NextResponse.json(
      { error: { code: "INVALID_COMMAND_FAMILY" } },
      { status: 400 },
    );
  }

  const grant = await issueAdminStepUpGrant({
    adminSessionId: access.principal.adminSessionId,
    userId: access.principal.userId,
    commandFamily: parsed.data.commandFamily,
  });
  if (!grant) {
    return NextResponse.json(
      { error: { code: "STEP_UP_ISSUE_FAILED" } },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      data: {
        grantId: grant.grantId,
        token: grant.token,
        commandFamily: parsed.data.commandFamily,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
