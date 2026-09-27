import "server-only";

import { randomUUID } from "node:crypto";

import {
  decideAdminAccess,
  hasRecentTotpStepUp,
  HIGH_IMPACT_ROLES,
  type AdminRole,
} from "@/lib/auth/policy";
import {
  getAdminIdentity,
  type AdminPrincipal,
} from "@/lib/auth/principal";

export type CommandActionResult =
  | { ok: true; message: string }
  | { ok: false; code: string; message: string };

const DENIAL_COPY: Record<string, string> = {
  UNAUTHENTICATED: "세션이 만료되었습니다. 다시 로그인해 주세요.",
  ROLE_REQUIRED: "이 작업을 실행할 권한이 없습니다.",
  MFA_REQUIRED: "추가 본인 확인이 필요합니다.",
  ROLE_FORBIDDEN: "현재 역할로는 이 작업을 할 수 없습니다.",
  STEP_UP_REQUIRED:
    "고위험 작업입니다. 인증 앱으로 다시 확인한 뒤 시도해 주세요.",
};

export async function requireHighImpactPrincipal(
  allowedRoles: readonly AdminRole[] = HIGH_IMPACT_ROLES,
): Promise<
  | { ok: true; principal: AdminPrincipal }
  | { ok: false; result: CommandActionResult }
> {
  const identity = await getAdminIdentity();
  const decision = decideAdminAccess({
    authenticated: Boolean(identity),
    role: identity?.role ?? null,
    aal: identity?.aal ?? null,
    allowedRoles,
    ...(identity ? { recentTotp: hasRecentTotpStepUp(identity.amr) } : {}),
  });
  if (decision !== "ALLOW" || !identity?.role) {
    return {
      ok: false,
      result: {
        ok: false,
        code: decision,
        message: DENIAL_COPY[decision] ?? "이 작업을 실행할 수 없습니다.",
      },
    };
  }
  return { ok: true, principal: identity as AdminPrincipal };
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function mapRpcFailure(
  message: string | undefined,
  fallback: string,
): CommandActionResult {
  const text = message ?? "";
  if (
    text.includes("does not exist") ||
    text.includes("Could not find the function") ||
    text.includes("schema cache")
  ) {
    return {
      ok: false,
      code: "COMMAND_NOT_READY",
      message:
        "이 처리 명령이 아직 준비되지 않았습니다. 도메인 반영 후 다시 시도해 주세요.",
    };
  }
  if (
    text.includes("EXTERNAL_SENT") ||
    text.includes("ALREADY_SENT") ||
    text.includes("SEND_ALREADY")
  ) {
    return {
      ok: false,
      code: "SEND_ALREADY_RECORDED",
      message:
        "외부 송금은 이미 기록되어 있습니다. 다시 보내지 말고 원장만 확정하세요.",
    };
  }
  if (
    text.includes("RELEASE_FORBIDDEN") ||
    text.includes("CANNOT_RELEASE") ||
    text.includes("AFTER_EXTERNAL")
  ) {
    return {
      ok: false,
      code: "RELEASE_FORBIDDEN",
      message: "외부 송금이 기록된 뒤에는 보류 금액을 해제할 수 없습니다.",
    };
  }
  return { ok: false, code: "COMMAND_FAILED", message: fallback };
}
