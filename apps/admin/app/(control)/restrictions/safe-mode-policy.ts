import { z } from "zod";

import { parseKstDateTimeInput } from "@/lib/time/kst-input";

import {
  HIGH_IMPACT_ROLES,
  type AdminRole,
  decideAdminAccess,
} from "@/lib/auth/policy";

/** 승인된 V1 안전 모드 구성 요소. 새 유형은 제품 승인 없이 추가하지 않는다. */
export const SAFE_MODE_COMPONENTS = [
  "GLOBAL",
  "SIGNUP",
  "TRIAL",
  "NEW_MINING",
  "SETTLEMENT",
  "DEPOSIT",
  "WITHDRAWAL",
  "REFERRAL_PAYOUT",
  "EVENT_PAYOUT",
  "NOTIFICATION",
  "AI",
] as const;

export type SafeModeComponent = (typeof SAFE_MODE_COMPONENTS)[number];

export const SAFE_MODE_MUTATION_ROLES: readonly AdminRole[] = HIGH_IMPACT_ROLES;

export const COMPONENT_LABEL: Record<SafeModeComponent, string> = {
  GLOBAL: "전체",
  SIGNUP: "가입",
  TRIAL: "퍼뜩 시작",
  NEW_MINING: "새 채굴",
  SETTLEMENT: "정산",
  DEPOSIT: "입금",
  WITHDRAWAL: "출금",
  REFERRAL_PAYOUT: "추천 지급",
  EVENT_PAYOUT: "이벤트 지급",
  NOTIFICATION: "알림",
  AI: "AI",
};

export const safeModeInputSchema = z.object({
  component: z.enum(SAFE_MODE_COMPONENTS),
  pause: z.enum(["true", "false"]),
  reason: z.string().trim().min(10).max(500),
  confirmation: z.literal("SAFE_MODE"),
  expectedRequestId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((value) => value || null),
  /** 선택 검토 시각(한국 시간 datetime-local). 비우면 null. */
  reviewAt: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

export type SafeModeParsedInput = z.infer<typeof safeModeInputSchema>;

export function canMutateSafeMode(role: AdminRole | null | undefined): boolean {
  return Boolean(role && SAFE_MODE_MUTATION_ROLES.includes(role));
}

/**
 * 기능 플래그·안전 모드는 권한을 주지 않는다.
 * 일시 정지가 꺼져 있거나 플래그가 켜져 있어도 역할·MFA는 그대로 강제한다.
 */
export function decideSafeModeMutationAccess(input: {
  authenticated: boolean;
  role: AdminRole | null;
  aal: string | null;
  /** 안전 모드가 현재 꺼져 있는지(운영 상태). 인가에 사용하지 않는다. */
  safeModeCleared?: boolean;
  /** 기능 플래그가 켜져 있는지. 인가에 사용하지 않는다. */
  featureFlagEnabled?: boolean;
}): ReturnType<typeof decideAdminAccess> {
  void input.safeModeCleared;
  void input.featureFlagEnabled;
  return decideAdminAccess({
    authenticated: input.authenticated,
    role: input.role,
    aal: input.aal,
    allowedRoles: SAFE_MODE_MUTATION_ROLES,
  });
}

export function parseSafeModeFormInput(raw: {
  component: FormDataEntryValue | null;
  pause: FormDataEntryValue | null;
  reason: FormDataEntryValue | null;
  confirmation: FormDataEntryValue | null;
  reviewAt?: FormDataEntryValue | null;
  expectedRequestId?: FormDataEntryValue | null;
}):
  | { ok: true; data: SafeModeParsedInput }
  | { ok: false; code: "INVALID_INPUT"; message: string } {
  const parsed = safeModeInputSchema.safeParse({
    component: raw.component,
    pause: raw.pause,
    reason: raw.reason,
    confirmation: raw.confirmation,
    reviewAt: raw.reviewAt ?? "",
    expectedRequestId: raw.expectedRequestId ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "안전 모드 입력값을 확인해 주세요.",
    };
  }

  if (parsed.data.reviewAt) {
    const reviewAt = parseKstDateTimeInput(parsed.data.reviewAt);
    if (!reviewAt || Date.parse(reviewAt) <= Date.now()) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "검토 시각은 지금보다 이후여야 합니다.",
      };
    }
    return {
      ok: true,
      data: {
        ...parsed.data,
        reviewAt,
      },
    };
  }

  return { ok: true, data: parsed.data };
}

export function safeModeStateLabel(isPaused: boolean): "정지 중" | "정상" {
  return isPaused ? "정지 중" : "정상";
}

export function safeModeAuditAction(
  isPaused: boolean,
): "SAFE_MODE_ENABLED" | "SAFE_MODE_DISABLED" {
  return isPaused ? "SAFE_MODE_ENABLED" : "SAFE_MODE_DISABLED";
}

export function safeModeSuccessMessage(
  component: SafeModeComponent,
  isPaused: boolean,
): string {
  const label = COMPONENT_LABEL[component];
  return isPaused
    ? `${label} 기능을 잠시 멈췄습니다.`
    : `${label} 기능 제한을 해제했습니다.`;
}
