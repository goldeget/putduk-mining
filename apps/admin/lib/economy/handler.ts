import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import type { EconomyPolicyDocument } from "../../../../domain/mining/economy-policy";
import type { AdminPrincipal } from "../auth/principal";
import { HIGH_IMPACT_ROLES } from "../auth/policy";
import {
  parseLogicalOperationKey,
  requestDeclaredOffline,
} from "../money/logical-operation";
import {
  buildEconomyManifest,
  economyCommandSchema,
  policyVersionSchema,
} from "./input";
import {
  economyConsoleView,
  economyReceiptSchema,
  parseEconomyState,
  type EconomyRawState,
} from "./state";

export type EconomyAccess =
  | { ok: true; principal: AdminPrincipal }
  | { ok: false; status: number; code: string };
export type EconomyRpcName =
  "read_economy_policy_version_state" | "manage_economy_policy_version";
export type EconomyDependencies = {
  authorize: (
    request: Request,
    roles: typeof HIGH_IMPACT_ROLES,
  ) => Promise<EconomyAccess>;
  rpc: (
    name: EconomyRpcName,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const readInput = z
  .object({ policyVersion: policyVersionSchema.optional() })
  .strict();
const headers = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
};
function response(data: unknown, status = 200) {
  return Response.json(data, { status, headers });
}
function failure(code: string, message: string, status: number) {
  return response({ error: { code, message } }, status);
}
function sameInstant(left: string | null, right: string | null) {
  if (left === null || right === null) return left === right;
  const microseconds = (text: string) => {
    const milliseconds = Date.parse(text);
    const fraction =
      /\.([0-9]+)(?:Z|[+-][0-9]{2}:[0-9]{2})$/.exec(text)?.[1] ?? "";
    if (!Number.isSafeInteger(milliseconds) || fraction.length > 6)
      throw new Error("ECONOMY_TIMESTAMP_UNCONFIRMED");
    return (
      BigInt(milliseconds) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3))
    );
  };
  return microseconds(left) === microseconds(right);
}
async function body(request: Request): Promise<unknown> {
  if (
    request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/json" ||
    !request.body
  )
    throw new Error("INVALID_ECONOMY_BODY");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 131072) {
        await reader.cancel();
        throw new Error("ECONOMY_REQUEST_TOO_LARGE");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text);
}
function trustedArgs(principal: AdminPrincipal) {
  if (
    principal.aal !== "aal2" ||
    !HIGH_IMPACT_ROLES.includes(principal.role) ||
    !z.uuid().safeParse(principal.userId).success ||
    !z.uuid().safeParse(principal.adminSessionId).success ||
    !principal.sessionId
  )
    throw new Error("ECONOMY_AUTHORITY_UNCONFIRMED");
  return {
    p_actor: principal.userId,
    p_admin_session_id: principal.adminSessionId,
    p_auth_session_id: principal.sessionId,
    p_verified_aal: principal.aal,
  };
}
export async function readEconomyState(
  dependencies: Pick<EconomyDependencies, "rpc">,
  principal: AdminPrincipal,
  policyVersion: string | null = null,
): Promise<EconomyRawState> {
  const result = await dependencies.rpc("read_economy_policy_version_state", {
    ...trustedArgs(principal),
    p_policy_version: policyVersion,
  });
  if (result.error) throw new Error(result.error.message);
  const state = parseEconomyState(result.data);
  if (
    state.actorRole !== principal.role ||
    (policyVersion && state.selectedVersion.policyVersion !== policyVersion)
  )
    throw new Error("ECONOMY_POLICY_STATE_UNCONFIRMED");
  return state;
}
function commandFailure(message: string) {
  if (
    /PLATFORM_FEES_PERMANENTLY_DISABLED|ECONOMY_POLICY_PLATFORM_FEES_FORBIDDEN/.test(
      message,
    )
  )
    return failure(
      message.includes("PLATFORM_FEES_PERMANENTLY_DISABLED")
        ? "PLATFORM_FEES_PERMANENTLY_DISABLED"
        : "ECONOMY_POLICY_PLATFORM_FEES_FORBIDDEN",
      "플랫폼 수수료는 영구적으로 0원입니다. 수수료 없는 새 정책을 사용해 주세요.",
      400,
    );
  if (/STEP_UP_REQUIRED|MFA_REQUIRED/.test(message))
    return failure(
      "STEP_UP_REQUIRED",
      "작업 확인 시간이 지났습니다. 인증 앱으로 다시 확인해 주세요.",
      403,
    );
  if (/OPERATOR_ROLE_REQUIRED|ADMIN_SESSION|ECONOMY_AUTHORITY/.test(message))
    return failure(
      "ADMIN_ACCESS_EXPIRED",
      "운영 권한을 다시 확인해 주세요. 로그인 후 결과를 확인할 수 있습니다.",
      403,
    );
  if (/REVISION_CHANGED|PREVIEW_CHANGED/.test(message))
    return failure(
      "ECONOMY_POLICY_CHANGED",
      "다른 작업으로 정책 상태가 바뀌었습니다. 최신 내용을 다시 열어 주세요.",
      409,
    );
  if (/VERSION_EXISTS/.test(message))
    return failure(
      "ECONOMY_VERSION_EXISTS",
      "이미 사용한 버전 이름입니다. 저장된 내용을 먼저 확인해 주세요.",
      409,
    );
  if (/IDEMPOTENCY_PAYLOAD_MISMATCH/.test(message))
    return failure(
      "IDEMPOTENCY_PAYLOAD_MISMATCH",
      "이전 요청과 내용이 다릅니다. 처음 보낸 요청을 확인해 주세요.",
      409,
    );
  if (/INVALID_ECONOMY_POLICY|PROTOCOL_CHANGE|TIER_IDENTITY/.test(message))
    return failure(
      "INVALID_ECONOMY_POLICY",
      "정책 값이나 적용 시간을 확인해 주세요.",
      400,
    );
  return failure(
    "ECONOMY_RESULT_UNCONFIRMED",
    "결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
    503,
  );
}

export function createEconomyStateHandler(dependencies: EconomyDependencies) {
  return async (request: Request) => {
    const access = await dependencies.authorize(request, HIGH_IMPACT_ROLES);
    if (!access.ok)
      return failure(
        access.code,
        "경제 정책을 조회할 수 없습니다.",
        access.status,
      );
    let value: unknown;
    try {
      value = await body(request);
    } catch {
      return failure(
        "INVALID_ECONOMY_READ",
        "조회할 버전을 확인해 주세요.",
        400,
      );
    }
    const parsed = readInput.safeParse(value);
    if (!parsed.success)
      return failure(
        "INVALID_ECONOMY_READ",
        "조회할 버전을 확인해 주세요.",
        400,
      );
    try {
      const state = await readEconomyState(
        dependencies,
        access.principal,
        parsed.data.policyVersion ?? null,
      );
      return response({ data: economyConsoleView(state) });
    } catch {
      return failure(
        "ECONOMY_STATE_UNAVAILABLE",
        "정책 내용을 불러오지 못했습니다. 다시 열어 주세요.",
        503,
      );
    }
  };
}

export function createEconomyCommandHandler(dependencies: EconomyDependencies) {
  return async (request: Request) => {
    const access = await dependencies.authorize(request, HIGH_IMPACT_ROLES);
    if (!access.ok)
      return failure(
        access.code,
        "이 작업을 실행할 수 없습니다.",
        access.status,
      );
    const idempotencyKey = parseLogicalOperationKey(
      request.headers.get("Idempotency-Key"),
    );
    if (!idempotencyKey)
      return failure(
        "INVALID_IDEMPOTENCY_KEY",
        "요청 식별자를 확인해 주세요.",
        400,
      );
    if (requestDeclaredOffline(request))
      return failure(
        "OFFLINE_BLOCKED",
        "연결된 뒤 직접 다시 눌러 주세요.",
        409,
      );
    let value: unknown;
    try {
      value = await body(request);
    } catch {
      return failure(
        "INVALID_ECONOMY_REQUEST",
        "입력 내용을 확인해 주세요.",
        400,
      );
    }
    const parsed = economyCommandSchema.safeParse(value);
    if (!parsed.success)
      return failure(
        "INVALID_ECONOMY_REQUEST",
        "금액은 정수로 입력하고 정책 값과 사유를 확인해 주세요.",
        400,
      );
    try {
      const input = parsed.data;
      const state = await readEconomyState(
        dependencies,
        access.principal,
        input.operation === "CREATE" ? null : input.policyVersion,
      );
      const selected = state.selectedVersion;
      let manifest: string | null = null;
      let expectedRevision: string | null = null;
      let expectedDigest: string | null = null;
      let effectiveFrom: string | null = null;
      if (input.operation === "CREATE") {
        manifest = buildEconomyManifest(
          state.referencePolicy.configuration as EconomyPolicyDocument,
          input.policyVersion,
          input.settings,
        );
      } else {
        // The DB checks completed same-key receipts before the new-write fee guard.
        // Do not reject an immutable historical replay based on current fee values.
        expectedRevision = input.expectedRevision;
        expectedDigest = input.expectedDigest;
        effectiveFrom = input.effectiveFrom;
        if (selected.configDigest !== input.expectedDigest)
          return commandFailure("ECONOMY_POLICY_REVISION_CHANGED");
        // SQL checks current revision, predecessor and future start after its
        // idempotency lookup under one lock. HTTP must not reject a completed
        // same-key replay merely because a later receipt/time now exists.
      }
      // The one-use proof is consumed by the same SQL transaction as the receipt,
      // idempotency and outbox. Never consume it in a separate application call.
      const result = await dependencies.rpc("manage_economy_policy_version", {
        ...trustedArgs(access.principal),
        p_operation: input.operation,
        p_policy_version: input.policyVersion,
        p_manifest_text: manifest,
        p_expected_revision: expectedRevision,
        p_expected_digest: expectedDigest,
        p_effective_from: effectiveFrom,
        p_step_up_token: input.stepUpToken,
        p_reason: input.reason,
        p_idempotency_key: idempotencyKey,
      });
      if (result.error) return commandFailure(result.error.message);
      const receipt = economyReceiptSchema.parse(result.data);
      const wantedState = {
        CREATE: "DRAFT",
        PREVIEW: "PREVIEWED",
        APPROVE: "APPROVED",
        PUBLISH: "PUBLISHED",
      }[input.operation];
      if (
        receipt.policyVersion !== input.policyVersion ||
        receipt.state !== wantedState ||
        (expectedDigest && receipt.configDigest !== expectedDigest) ||
        (manifest &&
          receipt.manifestDigest !==
            createHash("sha256").update(manifest, "utf8").digest("hex")) ||
        (effectiveFrom && !sameInstant(receipt.effectiveFrom, effectiveFrom))
      )
        throw new Error("ECONOMY_RECEIPT_UNCONFIRMED");
      const confirmed = await readEconomyState(
        dependencies,
        access.principal,
        input.policyVersion,
      );
      if (
        confirmed.selectedVersion.policyId !== receipt.policyId ||
        confirmed.selectedVersion.configDigest !== receipt.configDigest ||
        confirmed.selectedVersion.manifestDigest !== receipt.manifestDigest ||
        !confirmed.selectedVersion.history.some(
          (item) =>
            item.revisionId === receipt.revisionId &&
            item.state === receipt.state &&
            item.revision === receipt.revision &&
            sameInstant(item.effectiveFrom, receipt.effectiveFrom),
        )
      )
        throw new Error("ECONOMY_RECEIPT_UNCONFIRMED");
      return response({
        data: {
          receipt,
          console: economyConsoleView(confirmed),
          confirmed: true,
        },
      });
    } catch (error) {
      return commandFailure(
        error instanceof Error ? error.message : "ECONOMY_RESULT_UNCONFIRMED",
      );
    }
  };
}
