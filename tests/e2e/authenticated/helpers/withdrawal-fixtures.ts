import { execLocalAdminSql } from "./local-db";

/**
 * 출금 화면 상태 매트릭스용 로컬 표시 픽스처.
 * 원장·hold·finalize 명령 경로를 바꾸지 않는다.
 * 운영 마이그레이션·service_role GRANT·test RPC는 추가하지 않는다.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(label);
  }
}

export function ensureLocalAdmin(userId: string) {
  assertUuid(userId, "WITHDRAWAL_FIXTURE_ADMIN");
  execLocalAdminSql(
    `insert into public.user_roles (user_id, role, granted_by)
     select :'user_id'::uuid, 'ADMIN', :'user_id'::uuid
     where not exists (
       select 1
       from public.user_roles as role
       where role.user_id = :'user_id'::uuid
         and role.role = 'ADMIN'
         and role.revoked_at is null
     )`,
    { user_id: userId },
  );
}

/**
 * 회원 출금 이력에 표시 상태 라벨을 채운다.
 * 잔액·원장과 무관한 UI 증거이며, 실제 출금 hold/송금/확정 경로를 대체하지 않는다.
 */
export function seedWithdrawalStatusMatrix(input: {
  operatorId: string;
  userId: string;
}) {
  assertUuid(input.operatorId, "WITHDRAWAL_FIXTURE_OPERATOR");
  assertUuid(input.userId, "WITHDRAWAL_FIXTURE_MEMBER");
  ensureLocalAdmin(input.operatorId);

  const suffix = input.userId.replace(/-/g, "").slice(0, 12);
  const output = execLocalAdminSql(
    `with wallet as (
       select account.id
       from public.wallet_accounts as account
       where account.user_id = :'user_id'::uuid
         and account.currency = 'KRW'
       limit 1
     ),
     policy as (
       select policy.id
       from public.withdrawal_policies as policy
       where policy.currency = 'KRW'
         and policy.destination_type in ('KRW_BANK', 'BANK_ACCOUNT')
         and policy.is_enabled
         and policy.effective_at <= statement_timestamp()
         and (policy.expires_at is null or policy.expires_at > statement_timestamp())
       order by policy.effective_at desc
       limit 1
     ),
     seeded as (
       insert into public.withdrawal_requests (
         wallet_account_id,
         user_id,
         currency,
         amount_atomic,
         fee_atomic,
         destination_type,
         destination_snapshot,
         status,
         idempotency_key,
         withdrawal_policy_id,
         rejection_reason,
         reviewed_by,
         reviewed_at,
         requested_at
       )
       select
         wallet.id,
         :'user_id'::uuid,
         'KRW',
         seed.amount_atomic,
         0,
         'KRW_BANK',
         jsonb_build_object('fixture', true, 'hint', seed.hint),
         seed.status::public.withdrawal_status,
         seed.idempotency_key,
         policy.id,
         seed.rejection_reason,
         seed.reviewed_by,
         seed.reviewed_at,
         statement_timestamp() - seed.age
       from wallet
       cross join policy
       cross join (
         values
           (1100, 'REQUESTED', :'key_requested', null::text, null::uuid, null::timestamptz, interval '7 minutes', 'KB ****1100'),
           (1200, 'HELD', :'key_held', null::text, null::uuid, null::timestamptz, interval '6 minutes', 'KB ****1200'),
           (1300, 'REVIEWING', :'key_reviewing', null::text, null::uuid, null::timestamptz, interval '5 minutes', 'KB ****1300'),
           (1400, 'PROCESSING', :'key_processing', null::text, null::uuid, null::timestamptz, interval '4 minutes', 'KB ****1400'),
           (1500, 'EXTERNAL_SENT_RECORDED', :'key_sent', null::text, null::uuid, null::timestamptz, interval '3 minutes', 'KB ****1500'),
           (1600, 'COMPLETED', :'key_completed', null::text, null::uuid, null::timestamptz, interval '2 minutes', 'KB ****1600'),
           (1700, 'REJECTED', :'key_rejected', '로컬 화면 증거', :'operator_id'::uuid, statement_timestamp(), interval '1 minute', 'KB ****1700'),
           (1800, 'CANCELLED', :'key_cancelled', null::text, null::uuid, null::timestamptz, interval '0 minutes', 'KB ****1800')
       ) as seed(
         amount_atomic,
         status,
         idempotency_key,
         rejection_reason,
         reviewed_by,
         reviewed_at,
         age,
         hint
       )
       returning id
     )
     select count(*) from seeded`,
    {
      key_cancelled: `e2e-wd-cancelled-${suffix}`,
      key_completed: `e2e-wd-completed-${suffix}`,
      key_held: `e2e-wd-held-${suffix}`,
      key_processing: `e2e-wd-processing-${suffix}`,
      key_rejected: `e2e-wd-rejected-${suffix}`,
      key_requested: `e2e-wd-requested-${suffix}`,
      key_reviewing: `e2e-wd-reviewing-${suffix}`,
      key_sent: `e2e-wd-sent-${suffix}`,
      operator_id: input.operatorId,
      user_id: input.userId,
    },
  );

  const count = output.split(/\r?\n/).filter(Boolean).at(-1);
  if (count !== "8") {
    throw new Error(`WITHDRAWAL_STATUS_MATRIX:${count ?? "empty"}`);
  }
}
