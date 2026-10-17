import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  ADMIN_AI_READ_ROLES,
  adminAiReadInputSchema,
  adminAiSearchResultSchema,
  adminAiListResultSchema,
  adminAiMessagesResultSchema,
  redactAdminAiCredentials,
} from "../../../../domain/ai/admin-conversation";
import { readBoundedJsonBody } from "../../../../lib/api/request-body";
import { requireAdminCommand } from "../auth/principal";
import { normalizeMemberSearch } from "../members/search";
import { createAdminServiceClient } from "../supabase/service";

const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Origin",
  "X-Content-Type-Options": "nosniff",
};
function failure(code: string, status: number, requestId: string) {
  return Response.json(
    {
      error: {
        code,
        message:
          "대화 기록을 열지 못했습니다. 접속 권한과 조회 조건을 확인해 주세요.",
      },
      requestId,
    },
    { status, headers },
  );
}
const receipt = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), code: z.string().regex(/^[A-Z_]{1,80}$/) }),
]);

async function auditDenial(
  db: SupabaseClient,
  code: string,
  requestId: string,
) {
  // No query, body, credentials or unverified actor identity is written to audit.
  const result = await db.from("audit_logs").insert({
    actor_user_id: null,
    actor_role: null,
    action: "ADMIN_AI_READ_DENIED",
    target_type: "AI_CONVERSATION",
    reason: "상담 기록 접근 제한",
    request_id: requestId,
    metadata: { surface: "admin_ai_conversations", code },
  });
  return !result.error;
}

/** Only this authenticated backend may call the atomic role/session/audit/read RPC. */
export async function handleAdminAiConversationRead(
  request: Request,
): Promise<Response> {
  const requestId = randomUUID();
  try {
    const access = await requireAdminCommand(request, ADMIN_AI_READ_ROLES);
    const db = createAdminServiceClient();
    if (!access.ok) {
      if (!(await auditDenial(db, access.code, requestId)))
        return failure("AUDIT_UNAVAILABLE", 503, requestId);
      return failure(access.code, access.status, requestId);
    }
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return failure("INVALID_INPUT", 400, requestId);
    const body = await readBoundedJsonBody(request, 2048);
    if (!body.ok)
      return failure(
        body.code,
        body.code === "PAYLOAD_TOO_LARGE" ? 413 : 400,
        requestId,
      );
    const parsed = adminAiReadInputSchema.safeParse(body.value);
    if (!parsed.success) return failure("INVALID_INPUT", 400, requestId);
    const input = parsed.data;
    const normalizedSearch =
      input.operation === "SEARCH" ? normalizeMemberSearch(input.query) : null;
    if (input.operation === "SEARCH" && !normalizedSearch)
      return failure("INVALID_INPUT", 400, requestId);
    const { data, error } = await db.rpc("admin_read_ai_conversations", {
      p_actor: access.principal.userId,
      p_admin_session_id: access.principal.adminSessionId,
      p_request_id: requestId,
      p_operation: input.operation,
      p_input: input.operation === "SEARCH" ? normalizedSearch : input,
    });
    // A missing migration, grant, audit or malformed receipt never falls back to direct table reads.
    const result = receipt.safeParse(data);
    if (error || !result.success)
      return failure("READ_UNAVAILABLE", 503, requestId);
    if (!result.data.ok) {
      const code = result.data.code;
      const denied = [
        "ROLE_FORBIDDEN",
        "ADMIN_SESSION_REVOKED",
        "ADMIN_SESSION_EXPIRED",
        "ADMIN_SESSION_REQUIRED",
      ];
      return failure(
        code,
        denied.includes(code) ? 403 : code === "NOT_FOUND" ? 404 : 503,
        requestId,
      );
    }
    let output: unknown;
    if (input.operation === "SEARCH") {
      const search = adminAiSearchResultSchema.safeParse(result.data.data);
      if (!search.success) return failure("READ_UNAVAILABLE", 503, requestId);
      output = search.data;
    } else if (input.operation === "LIST") {
      const list = adminAiListResultSchema.safeParse(result.data.data);
      if (
        !list.success ||
        list.data.conversations.length > input.limit ||
        list.data.conversations.some(
          (row) => input.userId && row.userId !== input.userId,
        )
      )
        return failure("READ_UNAVAILABLE", 503, requestId);
      output = {
        ...list.data,
        conversations: list.data.conversations.map((row) => ({
          ...row,
          title:
            row.title === null ? null : redactAdminAiCredentials(row.title),
        })),
      };
    } else {
      const messages = adminAiMessagesResultSchema.safeParse(result.data.data);
      if (
        !messages.success ||
        messages.data.messages.length > input.limit ||
        messages.data.userId !== input.userId ||
        messages.data.conversationId !== input.conversationId
      )
        return failure("READ_UNAVAILABLE", 503, requestId);
      // Stable complete pagination: reject duplicates/out-of-order/private positions instead of mixing records.
      let previous = input.afterPosition;
      for (const message of messages.data.messages) {
        if (message.position <= previous)
          return failure("READ_UNAVAILABLE", 503, requestId);
        previous = message.position;
      }
      if (
        messages.data.nextPosition !== null &&
        messages.data.nextPosition !== previous
      )
        return failure("READ_UNAVAILABLE", 503, requestId);
      output = {
        ...messages.data,
        messages: messages.data.messages.map((message) => {
          const bodyText = redactAdminAiCredentials(message.bodyText);
          return {
            ...message,
            bodyText,
            redacted: bodyText !== message.bodyText,
          };
        }),
      };
    }
    return Response.json({ data: output, requestId }, { headers });
  } catch {
    // No database/provider detail or secret is exposed in error payloads.
    return failure("READ_UNAVAILABLE", 503, requestId);
  }
}
