import { z } from "zod";

/** domain/mining/economy-policy.ts의 표시 단위. 채굴 비율이 아니다. */
const MICRO_KRW_PER_KRW = 1_000_000n;
const BASIS_POINT_UNIT = 10_000n;

const microText = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .nullable();

const isAtomicText = (value: string) => /^(0|[1-9][0-9]*)$/.test(value);
const atomicText = z.string().regex(/^(0|[1-9][0-9]*)$/);
const serverInstant = z.string().datetime({ offset: true, precision: 6 });

function instantMicroseconds(instant: string) {
  const match = /\.([0-9]{6})(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(instant);
  if (!match) return null;
  const wholeSeconds = instant.slice(0, match.index) + match[2];
  const milliseconds = Date.parse(wholeSeconds);
  return Number.isFinite(milliseconds)
    ? BigInt(milliseconds) * 1_000n + BigInt(match[1]!)
    : null;
}

const exactKrwRatio = z
  .object({
    numerator: atomicText,
    denominator: z.string().regex(/^[1-9][0-9]*$/),
    unit: z.literal("KRW"),
  })
  .strict();

/** Accepted receipt facts and conditional amounts are separate from wallet balance. */
const fundedRuntimeFields = {
  runtime_version: z.literal(2),
  state_revision: atomicText,
  condition_revision: atomicText,
  accepted_cursor_at: serverInstant,
  evaluated_at: serverInstant,
  allocation_bps: atomicText,
  committed_reward_total_atomic: atomicText,
  reward_carry: exactKrwRatio.refine(
    (ratio) =>
      isAtomicText(ratio.numerator) &&
      /^[1-9][0-9]*$/.test(ratio.denominator) &&
      BigInt(ratio.numerator) < BigInt(ratio.denominator),
  ),
  conditional_maintenance: exactKrwRatio.extend({
    qualification: z.literal("UNCONFIRMED"),
  }),
};

const exactMultiplier = z
  .object({
    numerator: atomicText,
    denominator: z.string().regex(/^[1-9][0-9]*$/),
  })
  .strict();

const boundedBps = (minimum: bigint, maximum: bigint) =>
  atomicText.refine((value) => {
    if (!isAtomicText(value)) return false;
    const bps = BigInt(value);
    return bps >= minimum && bps <= maximum;
  });

const fundedRuntimeV1 = z
  .object({ schema_version: z.literal(1), ...fundedRuntimeFields })
  .strict();

const fundedRuntimeV2 = z
  .object({
    schema_version: z.literal(2),
    ...fundedRuntimeFields,
    status: z.enum(["ACTIVE", "STOPPED"]),
    stop_reason: z
      .enum(["NO_ACTIVE_ALLOCATION", "CAPACITY_USED", "SAFE_MODE"])
      .nullable(),
    speed: z
      .object({
        product_multiplier_bps: boundedBps(9_000n, 11_000n),
        user_multiplier_bps: boundedBps(8_000n, 12_000n),
        common_multiplier: exactMultiplier.refine(
          (ratio) =>
            isAtomicText(ratio.numerator) &&
            /^[1-9][0-9]*$/.test(ratio.denominator) &&
            BigInt(ratio.numerator) >= BigInt(ratio.denominator),
        ),
        effective_global_multiplier: exactMultiplier.refine(
          (ratio) =>
            isAtomicText(ratio.numerator) &&
            /^[1-9][0-9]*$/.test(ratio.denominator) &&
            BigInt(ratio.numerator) * 2n <= BigInt(ratio.denominator) * 3n,
        ),
      })
      .strict(),
  })
  .strict()
  .refine((value) => {
    if (
      !isAtomicText(value.allocation_bps) ||
      !isAtomicText(value.speed.effective_global_multiplier.numerator)
    )
      return false;
    const activeAllocation = BigInt(value.allocation_bps) > 0n;
    const positiveSpeed =
      BigInt(value.speed.effective_global_multiplier.numerator) > 0n;
    if (value.status === "ACTIVE") {
      return value.stop_reason === null && activeAllocation && positiveSpeed;
    }
    // GLOBAL is an independent server-proven permission stop. Its configured
    // speed/allocation remain factual inputs; clients never derive a pause.
    if (value.stop_reason === "SAFE_MODE") {
      return activeAllocation === positiveSpeed;
    }
    if (value.stop_reason === "NO_ACTIVE_ALLOCATION") {
      return !activeAllocation && !positiveSpeed;
    }
    return (
      value.stop_reason === "CAPACITY_USED" && activeAllocation && positiveSpeed
    );
  });

/** V1 proves receipt facts only. V2 additionally proves server-evaluated accrual permission. */
export const fundedRuntimeDisplaySchema = z
  .union([fundedRuntimeV1, fundedRuntimeV2])
  .refine(
    (value) =>
      isAtomicText(value.allocation_bps) &&
      BigInt(value.allocation_bps) <= 10_000n,
  )
  .refine((value) => {
    const accepted = instantMicroseconds(value.accepted_cursor_at);
    const evaluated = instantMicroseconds(value.evaluated_at);
    return accepted !== null && evaluated !== null && accepted <= evaluated;
  });

export type FundedRuntimeDisplay = z.infer<typeof fundedRuntimeDisplaySchema>;

/** Requires the strictly validated server DTO; legacy receipt facts never imply running. */
export function resolveFundedRuntimeStatus(
  runtime: FundedRuntimeDisplay | null | undefined,
): "ACTIVE" | "STOPPED" | "UNKNOWN" {
  return runtime?.schema_version === 2 ? runtime.status : "UNKNOWN";
}

export const miningServerDisplaySchema = z
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
    funded_runtime: fundedRuntimeDisplaySchema.optional(),
  })
  .strict();

export type MiningServerDisplay = z.infer<typeof miningServerDisplaySchema>;

export type MiningAmountRow = {
  label: string;
  value: string;
};

export type MiningAmountView =
  { state: "empty" } | { state: "ready"; rows: MiningAmountRow[] };

const missingLabel = "아직 없어요";
const unreadableLabel = "확인할 수 없어요";

const seoulWhen = new Intl.DateTimeFormat("ko-KR", {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "numeric",
  timeZone: "Asia/Seoul",
});

function wholeMicro(micro: string) {
  return BigInt(micro);
}

/** 이미 계산된 micro-KRW를 화면 원화로만 바꾼다. 채굴 금액은 다시 계산하지 않는다. */
export function formatMiningMicroKrw(micro: string | null) {
  if (micro === null) {
    return missingLabel;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(micro)) {
    return unreadableLabel;
  }
  const value = wholeMicro(micro);
  const whole = value / MICRO_KRW_PER_KRW;
  const fraction = value % MICRO_KRW_PER_KRW;
  const wholeText = whole.toLocaleString("ko-KR");
  if (fraction === 0n) {
    return `${wholeText}원`;
  }
  // Member copy uses whole won. Truncate only this label; authoritative
  // amounts, fractional accrual and ledger carry remain untouched.
  return whole === 0n ? "1원 미만" : `약 ${wholeText}원`;
}

/** 이미 계산된 basis point를 배속으로만 보여 준다. */
export function formatMiningSpeedBps(bps: string | null) {
  if (bps === null) {
    return missingLabel;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(bps)) {
    return unreadableLabel;
  }
  const value = wholeMicro(bps);
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

/** Format the supplied server ratio; never combine allocation or speed effects. */
function formatFundedSpeed(runtime: FundedRuntimeDisplay) {
  if (runtime.schema_version !== 2) return unreadableLabel;
  const ratio = runtime.speed.effective_global_multiplier;
  const numerator = BigInt(ratio.numerator);
  const denominator = BigInt(ratio.denominator);
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  let fraction = "";
  for (let digit = 0; digit < 6 && remainder > 0n; digit++) {
    remainder *= 10n;
    fraction += (remainder / denominator).toString();
    remainder %= denominator;
  }
  const value = `${whole}${fraction ? `.${fraction}` : ""}배`;
  return remainder > 0n ? `약 ${value}` : value;
}

export function formatMiningPeriod(start: string | null, end: string | null) {
  if (!start || !end) {
    return missingLabel;
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return unreadableLabel;
  }
  return `${seoulWhen.format(startDate)} – ${seoulWhen.format(endDate)}`;
}

function formatTier(activated: boolean, code: string | null) {
  if (!activated || !code) {
    return "적용 전";
  }
  return code;
}

export function parseMiningServerDisplay(value: unknown) {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  const parsed = miningServerDisplaySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** 원금 행이 없을 때의 빈 표시. 금액을 0원으로 만들지 않는다. */
export const emptyMiningServerDisplay: MiningServerDisplay = {
  available: false,
  eligible_principal_micro_krw: null,
  tier_code: null,
  tier_activated: false,
  cycle_started_at: null,
  cycle_end: null,
  effective_capacity_micro_krw: null,
  remaining_capacity_micro_krw: null,
  used_capacity_micro_krw: null,
  speed_multiplier_bps: null,
  pending_micro_krw: null,
  retention_unconfirmed_micro_krw: null,
};

type MiningDisplayRead = {
  data: unknown;
  error: unknown;
};

function readErrorMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) {
    return "";
  }
  return typeof error.message === "string" ? error.message : "";
}

/** 원금 주체가 없다는 서버 거절만 빈 상태로 본다. */
export function isAbsentPrincipalFailure(error: unknown) {
  return readErrorMessage(error).includes(
    "FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND",
  );
}

function principalLotRows(data: unknown) {
  if (data == null) {
    return [];
  }
  return Array.isArray(data) ? data : null;
}

/**
 * 표시 조회가 성공하면 그 값을 그대로 쓴다.
 * 조회가 실패해도 원금 행이 없으면 빈 표시다. 행이 있는데 실패하면 오류를 유지한다.
 */
export function resolveMiningServerDisplayRead(
  display: MiningDisplayRead,
  principalLots: MiningDisplayRead | null,
): MiningDisplayRead {
  if (!display.error && display.data != null) {
    return display;
  }
  if (!display.error || isAbsentPrincipalFailure(display.error)) {
    return { data: emptyMiningServerDisplay, error: null };
  }
  if (!principalLots || principalLots.error) {
    return display;
  }
  const rows = principalLotRows(principalLots.data);
  if (rows && rows.length === 0) {
    return { data: emptyMiningServerDisplay, error: null };
  }
  return display;
}

/**
 * 서버가 돌려준 표시값만 한국어 행으로 바꾼다.
 * 정산 전과 확인 전은 더하지 않는다.
 */
export function presentMiningServerDisplay(
  input: MiningServerDisplay,
): MiningAmountView {
  if (!input.available) {
    return { state: "empty" };
  }

  return {
    state: "ready",
    rows: [
      {
        label: "인정 원금",
        value: formatMiningMicroKrw(input.eligible_principal_micro_krw),
      },
      {
        label: "등급",
        value: formatTier(input.tier_activated, input.tier_code),
      },
      {
        label: "기간",
        value: formatMiningPeriod(input.cycle_started_at, input.cycle_end),
      },
      {
        label: "이번 한도",
        value: formatMiningMicroKrw(input.effective_capacity_micro_krw),
      },
      {
        label: "남은 한도",
        value: formatMiningMicroKrw(input.remaining_capacity_micro_krw),
      },
      {
        label: "사용한 한도",
        value: formatMiningMicroKrw(input.used_capacity_micro_krw),
      },
      {
        label: "속도",
        value: input.funded_runtime
          ? formatFundedSpeed(input.funded_runtime)
          : formatMiningSpeedBps(input.speed_multiplier_bps),
      },
      {
        label: "정산 전",
        value: formatMiningMicroKrw(input.pending_micro_krw),
      },
      {
        label: "확인 전",
        value: formatMiningMicroKrw(input.retention_unconfirmed_micro_krw),
      },
      ...(input.funded_runtime
        ? [
            {
              label: "채굴 확정 누계",
              value: `${BigInt(input.funded_runtime.committed_reward_total_atomic).toLocaleString("ko-KR")}원`,
            },
            {
              label: "반영 시각",
              value: seoulWhen.format(
                new Date(input.funded_runtime.accepted_cursor_at),
              ),
            },
          ]
        : []),
    ],
  };
}
