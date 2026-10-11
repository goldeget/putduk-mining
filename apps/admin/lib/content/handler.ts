import "server-only";
import { z } from "zod";
import {
  CONTENT_OPERATION_STATE,
  contentCommandSchema,
  contentKindSchema,
  contentReceiptSchema,
  contentReviewSchema,
  type ContentReceipt,
} from "../../../../domain/content/contract";
import { readBoundedJsonBody } from "../../../../lib/api/request-body";
import type { AdminPrincipal } from "../auth/principal";
import { HIGH_IMPACT_ROLES } from "../auth/policy";
import { requestDeclaredOffline } from "../money/logical-operation";

export type ContentDependencies = {
  authorize: (
    request: Request,
    roles: typeof HIGH_IMPACT_ROLES,
  ) => Promise<
    | { ok: true; principal: AdminPrincipal }
    | { ok: false; status: number; code: string }
  >;
  rpc: (
    name: "manage_liveops_content" | "read_liveops_content_review",
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Origin",
  "X-Content-Type-Options": "nosniff",
};
function fail(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers });
}
function context(principal: AdminPrincipal) {
  if (
    principal.aal !== "aal2" ||
    !HIGH_IMPACT_ROLES.includes(principal.role) ||
    !z.uuid().safeParse(principal.userId).success ||
    !z.uuid().safeParse(principal.adminSessionId).success ||
    !principal.sessionId
  )
    throw new Error("LIVEOPS_AUTHORITY_UNCONFIRMED");
  return {
    p_actor: principal.userId,
    p_admin_session_id: principal.adminSessionId,
    p_auth_session_id: principal.sessionId,
    p_verified_aal: principal.aal,
  };
}
function failure(message: string) {
  if (
    /AUTHORITY|OPERATOR_ROLE|STEP_UP|MFA_REQUIRED|ADMIN_SESSION/.test(message)
  )
    return fail(
      "CONTENT_AUTH_REQUIRED",
      "인증 앱으로 작업을 다시 확인해 주세요.",
      403,
    );
  if (/REVISION|DIGEST|PREVIEW|IDEMPOTENCY_PAYLOAD_MISMATCH/.test(message))
    return fail(
      "CONTENT_CHANGED",
      "내용이 바뀌었습니다. 최신 내용을 다시 검토해 주세요.",
      409,
    );
  if (/WINDOW_ENDED|COPY|PAYLOAD|INVALID_LIVEOPS/.test(message))
    return fail(
      "INVALID_CONTENT",
      "안내 내용과 게시 기간을 확인해 주세요.",
      400,
    );
  return fail(
    "CONTENT_RESULT_UNCONFIRMED",
    "결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
    503,
  );
}
async function body(request: Request, bytes: number) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    throw new Error("INVALID_BODY");
  const result = await readBoundedJsonBody(request, bytes);
  if (!result.ok) throw new Error(result.code);
  return result.value;
}
async function review(
  deps: ContentDependencies,
  principal: AdminPrincipal,
  kind: "EVENT" | "NOTICE",
  id: string | null,
) {
  const result = await deps.rpc("read_liveops_content_review", {
    ...context(principal),
    p_kind: kind,
    p_content_id: id,
  });
  if (result.error) throw new Error("CONTENT_READ_UNCONFIRMED");
  const state = contentReviewSchema.parse(result.data);
  if (
    state.items.some(
      (row) => row.contentKind !== kind || (id && row.contentId !== id),
    )
  )
    throw new Error("CONTENT_READ_UNCONFIRMED");
  return state;
}
export function createContentStateHandler(deps: ContentDependencies) {
  return async (request: Request) => {
    const access = await deps.authorize(request, HIGH_IMPACT_ROLES);
    if (!access.ok)
      return fail(
        access.code,
        "안내 내용을 조회할 수 없습니다.",
        access.status,
      );
    let input;
    try {
      input = z
        .strictObject({
          kind: contentKindSchema,
          contentId: z.uuid().nullable(),
        })
        .parse(await body(request, 2048));
    } catch {
      return fail("INVALID_CONTENT_READ", "조회할 안내를 확인해 주세요.", 400);
    }
    try {
      return Response.json(
        {
          data: await review(
            deps,
            access.principal,
            input.kind,
            input.contentId,
          ),
        },
        { headers },
      );
    } catch (error) {
      return failure(
        error instanceof Error ? error.message : "CONTENT_READ_UNCONFIRMED",
      );
    }
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function matchesReadback(
  receipt: ContentReceipt,
  latest: ContentReceipt,
) {
  return (
    latest.contentId === receipt.contentId &&
    latest.contentKind === receipt.contentKind &&
    (latest.revision > receipt.revision ||
      (latest.revision === receipt.revision &&
        latest.revisionId === receipt.revisionId &&
        latest.digest === receipt.digest &&
        latest.state === receipt.state &&
        canonical(latest.snapshot) === canonical(receipt.snapshot)))
  );
}
export function createContentCommandHandler(deps: ContentDependencies) {
  return async (request: Request) => {
    const access = await deps.authorize(request, HIGH_IMPACT_ROLES);
    if (!access.ok)
      return fail(
        access.code,
        "안내 변경 권한을 확인해 주세요.",
        access.status,
      );
    if (requestDeclaredOffline(request))
      return fail("OFFLINE_BLOCKED", "연결된 뒤 직접 다시 눌러 주세요.", 409);
    const key = z.uuid().safeParse(request.headers.get("Idempotency-Key"));
    if (!key.success)
      return fail(
        "INVALID_IDEMPOTENCY_KEY",
        "요청 식별자를 확인해 주세요.",
        400,
      );
    let input;
    try {
      input = contentCommandSchema.parse(await body(request, 98304));
    } catch {
      return fail(
        "INVALID_CONTENT_REQUEST",
        "입력 내용과 작업 확인을 확인해 주세요.",
        400,
      );
    }
    try {
      const result = await deps.rpc("manage_liveops_content", {
        ...context(access.principal),
        p_operation: input.operation,
        p_kind: input.kind,
        p_content_id: input.contentId,
        p_expected_revision: input.expectedRevision,
        p_expected_digest: input.expectedDigest,
        p_payload: input.payload,
        p_step_up_token: input.stepUpToken,
        p_reason: input.reason,
        p_idempotency_key: key.data,
      });
      if (result.error) return failure(result.error.message);
      const receipt = contentReceiptSchema.parse(result.data);
      if (
        receipt.contentKind !== input.kind ||
        (input.contentId && receipt.contentId !== input.contentId) ||
        receipt.state !== CONTENT_OPERATION_STATE[input.operation] ||
        (!["CREATE_DRAFT", "UPDATE_DRAFT"].includes(input.operation) &&
          receipt.digest !== input.expectedDigest) ||
        (input.payload &&
          canonical(input.payload) !== canonical(receipt.snapshot))
      )
        throw new Error("CONTENT_RECEIPT_UNCONFIRMED");
      const state = await review(
        deps,
        access.principal,
        input.kind,
        receipt.contentId,
      );
      const latest = state.items
        .filter((row) => row.contentId === receipt.contentId)
        .sort((a, b) => b.revision - a.revision)[0];
      if (!latest || !matchesReadback(receipt, latest))
        throw new Error("CONTENT_READBACK_UNCONFIRMED");
      return Response.json(
        { data: { receipt, state, confirmed: true } },
        { headers },
      );
    } catch (error) {
      return failure(
        error instanceof Error ? error.message : "CONTENT_RESULT_UNCONFIRMED",
      );
    }
  };
}
