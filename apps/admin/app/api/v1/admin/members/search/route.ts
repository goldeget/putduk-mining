import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { readBoundedJsonBody } from "../../../../../../../../lib/api/request-body";
import { ADMIN_ROLES } from "@/lib/auth/policy";
import { requireAdminCommand } from "@/lib/auth/principal";
import {
  normalizeMemberSearch,
  MEMBER_SEARCH_LIMIT,
} from "@/lib/members/search";
import { readMemberSearch } from "@/lib/members/search-read";
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
  // Preserve Member 360's existing role set. This allows masked identity lookup, never KYC access.
  const access = await requireAdminCommand(request, ADMIN_ROLES);
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
    return failure("INVALID_INPUT", "검색어를 다시 확인해 주세요.", 400);
  const body = await readBoundedJsonBody(request, 512);
  if (!body.ok)
    return failure(
      body.code,
      "검색어를 다시 확인해 주세요.",
      body.code === "PAYLOAD_TOO_LARGE" ? 413 : 400,
    );
  const value =
    body.value && typeof body.value === "object" && "query" in body.value
      ? body.value.query
      : null;
  const input = normalizeMemberSearch(value);
  if (!input)
    return failure(
      "INVALID_INPUT",
      "이름이나 아이디를 두 글자 이상 입력하거나 전화번호 전체를 적어 주세요.",
      400,
    );
  try {
    const db = createAdminServiceClient();
    const audit = await db.from("audit_logs").insert({
      actor_user_id: access.principal.userId,
      actor_role: access.principal.role,
      action: "ADMIN_MEMBER_SEARCH",
      target_type: "MEMBER_SEARCH",
      reason: "회원 검색에서 마스킹된 식별 정보 조회",
      request_id: randomUUID(),
      metadata: {
        surface: "admin_member_search",
        kind: input.kind,
        limit: MEMBER_SEARCH_LIMIT,
        fields: ["masked_name", "masked_login_id", "masked_phone", "user_id"],
      },
    });
    if (audit.error)
      return failure(
        "AUDIT_UNAVAILABLE",
        "조회 기록을 남기지 못해 회원 정보를 열지 않았습니다. 다시 시도해 주세요.",
        503,
      );
    const result = await readMemberSearch(db, input);
    return NextResponse.json({ data: result }, { headers: PRIVATE_HEADERS });
  } catch {
    return failure(
      "READ_UNAVAILABLE",
      "회원 검색 결과를 불러오지 못했습니다. 다시 시도해 주세요.",
      503,
    );
  }
}
