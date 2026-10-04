import { z } from "zod";

/** 화면 단위. 채굴 금액을 다시 계산하지 않는다. */
const MICRO_KRW_PER_KRW = 1_000_000n;

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
};

const unknownRows: AdminMiningFundingRow[] = [
  { label: "인정 원금", value: "확인 필요", tone: "separate" },
  { label: "정산 전 대기 수익", value: "확인 필요", tone: "separate" },
  { label: "아직 확정 전", value: "확인 필요", tone: "unconfirmed" },
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

/**
 * 서버가 나눠 준 인정 원금, 정산 전 대기 수익, 아직 확정 전만 보여 준다.
 * 세 금액은 더하지 않고, 없는 값은 0원으로 만들지 않는다.
 */
export function presentAdminMiningFunding(result: {
  data: unknown;
  error: unknown;
}): AdminMiningFundingView {
  if (result.error) {
    return { state: "unavailable", rows: unknownRows };
  }
  const data = parseDisplay(result.data);
  if (!data) {
    return { state: "unavailable", rows: unknownRows };
  }
  if (!data.available) {
    return { state: "empty", rows: [] };
  }
  return {
    state: "ready",
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
