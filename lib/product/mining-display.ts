export const miningRouteLoadingLabel = "채굴 월드 불러오는 중";

export type MiningStatusTone =
  "danger" | "info" | "neutral" | "success" | "warning";

const miningStatusCopy: Record<
  string,
  { label: string; tone: MiningStatusTone }
> = {
  NORMAL: { label: "채굴 중", tone: "success" },
  REDUCED: { label: "속도 조정 중", tone: "warning" },
  MAINTENANCE: { label: "점검 중", tone: "warning" },
  PARTIAL_STOP: { label: "일부 기능 중지", tone: "warning" },
  STOPPED: { label: "중지", tone: "danger" },
};

const unknownStatus = {
  label: "상태 확인 중",
  tone: "info" as const,
};

const seoulClock = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});

export function presentMiningStatus(status: string | null | undefined) {
  if (!status) {
    return unknownStatus;
  }
  return miningStatusCopy[status] ?? unknownStatus;
}

export function formatMiningClock(value: string | null | undefined) {
  if (!value) {
    return "확인 중";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "확인 중";
  }
  return seoulClock.format(date);
}

/**
 * 서버 스냅샷의 초 단위 경과를 화면 문구로만 바꾼다.
 * 보상 금액이나 채굴 속도를 계산하지 않는다.
 */
export function formatMiningElapsed(
  secondsValue: number | string | null | undefined,
) {
  if (
    secondsValue === null ||
    secondsValue === undefined ||
    secondsValue === ""
  ) {
    return "확인 중";
  }
  const seconds =
    typeof secondsValue === "number" ? secondsValue : Number(secondsValue);
  if (!Number.isFinite(seconds)) {
    return "확인 중";
  }
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  if (wholeSeconds < 60) {
    return "1분 미만";
  }
  if (wholeSeconds < 3600) {
    return `${Math.floor(wholeSeconds / 60)}분`;
  }
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  return minutes ? `${hours}시간 ${minutes}분` : `${hours}시간`;
}
