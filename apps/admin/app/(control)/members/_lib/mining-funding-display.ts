import { z } from "zod";

export { resolveMiningServerDisplayRead } from "../../../../../../lib/product/mining-server-display";

/** 화면 단위. 채굴 금액과 속도를 다시 계산하지 않는다. */
const MICRO_KRW_PER_KRW = 1_000_000n;
const BASIS_POINT_UNIT = 10_000n;
const unreadLabel = "확인할 수 없어요";

const microText = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .nullable();

const displaySchema = z
  .object({
    available: z.boolean(),
    eligible_principal_micro_krw: microText,
    tier_code: z
      .string()
      .regex(/^[A-Za-z0-9_+-]{1,32}$/)
      .nullable(),
    tier_activated: z.boolean(),
    cycle_started_at: z.string().nullable(),
    cycle_end: z.string().nullable(),
    effective_capacity_micro_krw: microText,
    remaining_capacity_micro_krw: microText,
    used_capacity_micro_krw: microText,
    speed_multiplier_bps: microText,
    pending_micro_krw: microText,
    retention_unconfirmed_micro_krw: microText,
  })
  .strict();

export type AdminMiningFundingRow = {
  label: string;
  value: string;
  tone: "separate" | "unconfirmed";
};

export type AdminMiningFundingView = {
  state: "ready" | "empty" | "unavailable";
  rows: AdminMiningFundingRow[];
  miningRows: AdminMiningFundingRow[];
  cycleRows: AdminMiningFundingRow[];
};

const unknownRows: AdminMiningFundingRow[] = [
  { label: "인정 원금", value: "확인 필요", tone: "separate" },
  { label: "정산 전 대기 수익", value: "확인 필요", tone: "separate" },
  { label: "아직 확정 전", value: "확인 필요", tone: "unconfirmed" },
];

const unknownMiningRows: AdminMiningFundingRow[] = [
  { label: "등급", value: unreadLabel, tone: "separate" },
  { label: "채굴 용량", value: unreadLabel, tone: "separate" },
  { label: "남은 용량", value: unreadLabel, tone: "separate" },
  { label: "사용한 용량", value: unreadLabel, tone: "separate" },
  { label: "속도", value: unreadLabel, tone: "separate" },
];

const unknownCycleRows: AdminMiningFundingRow[] = [
  { label: "주기 시작", value: unreadLabel, tone: "separate" },
  { label: "주기 끝", value: unreadLabel, tone: "separate" },
];

function parseDisplay(value: unknown) {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  const parsed = displaySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** 서버가 이미 계산한 micro 원화를 화면 금액으로만 바꾼다. */
export function formatAdminMicroKrw(micro: string | null) {
  if (micro === null) {
    return "아직 없어요";
  }
  if (!/^(0|[1-9][0-9]*)$/.test(micro)) {
    return "확인 필요";
  }
  const value = BigInt(micro);
  const whole = value / MICRO_KRW_PER_KRW;
  const fraction = value % MICRO_KRW_PER_KRW;
  const wholeText = whole.toLocaleString("ko-KR");
  if (fraction === 0n) {
    return `${wholeText}원`;
  }
  const width = MICRO_KRW_PER_KRW.toString().length - 1;
  const fractionText = fraction
    .toString()
    .padStart(width, "0")
    .replace(/0+$/, "");
  return `${wholeText}.${fractionText}원`;
}

/** 없는 용량은 0원으로 바꾸지 않는다. */
function formatAdminKnownMicro(micro: string | null) {
  if (micro === null) {
    return unreadLabel;
  }
  const formatted = formatAdminMicroKrw(micro);
  return formatted === "아직 없어요" || formatted === "확인 필요"
    ? unreadLabel
    : formatted;
}

/** 서버가 준 배율만 보여 준다. 없는 속도는 0배가 아니다. */
function formatAdminSpeed(bps: string | null) {
  if (bps === null || !/^(0|[1-9][0-9]*)$/.test(bps)) {
    return unreadLabel;
  }
  const value = BigInt(bps);
  const whole = value / BASIS_POINT_UNIT;
  const fraction = value % BASIS_POINT_UNIT;
  if (fraction === 0n) {
    return `${whole.toString()}배`;
  }
  const width = BASIS_POINT_UNIT.toString().length - 1;
  const fractionText = fraction
    .toString()
    .padStart(width, "0")
    .replace(/0+$/, "");
  return `${whole.toString()}.${fractionText}배`;
}

/** 서버가 준 주기 시각만 보여 준다. 없는 시각은 0원이나 오늘이 아니다. */
function formatAdminCycle(value: string | null) {
  if (value === null || value.trim() === "") return unreadLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return unreadLabel;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function presentCycle(
  started: string | null,
  end: string | null,
): AdminMiningFundingRow[] {
  return [
    {
      label: "주기 시작",
      tone: "separate",
      value: formatAdminCycle(started),
    },
    { label: "주기 끝", tone: "separate", value: formatAdminCycle(end) },
  ];
}

function formatAdminTier(activated: boolean, code: string | null) {
  if (!activated) {
    return "적용 전";
  }
  return code ? code : unreadLabel;
}

function presentMiningPace(data: {
  tier_code: string | null;
  tier_activated: boolean;
  effective_capacity_micro_krw: string | null;
  remaining_capacity_micro_krw: string | null;
  used_capacity_micro_krw: string | null;
  speed_multiplier_bps: string | null;
}): AdminMiningFundingRow[] {
  return [
    {
      label: "등급",
      tone: "separate",
      value: formatAdminTier(data.tier_activated, data.tier_code),
    },
    {
      label: "채굴 용량",
      tone: "separate",
      value: formatAdminKnownMicro(data.effective_capacity_micro_krw),
    },
    {
      label: "남은 용량",
      tone: "separate",
      value: formatAdminKnownMicro(data.remaining_capacity_micro_krw),
    },
    {
      label: "사용한 용량",
      tone: "separate",
      value: formatAdminKnownMicro(data.used_capacity_micro_krw),
    },
    {
      label: "속도",
      tone: "separate",
      value: formatAdminSpeed(data.speed_multiplier_bps),
    },
  ];
}

/**
 * 서버가 나눠 준 인정 원금, 정산 전 대기 수익, 아직 확정 전만 보여 준다.
 * 등급·용량·속도·주기는 그 금액과 더하지 않는다. 없는 값은 0원으로 만들지 않는다.
 */
export function presentAdminMiningFunding(result: {
  data: unknown;
  error: unknown;
}): AdminMiningFundingView {
  if (result.error) {
    return {
      state: "unavailable",
      rows: unknownRows,
      miningRows: unknownMiningRows,
      cycleRows: unknownCycleRows,
    };
  }
  const data = parseDisplay(result.data);
  if (!data) {
    return {
      state: "unavailable",
      rows: unknownRows,
      miningRows: unknownMiningRows,
      cycleRows: unknownCycleRows,
    };
  }
  if (!data.available) {
    return { state: "empty", rows: [], miningRows: [], cycleRows: [] };
  }
  return {
    state: "ready",
    miningRows: presentMiningPace(data),
    cycleRows: presentCycle(data.cycle_started_at, data.cycle_end),
    rows: [
      {
        label: "인정 원금",
        tone: "separate",
        value: formatAdminMicroKrw(data.eligible_principal_micro_krw),
      },
      {
        label: "정산 전 대기 수익",
        tone: "separate",
        value: formatAdminMicroKrw(data.pending_micro_krw),
      },
      {
        label: "아직 확정 전",
        tone: "unconfirmed",
        value: formatAdminMicroKrw(data.retention_unconfirmed_micro_krw),
      },
    ],
  };
}
