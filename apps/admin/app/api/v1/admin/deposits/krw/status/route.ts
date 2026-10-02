import { NextResponse } from "next/server";
import { z } from "zod";

import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { requireAdminCommand } from "@/lib/auth/principal";
import { loadKrwDepositReceipt } from "@/lib/deposits/krw-queue";

const bodySchema = z
  .object({
    depositRequestId: z.uuid(),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await requireAdminCommand(request, HIGH_IMPACT_ROLES);
  if (!access.ok) {
    return NextResponse.json(
      { error: { code: access.code, message: "이 작업을 실행할 수 없습니다." } },
      { status: access.status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_APPROVAL_REQUEST",
          message: "입금 요청을 확인해 주세요.",
        },
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const receipt = await loadKrwDepositReceipt(parsed.data.depositRequestId);
  if (!receipt) {
    return NextResponse.json(
      {
        error: {
          code: "DEPOSIT_NOT_APPROVABLE",
          message: "입금 상태를 확인하지 못했습니다.",
        },
      },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.json(
    { data: receipt },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
