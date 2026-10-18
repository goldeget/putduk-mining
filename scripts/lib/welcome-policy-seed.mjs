/**
 * 환영 출금 정책 시드 계획. 순수 함수만 둔다(네트워크·DB 없음).
 *
 * 배경: supabase/migrations/20260927120500_ws04_kyc_admin_session_welcome_seed.sql 은
 * 마이그레이션 시점에 SUPER_ADMIN이 있을 때만 정책을 넣는다. 새 원격 DB는 관리자보다
 * 마이그레이션이 먼저이므로 정책이 비어 있고, 모든 출금이 WITHDRAWAL_POLICY_UNAVAILABLE이 된다.
 * 정책 표는 수정·삭제가 막힌 추가 전용이다. 그래서 관리자 부트스트랩 뒤에 한 번 넣는다.
 *
 * 값은 기존 시드와 같다: 최소 1원, 수수료 0, 환영 보상 상한 5,000원, 입금 불필요.
 */

export const WELCOME_POLICY_DESTINATIONS = Object.freeze([
  "KRW_BANK",
  "USDT_ADDRESS",
]);

export const WELCOME_POLICY_CAP_KRW = 5000;

/**
 * @param {{ destination_type: string; version: number; allows_welcome_reward: boolean }[]} existing
 *   KRW 정책 전체(만료 여부와 상관없이 모든 버전).
 * @param {string} approverId 첫 활성 SUPER_ADMIN의 auth user id
 * @param {Date} now
 */
export function planWelcomePolicySeed(existing, approverId, now) {
  if (!Array.isArray(existing)) throw new Error("POLICY_READ_INVALID");
  if (typeof approverId !== "string" || approverId.length < 8)
    throw new Error("APPROVER_REQUIRED");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("CLOCK_INVALID");

  // 서버 시계와의 오차로 아직 효력이 없는 정책이 되지 않도록 1분 앞선 시각을 쓴다.
  const effectiveAt = new Date(now.getTime() - 60_000).toISOString();
  const rows = [];
  for (const destination of WELCOME_POLICY_DESTINATIONS) {
    const same = existing.filter((row) => row.destination_type === destination);
    if (same.some((row) => row.allows_welcome_reward === true)) continue;
    const nextVersion = same.reduce((max, row) => Math.max(max, row.version), 0) + 1;
    rows.push({
      currency: "KRW",
      destination_type: destination,
      version: nextVersion,
      is_enabled: true,
      minimum_amount_atomic: 1,
      fee_atomic: 0,
      destination_config: {
        welcome_cap_atomic: WELCOME_POLICY_CAP_KRW,
        funding_required: false,
      },
      effective_at: effectiveAt,
      approved_by: approverId,
      allows_welcome_reward: true,
    });
  }
  return rows;
}
