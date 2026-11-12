import { NextResponse } from "next/server";
import { requireAdminCommand } from "@/lib/auth/principal";
import { ADMIN_ROLES } from "@/lib/auth/policy";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const result = await requireAdminCommand(request, ADMIN_ROLES);
  const headers = { "Cache-Control": "private, no-store" };
  if (!result.ok)
    return NextResponse.json(
      { error: { code: result.code } },
      { status: result.status, headers },
    );
  return NextResponse.json({ data: { active: true } }, { headers });
}
