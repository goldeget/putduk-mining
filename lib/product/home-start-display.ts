import type { ProductStatusTone } from "@/components/product/product-status-pill";

export const homeRouteLoadingLabel = "홈 불러오는 중";
export const startRouteLoadingLabel = "PUTDUK START 불러오는 중";

/** 서버가 내려준 체험 상태만 한국어로 보여 준다. 보상·자격·시간을 계산하지 않는다. */
const trialStatusCopy: Record<
  string,
  { label: string; tone: ProductStatusTone }
> = {
  READY: { label: "준비됨", tone: "neutral" },
  ACTIVE: { label: "진행 중", tone: "success" },
  COMPLETED: { label: "완료", tone: "success" },
  EXPIRED: { label: "종료", tone: "warning" },
  UNAVAILABLE: { label: "확인 불가", tone: "danger" },
};

/** 서버 전환 상태만 표시한다. 프론트가 자격을 판단하지 않는다. */
const conversionStatusCopy: Record<
  string,
  { description: string; label: string; tone: ProductStatusTone }
> = {
  PENDING_QUALIFICATION: {
    label: "자격 확인 중",
    description: "본인 확인이 끝나면 다음 안내가 열려요.",
    tone: "info",
  },
  QUALIFIED: {
    label: "자격 확인됨",
    description: "환영 보상 전환을 이어서 진행할 수 있어요.",
    tone: "success",
  },
  AUTO_HOLD: {
    label: "추가 확인 중",
    description: "잠시 후 다시 보면 결과가 반영돼요.",
    tone: "warning",
  },
  APPROVED: {
    label: "전환 준비됨",
    description: "서버 확인이 끝나면 전환 결과가 표시돼요.",
    tone: "info",
  },
  CONVERTED: {
    label: "전환 완료",
    description:
      "실제 KRW로 전환됐어요. 입금 없이 첫 출금으로 이어갈 수 있어요.",
    tone: "success",
  },
  REJECTED: {
    label: "전환 불가",
    description:
      "지금은 전환할 수 없어요. 안내가 있으면 알림에서 확인해 주세요.",
    tone: "danger",
  },
  REVERSED: {
    label: "전환 취소됨",
    description:
      "이전 전환이 보정됐어요. 자세한 내용은 지갑과 알림을 확인해 주세요.",
    tone: "warning",
  },
};

const unknownTrial = {
  label: "상태 확인 중",
  tone: "info" as const,
};

const unknownConversion = {
  label: "상태 확인 중",
  description: "서버 확인이 끝나면 다음 행동이 표시돼요.",
  tone: "info" as const,
};

export function presentTrialStatus(status: string | null | undefined) {
  if (!status) {
    return unknownTrial;
  }
  return trialStatusCopy[status] ?? unknownTrial;
}

export function presentConversionStatus(status: string | null | undefined) {
  if (!status) {
    return unknownConversion;
  }
  return conversionStatusCopy[status] ?? unknownConversion;
}

/**
 * 서버 스냅샷의 remaining_seconds만 읽기 쉽게 바꾼다.
 * 남은 시간을 추정하거나 보상을 계산하지 않는다.
 */
export function formatTrialRemaining(
  remainingSeconds: number | string | null | undefined,
) {
  if (remainingSeconds === null || remainingSeconds === undefined) {
    return "정산 대기";
  }
  const seconds =
    typeof remainingSeconds === "number"
      ? remainingSeconds
      : Number(remainingSeconds);
  if (!Number.isFinite(seconds)) {
    return "확인 중";
  }
  const whole = Math.max(0, Math.floor(seconds));
  if (whole === 0) {
    return "정산 대기";
  }
  if (whole < 60) {
    return "1분 미만";
  }
  if (whole < 3600) {
    return `${Math.floor(whole / 60)}분 이내`;
  }
  const hours = Math.floor(whole / 3600);
  return `${hours}시간 이내`;
}

/**
 * 서버 quota_consumed_bps(0–10000)를 표시용 퍼센트로만 바꾼다.
 * 진행률을 클라이언트에서 증가시키지 않는다.
 */
export function formatTrialQuotaPercent(
  quotaConsumedBps: number | string | null | undefined,
) {
  if (
    quotaConsumedBps === null ||
    quotaConsumedBps === undefined ||
    quotaConsumedBps === ""
  ) {
    return null;
  }
  const bps =
    typeof quotaConsumedBps === "number"
      ? quotaConsumedBps
      : Number(quotaConsumedBps);
  if (!Number.isFinite(bps)) {
    return null;
  }
  return Math.min(100, Math.max(0, bps / 100));
}

export type HomePrimaryAction = {
  href: "/home" | "/mining" | "/start";
  label: string;
};

export function resolveHomePrimaryAction(input: {
  hasMiningSession: boolean;
  miningUnavailable: boolean;
  trialStatus: string | null | undefined;
  trialUnavailable: boolean;
}): HomePrimaryAction {
  if (input.trialUnavailable && input.miningUnavailable) {
    return { href: "/home", label: "상태 다시 확인" };
  }
  if (input.trialStatus === "ACTIVE") {
    return { href: "/start", label: "START 계속하기" };
  }
  if (input.hasMiningSession) {
    return { href: "/mining", label: "채굴 월드 보기" };
  }
  return { href: "/start", label: "첫 채굴 시작" };
}
