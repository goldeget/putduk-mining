import { z } from "zod";
import { HIGH_IMPACT_ROLES } from "../auth/policy";
export type WorkroomPrincipal = {
  userId: string;
  adminSessionId: string;
  sessionId: string;
  aal: string;
  role: string;
};
export type WorkroomAccess =
  | { ok: true; principal: WorkroomPrincipal }
  | { ok: false; status: number; code: string };
export type WorkroomDependencies = {
  authorize: (
    request: Request,
    roles: typeof HIGH_IMPACT_ROLES,
  ) => Promise<WorkroomAccess>;
  authorizeRead: (request: Request) => Promise<WorkroomAccess>;
  invoke: (
    principal: WorkroomPrincipal,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const reason = z.string().trim().min(2).max(160);
const instrument = z.enum([
  "usd",
  "cny",
  "jpy",
  "nvda",
  "tsla",
  "msft",
  "ndx",
  "skh",
  "samsung",
  "lg",
]);
const command = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("CONFIG_SAVE"),
      input: z
        .object({
          instrument,
          pattern: z.enum(["wave", "slow", "balanced"]),
          roi: z.number().min(-50).max(50),
          duration: z.number().int().min(30).max(86400),
          amplitude: z.number().min(0).max(15),
          expectedVersion: z.number().int().min(1),
          reason,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("POINT_ADJUST"),
      input: z
        .object({
          userId: z.uuid(),
          direction: z.enum(["CREDIT", "DEBIT"]),
          amount: z.number().int().min(1).max(1000000),
          reason,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("INVITE_CREATE"),
      input: z
        .object({
          label: z.string().trim().max(60).optional(),
          expiresAt: z.iso.datetime({ offset: true }),
          maxUses: z.number().int().min(1).max(1000),
          reason,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("INVITE_STATUS"),
      input: z.object({ id: z.uuid(), enabled: z.boolean(), reason }).strict(),
    })
    .strict(),
]);
const page = z.coerce.number().int().min(1).max(100000).default(1);
const query = z
  .object({
    usersPage: page,
    invitesPage: page,
    auditPage: page,
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).default(""),
  })
  .strict();
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
function fail(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status);
}
function trusted(p: WorkroomPrincipal) {
  return (
    p.aal === "aal2" &&
    ["ADMIN", "SUPER_ADMIN"].includes(p.role) &&
    z.uuid().safeParse(p.userId).success &&
    z.uuid().safeParse(p.adminSessionId).success &&
    z.uuid().safeParse(p.sessionId).success
  );
}
function args(
  p: WorkroomPrincipal,
  operation: string,
  requestKey: string | null,
  input: unknown,
) {
  return {
    p_operation: operation,
    p_request_key: requestKey,
    p_input: input,
    p_actor: p.userId,
    p_admin_session_id: p.adminSessionId,
    p_auth_session_id: p.sessionId,
    p_verified_aal: p.aal,
  };
}
function rpcFailure(message: string) {
  if (/VERSION|CONFLICT|PAYLOAD_MISMATCH/.test(message))
    return fail(
      "WORKROOM_CONFLICT",
      "조건 또는 이전 요청이 변경되었습니다. 최신 기록을 확인해주세요.",
      409,
    );
  if (/AUTH|ROLE|SESSION|MFA|FORBIDDEN/.test(message))
    return fail(
      "ADMIN_ACCESS_EXPIRED",
      "운영 권한과 보안 세션을 다시 확인해주세요.",
      403,
    );
  if (/INVALID|NOT_FOUND|EXPIRED|LIMIT|INSUFFICIENT/.test(message))
    return fail(
      "INVALID_WORKROOM_COMMAND",
      "입력값과 대상 상태를 확인해주세요.",
      400,
    );
  return fail(
    "WORKROOM_RESULT_UNCONFIRMED",
    "처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.",
    503,
  );
}
async function boundedBody(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/json" ||
    !request.body
  )
    throw new Error("INVALID_BODY");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new Error("TOO_LARGE");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text) as unknown;
}
export function createWorkroomCommandHandler(deps: WorkroomDependencies) {
  return async (request: Request) => {
    try {
      const access = await deps.authorize(request, HIGH_IMPACT_ROLES);
      if (!access.ok)
        return fail(access.code, "운영 권한을 확인해주세요.", access.status);
      if (!trusted(access.principal))
        return fail(
          "ADMIN_AUTHORITY_UNCONFIRMED",
          "운영 권한을 확인해주세요.",
          403,
        );
      const key = request.headers.get("Idempotency-Key");
      if (!z.uuid().safeParse(key).success)
        return fail("INVALID_REQUEST_KEY", "요청 식별자가 필요합니다.", 400);
      let value: unknown;
      try {
        value = await boundedBody(request);
      } catch (error) {
        return fail(
          "INVALID_BODY",
          "요청 내용을 확인해주세요.",
          error instanceof Error && error.message === "TOO_LARGE" ? 413 : 400,
        );
      }
      const parsed = command.safeParse(value);
      if (!parsed.success)
        return fail(
          "INVALID_WORKROOM_COMMAND",
          "입력값과 변경 사유를 확인해주세요.",
          400,
        );
      const result = await deps.invoke(
        access.principal,
        args(access.principal, parsed.data.operation, key, parsed.data.input),
      );
      return result.error
        ? rpcFailure(result.error.message)
        : json({ data: result.data });
    } catch {
      return fail(
        "WORKROOM_RESULT_UNCONFIRMED",
        "처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.",
        503,
      );
    }
  };
}
export function createWorkroomStateHandler(deps: WorkroomDependencies) {
  return async (request: Request) => {
    try {
      const access = await deps.authorizeRead(request);
      if (!access.ok)
        return fail(access.code, "운영 권한을 확인해주세요.", access.status);
      if (!trusted(access.principal))
        return fail(
          "ADMIN_AUTHORITY_UNCONFIRMED",
          "운영 권한을 확인해주세요.",
          403,
        );
      const parsed = query.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success)
        return fail("INVALID_WORKROOM_QUERY", "조회 조건을 확인해주세요.", 400);
      const result = await deps.invoke(
        access.principal,
        args(access.principal, "READ", null, parsed.data),
      );
      return result.error
        ? rpcFailure(result.error.message)
        : json({ data: result.data });
    } catch {
      return fail(
        "WORKROOM_READ_UNAVAILABLE",
        "운영 정보를 조회하지 못했습니다. 다시 시도해주세요.",
        503,
      );
    }
  };
}
