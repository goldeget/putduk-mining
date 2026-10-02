/**
 * 회원 출금 UI용 오류 코드 허용 목록.
 * 서버가 보낸 message 문자열은 절대 표시하지 않고, 코드만 한국어 카피로 매핑한다.
 * 알 수 없는 코드·내부 DB/스키마 메시지는 닫힌(fail-closed) 기본 안내로 대체한다.
 */

export const MEMBER_WITHDRAWAL_SUBMIT_FALLBACK =
  "출금 요청을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.";

export const MEMBER_DESTINATION_REGISTER_FALLBACK =
  "출금 목적지를 등록하지 못했어요. 잠시 후 다시 시도해 주세요.";

export const MEMBER_WITHDRAWAL_NETWORK_FALLBACK =
  "인터넷 연결을 확인한 뒤 다시 시도해 주세요.";

export const MEMBER_WELCOME_WITHDRAWAL_FALLBACK =
  "첫 출금 요청을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.";

/** 출금 요청(hold) 제출 — 허용된 애플리케이션 오류 코드만 제품 카피 사용 */
const SUBMIT_CODE_COPY = {
  UNAUTHENTICATED: "로그인이 필요합니다.",
  INVALID_IDEMPOTENCY_KEY: "요청 식별자를 확인해 주세요.",
  INVALID_WITHDRAWAL_REQUEST: "출금 요청 정보를 확인해 주세요.",
  INSUFFICIENT_AVAILABLE_BALANCE: "출금 가능 금액이 부족해요.",
  WITHDRAWAL_REQUEST_FAILED: MEMBER_WITHDRAWAL_SUBMIT_FALLBACK,
  WITHDRAWAL_RECONCILIATION_REQUIRED:
    "이전 출금 요청을 먼저 확인해 주세요. 확인하기 전에는 새 요청을 보내지 않아요.",
} as const satisfies Record<string, string>;

/** 출금 목적지 등록 — 허용된 애플리케이션 오류 코드만 제품 카피 사용 */
const DESTINATION_CODE_COPY = {
  UNAUTHENTICATED: "로그인이 필요합니다.",
  INVALID_DESTINATION: "출금 목적지 정보를 확인해 주세요.",
  WITHDRAWAL_REAUTH_REQUIRED: "비밀번호를 다시 확인해 주세요.",
  WITHDRAWAL_REAUTH_FAILED: "비밀번호와 인증 정보를 다시 확인해 주세요.",
  WITHDRAWAL_REAUTH_MFA_REQUIRED: "인증 앱의 숫자 6자리를 입력해 주세요.",
  WITHDRAWAL_REAUTH_RATE_LIMITED: "시도가 많아요. 15분 뒤 다시 확인해 주세요.",
  WITHDRAWAL_REAUTH_UNAVAILABLE: "잠시 후 다시 확인해 주세요.",
  /** 구성 미비도 회원에게는 내부 원인 대신 등록 실패 안내 */
  WITHDRAWAL_SECURITY_NOT_CONFIGURED: MEMBER_DESTINATION_REGISTER_FALLBACK,
  DESTINATION_REGISTER_FAILED: MEMBER_DESTINATION_REGISTER_FALLBACK,
  WITHDRAWAL_RECONCILIATION_REQUIRED:
    "이전 출금 요청을 먼저 확인해 주세요. 확인하기 전에는 새 요청을 보내지 않아요.",
} as const satisfies Record<string, string>;

/**
 * 환영 보상 첫 출금.
 * 일반 출금과 뜻이 같은 코드는 SUBMIT_CODE_COPY를 그대로 쓴다.
 * 환영 전용 코드만 이 목록에 둔다. message 원문은 사용하지 않는다.
 */
const WELCOME_CODE_COPY = {
  UNAUTHENTICATED: SUBMIT_CODE_COPY.UNAUTHENTICATED,
  INVALID_IDEMPOTENCY_KEY: SUBMIT_CODE_COPY.INVALID_IDEMPOTENCY_KEY,
  INSUFFICIENT_AVAILABLE_BALANCE:
    SUBMIT_CODE_COPY.INSUFFICIENT_AVAILABLE_BALANCE,
  INVALID_WELCOME_WITHDRAWAL_REQUEST: "환영 보상 출금 정보를 확인해 주세요.",
  VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED:
    "검증과 보호 대기 시간이 끝난 본인 출금 계좌가 필요합니다.",
  WELCOME_WITHDRAWAL_POLICY_UNAVAILABLE:
    "현재 사용할 수 있는 환영 보상 출금 정책이 없습니다.",
  WELCOME_REWARD_NOT_WITHDRAWABLE: "출금 가능한 환영 보상을 확인해 주세요.",
  WELCOME_REWARD_WITHDRAWAL_EXISTS: "이미 접수된 환영 보상 출금이 있습니다.",
  WELCOME_WITHDRAWAL_PAUSED:
    "현재 안전 점검으로 출금 접수가 잠시 중단되었습니다.",
  WELCOME_WITHDRAWAL_REQUEST_FAILED: MEMBER_WELCOME_WITHDRAWAL_FALLBACK,
} as const satisfies Record<string, string>;

export type MemberWithdrawalSubmitErrorCode = keyof typeof SUBMIT_CODE_COPY;
export type MemberDestinationRegisterErrorCode =
  keyof typeof DESTINATION_CODE_COPY;
export type MemberWelcomeWithdrawalErrorCode = keyof typeof WELCOME_CODE_COPY;

function readErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

/**
 * 출금 요청 제출 응답 → 회원 노출용 한국어.
 * payload.error.message는 무시한다.
 */
export function memberWithdrawalSubmitMessage(payload: unknown): string {
  const code = readErrorCode(payload);
  if (!code) {
    return MEMBER_WITHDRAWAL_SUBMIT_FALLBACK;
  }
  return (
    SUBMIT_CODE_COPY[code as MemberWithdrawalSubmitErrorCode] ??
    MEMBER_WITHDRAWAL_SUBMIT_FALLBACK
  );
}

/**
 * 환영 보상 첫 출금 응답 → 회원 노출용 한국어.
 * payload.error.message는 무시한다. 코드가 없거나 목록 밖이면 기본 안내만 쓴다.
 */
export function memberWelcomeWithdrawalMessage(payload: unknown): string {
  const code = readErrorCode(payload);
  if (!code) {
    return MEMBER_WELCOME_WITHDRAWAL_FALLBACK;
  }
  return (
    WELCOME_CODE_COPY[code as MemberWelcomeWithdrawalErrorCode] ??
    MEMBER_WELCOME_WITHDRAWAL_FALLBACK
  );
}

/**
 * 출금 목적지 등록 응답 → 회원 노출용 한국어.
 * payload.error.message는 무시한다.
 */
export function memberDestinationRegisterMessage(payload: unknown): string {
  const code = readErrorCode(payload);
  if (!code) {
    return MEMBER_DESTINATION_REGISTER_FALLBACK;
  }
  return Object.hasOwn(DESTINATION_CODE_COPY, code)
    ? (DESTINATION_CODE_COPY[code as MemberDestinationRegisterErrorCode] ??
        MEMBER_DESTINATION_REGISTER_FALLBACK)
    : MEMBER_DESTINATION_REGISTER_FALLBACK;
}

/** 허용 목록에 있는 회원용 안내인지 판별 (catch에서 재사용) */
export function isMemberFacingWithdrawalCopy(message: string): boolean {
  const allowlisted = new Set<string>([
    ...Object.values(SUBMIT_CODE_COPY),
    ...Object.values(DESTINATION_CODE_COPY),
    ...Object.values(WELCOME_CODE_COPY),
    MEMBER_WITHDRAWAL_SUBMIT_FALLBACK,
    MEMBER_DESTINATION_REGISTER_FALLBACK,
    MEMBER_WELCOME_WITHDRAWAL_FALLBACK,
    MEMBER_WITHDRAWAL_NETWORK_FALLBACK,
  ]);
  return allowlisted.has(message);
}
