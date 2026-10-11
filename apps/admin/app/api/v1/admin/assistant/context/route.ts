import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { readBoundedJsonBody } from "../../../../../../../../lib/api/request-body";
import { assistantContextInput } from "@/lib/assistant/context";
import { readAssistantContext } from "@/lib/assistant/context-read";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { requireAdminCommand } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};
function failure(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: PRIVATE_HEADERS },
  );
}
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await requireAdminCommand(request, HIGH_IMPACT_ROLES);
  if (!access.ok)
    return failure(
      access.code,
      "운영자 접속을 다시 확인해 주세요.",
      access.status,
    );
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return failure("INVALID_INPUT", "확인할 업무를 다시 선택해 주세요.", 400);
  const body = await readBoundedJsonBody(request, 1_024);
  if (!body.ok)
    return failure(
      body.code,
      "요청 내용을 다시 확인해 주세요.",
      body.code === "PAYLOAD_TOO_LARGE" ? 413 : 400,
    );
  const input = assistantContextInput.safeParse(body.value);
  if (!input.success)
    return failure(
      "INVALID_INPUT",
      "확인할 업무와 대상을 다시 선택해 주세요.",
      400,
    );
  try {
    const db = createAdminServiceClient();
    const audit = await db.from("audit_logs").insert({
      actor_user_id: access.principal.userId,
      actor_role: access.principal.role,
      action: "ADMIN_ASSISTANT_CONTEXT_READ",
      target_type: "ASSISTANT_CONTEXT",
      target_id:
        "userId" in input.data
          ? input.data.userId
          : "recordId" in input.data
            ? input.data.recordId
            : null,
      reason: "운영 도우미에서 기록 기반 설명 조회",
      request_id: randomUUID(),
      metadata: { surface: "admin_assistant", topic: input.data.topic },
    });
    if (audit.error)
      return failure(
        "AUDIT_UNAVAILABLE",
        "조회 기록을 남기지 못해 정보를 열지 않았습니다. 다시 시도해 주세요.",
        503,
      );
    const report = await readAssistantContext(db, input.data);
    return NextResponse.json({ data: report }, { headers: PRIVATE_HEADERS });
  } catch {
    return failure(
      "READ_UNAVAILABLE",
      "운영 기록을 확인하지 못했습니다. 다시 시도해 주세요.",
      503,
    );
  }
}
