import "server-only";
import { z } from "zod";
import {
  catalogCommandSchema,
  catalogReceiptSchema,
  catalogSameInstant,
  catalogStateSchema,
  type CatalogState,
} from "../../../../domain/products/catalog-command";
import type { AdminPrincipal } from "../auth/principal";
import { HIGH_IMPACT_ROLES } from "../auth/policy";
import {
  parseLogicalOperationKey,
  requestDeclaredOffline,
} from "../money/logical-operation";

export type CatalogDependencies = {
  authorize: (
    request: Request,
    roles: typeof HIGH_IMPACT_ROLES,
  ) => Promise<
    | { ok: true; principal: AdminPrincipal }
    | { ok: false; status: number; code: string }
  >;
  rpc: (
    name: "read_product_catalog_review_state" | "manage_product_catalog",
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const headers = { "Cache-Control": "private, no-store" };
const fail = (code: string, message: string, status: number) =>
  Response.json({ error: { code, message } }, { status, headers });
function context(p: AdminPrincipal) {
  if (
    p.aal !== "aal2" ||
    !HIGH_IMPACT_ROLES.includes(p.role) ||
    !z.uuid().safeParse(p.userId).success ||
    !z.uuid().safeParse(p.adminSessionId).success ||
    !p.sessionId
  )
    throw new Error("CATALOG_AUTHORITY_UNCONFIRMED");
  return {
    p_actor: p.userId,
    p_admin_session_id: p.adminSessionId,
    p_auth_session_id: p.sessionId,
    p_verified_aal: p.aal,
  };
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
  let text = "";
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new Error("BODY_LIMIT");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text) as unknown;
}
export async function readCatalogState(
  deps: Pick<CatalogDependencies, "rpc">,
  principal: AdminPrincipal,
  catalogId: string | null,
): Promise<CatalogState> {
  const result = await deps.rpc("read_product_catalog_review_state", {
    ...context(principal),
    p_catalog_id: catalogId,
  });
  if (result.error) throw new Error("CATALOG_READ_UNCONFIRMED");
  const state = catalogStateSchema.parse(result.data);
  if (catalogId && state.selected?.catalogId !== catalogId)
    throw new Error("CATALOG_READ_UNCONFIRMED");
  return state;
}
function failure(message: string) {
  if (
    /STEP_UP_REQUIRED|MFA_REQUIRED|ADMIN_SESSION|OPERATOR_ROLE|AUTHORITY/.test(
      message,
    )
  )
    return fail(
      "CATALOG_AUTH_REQUIRED",
      "인증 앱으로 작업을 다시 확인해 주세요.",
      403,
    );
  if (
    /REVISION_CHANGED|PREVIEW_CHANGED|IDEMPOTENCY_PAYLOAD_MISMATCH/.test(
      message,
    )
  )
    return fail(
      "CATALOG_CHANGED",
      "내용이 바뀌었습니다. 최신 내용을 다시 검토해 주세요.",
      409,
    );
  if (/DRAFT_UNSUPPORTED|NEUTRAL_PLAN|PUBLICATION_REQUIRED/.test(message))
    return fail(
      "CATALOG_UNSUPPORTED",
      "이 초안은 현재 승인할 수 없습니다. 새 초안으로 검토해 주세요.",
      409,
    );
  if (/INVALID_PRODUCT_CATALOG/.test(message))
    return fail(
      "INVALID_CATALOG_REQUEST",
      "적용 시간과 입력 내용을 확인해 주세요.",
      400,
    );
  return fail(
    "CATALOG_RESULT_UNCONFIRMED",
    "결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
    503,
  );
}
export function createCatalogStateHandler(deps: CatalogDependencies) {
  return async (request: Request) => {
    const access = await deps.authorize(request, HIGH_IMPACT_ROLES);
    if (!access.ok)
      return fail(
        access.code,
        "상품 검토 내용을 조회할 수 없습니다.",
        access.status,
      );
    let input;
    try {
      input = z
        .object({ catalogId: z.uuid().nullable() })
        .strict()
        .parse(await boundedBody(request));
    } catch {
      return fail(
        "INVALID_CATALOG_READ",
        "조회할 상품 버전을 확인해 주세요.",
        400,
      );
    }
    try {
      return Response.json(
        {
          data: await readCatalogState(deps, access.principal, input.catalogId),
        },
        { headers },
      );
    } catch {
      return fail(
        "CATALOG_READ_UNAVAILABLE",
        "상품 내용을 불러오지 못했습니다. 다시 열어 주세요.",
        503,
      );
    }
  };
}
export function createCatalogCommandHandler(deps: CatalogDependencies) {
  return async (request: Request) => {
    const access = await deps.authorize(request, HIGH_IMPACT_ROLES);
    if (!access.ok)
      return fail(
        access.code,
        "상품 변경 권한을 확인해 주세요.",
        access.status,
      );
    const key = parseLogicalOperationKey(
      request.headers.get("Idempotency-Key"),
    );
    if (!key)
      return fail(
        "INVALID_IDEMPOTENCY_KEY",
        "요청 식별자를 확인해 주세요.",
        400,
      );
    if (requestDeclaredOffline(request))
      return fail("OFFLINE_BLOCKED", "연결된 뒤 직접 다시 눌러 주세요.", 409);
    let input;
    try {
      input = catalogCommandSchema.parse(await boundedBody(request));
    } catch {
      return fail(
        "INVALID_CATALOG_REQUEST",
        "입력 내용과 작업 확인을 확인해 주세요.",
        400,
      );
    }
    try {
      // SQL performs idempotency lookup before current revision/time checks, so a
      // response lost after commit can recover its exact old receipt.
      const result = await deps.rpc("manage_product_catalog", {
        ...context(access.principal),
        p_operation: input.operation,
        p_catalog_id: input.catalogId,
        p_expected_revision: input.expectedRevision,
        p_expected_digest: input.expectedDigest,
        p_publish_at: input.publishAt,
        p_step_up_token: input.stepUpToken,
        p_reason: input.reason,
        p_idempotency_key: key,
      });
      if (result.error) return failure(result.error.message);
      const receipt = catalogReceiptSchema.parse(result.data);
      if (
        receipt.catalogId !== input.catalogId ||
        receipt.state !==
          (
            {
              PREVIEW: "PREVIEWED",
              APPROVE: "APPROVED",
              PUBLISH: "PUBLISHED",
            } as const
          )[input.operation] ||
        !catalogSameInstant(receipt.publishAt, input.publishAt) ||
        (input.operation !== "PREVIEW" &&
          receipt.snapshotDigest !== input.expectedDigest)
      )
        throw new Error("CATALOG_RECEIPT_UNCONFIRMED");
      const state = await readCatalogState(
        deps,
        access.principal,
        input.catalogId,
      );
      const latest = state.selected?.latestReceipt;
      if (
        !latest ||
        latest.revision < receipt.revision ||
        (latest.revision === receipt.revision &&
          latest.revisionId !== receipt.revisionId)
      )
        throw new Error("CATALOG_READBACK_UNCONFIRMED");
      return Response.json(
        { data: { receipt, state, confirmed: true } },
        { headers },
      );
    } catch (error) {
      return failure(
        error instanceof Error ? error.message : "CATALOG_RESULT_UNCONFIRMED",
      );
    }
  };
}
