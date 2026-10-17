import { z } from "zod";

import { formatKrw } from "@/app/(control)/_lib/format";

const atomic = z.string().regex(/^(0|[1-9][0-9]{0,37})$/);
const count = z.string().regex(/^(0|[1-9][0-9]*)$/);
const snapshotSchema = z
  .strictObject({
    user_id: z.uuid(),
    schema_version: z.literal(2),
    coverage: z.enum(["COMPLETE", "UNRESOLVED"]),
    unclassified_wallet_entries: count,
    unconnected_withdrawals: count,
    unclassified_journals: count,
    invalid_source_receipts: count,
    eligible_principal_atomic: atomic.nullable(),
    held_principal_atomic: atomic.nullable(),
    recovered_principal_atomic: atomic.nullable(),
    recorded_krw_principal_deposits_atomic: atomic,
    recorded_usdt_principal_credits_atomic: atomic,
    recorded_bonus_atomic: atomic,
    observed_at: z.iso.datetime({ offset: true }),
    capture_started_at: z.iso.datetime({ offset: true }),
  })
  .superRefine((data, context) => {
    const complete = data.coverage === "COMPLETE";
    const missing = [
      data.unclassified_wallet_entries,
      data.unconnected_withdrawals,
      data.unclassified_journals,
      data.invalid_source_receipts,
    ].some((value) => BigInt(value) > 0n);
    const principal =
      BigInt(data.recorded_krw_principal_deposits_atomic) +
      BigInt(data.recorded_usdt_principal_credits_atomic);
    if (
      complete === missing ||
      (complete && data.eligible_principal_atomic === null) ||
      (complete && data.held_principal_atomic === null) ||
      (complete && data.recovered_principal_atomic === null) ||
      (!complete && data.eligible_principal_atomic !== null) ||
      (!complete && data.held_principal_atomic !== null) ||
      (!complete && data.recovered_principal_atomic !== null) ||
      (complete &&
        BigInt(data.eligible_principal_atomic!) +
          BigInt(data.held_principal_atomic!) +
          BigInt(data.recovered_principal_atomic!) !==
          principal) ||
      Date.parse(data.observed_at) < Date.parse(data.capture_started_at)
    ) {
      context.addIssue({
        code: "custom",
        message: "Source coverage or principal receipt is inconsistent.",
      });
    }
  });

/** Read presentation only. It never selects a withdrawal source or a tier. */
export function presentMemberMoneySources(
  result: { data: unknown; error: unknown },
  expectedOwner: string,
) {
  const parsed = snapshotSchema.safeParse(result.data);
  const data =
    !result.error && parsed.success && parsed.data.user_id === expectedOwner
      ? parsed.data
      : null;
  const complete = data?.coverage === "COMPLETE";
  const known = (amount: string | null | undefined) =>
    amount === null || amount === undefined ? "확인 필요" : formatKrw(amount);
  const rows = [
    [
      "누적 원화 원금 입금",
      known(complete ? data.recorded_krw_principal_deposits_atomic : null),
    ],
    [
      "누적 USDT 환산 원금",
      known(complete ? data.recorded_usdt_principal_credits_atomic : null),
    ],
    ["누적 원금 회수", known(data?.recovered_principal_atomic)],
    ["출금 대기 원금", known(data?.held_principal_atomic)],
    ["채굴 인정 원금", known(data?.eligible_principal_atomic)],
    // 등급·용량·속도는 이 자금 구분에 없다. 채굴 조회 결과만 따로 보여 준다.
    // 원장 출처가 맞아도 누적·확정 채굴 수익 금액은 이 조회에 없다.
    ["누적 채굴 수익", "확인 필요"],
    ["확정 채굴 수익", "확인 필요"],
    ["누적 보너스", known(complete ? data.recorded_bonus_atomic : null)],
    ["현재 보너스", known(complete ? data.recorded_bonus_atomic : null)],
    ["총 출금", "확인 필요"],
  ] as const;
  return {
    available: data !== null,
    complete,
    rows,
    observedAt: data?.observed_at ?? null,
    captureStartedAt: data?.capture_started_at ?? null,
    recordedKrwDeposits: known(data?.recorded_krw_principal_deposits_atomic),
    recordedUsdtCredits: known(data?.recorded_usdt_principal_credits_atomic),
  };
}
