begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Deterministic completed trial/KYC inputs. Every conversion below invokes
-- the real canonical command; no BONUS journal or qualification is fabricated.
create temporary table welcome_risk_ctx (
  scenario text primary key, user_id uuid unique, allowed boolean,
  conversion_id uuid, ledger_transaction_id uuid, amount bigint
);
insert into welcome_risk_ctx(scenario,user_id,allowed) values
  ('shared_high','10621000-0000-4000-8000-000000000001',true),
  ('shared_critical','10621000-0000-4000-8000-000000000002',true),
  ('identity_medium','10621000-0000-4000-8000-000000000003',false),
  ('material_high','10621000-0000-4000-8000-000000000004',false),
  ('shared_and_material','10621000-0000-4000-8000-000000000005',false),
  ('resolved_identity','10621000-0000-4000-8000-000000000006',true);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new)
select user_id,'authenticated','authenticated',scenario||'@welcome-risk.putduk.test','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp(),'','','',''
from welcome_risk_ctx;
select public.bootstrap_user(user_id) from welcome_risk_ctx;

insert into public.trial_programs(name,version,is_enabled,duration_seconds,target_reward_krw,
  first_result_target_seconds,first_world_id,completion_copy,effective_at)
select 'welcome-risk-parity',1,false,3600,9000,60,id,'체험 완료',
  statement_timestamp()-interval '2 hours' from public.asset_worlds where code='KOREA';
insert into public.trial_accounts(user_id,trial_program_id,trial_program_version,world_id,status,
  started_at,expires_at,last_settled_at,quota_consumed_bps,reward_atomic,target_reward_krw)
select ctx.user_id,program.id,1,program.first_world_id,'COMPLETED',
  statement_timestamp()-interval '1 hour',statement_timestamp(),statement_timestamp(),10000,9000,9000
from welcome_risk_ctx ctx cross join public.trial_programs program
where program.name='welcome-risk-parity';
insert into public.trial_completions(trial_account_id,user_id,reason,final_quota_bps,final_reward_atomic,completed_at)
select account.id,account.user_id,'QUOTA',10000,9000,statement_timestamp()
from public.trial_accounts account join welcome_risk_ctx ctx on ctx.user_id=account.user_id;
insert into public.kyc_cases(user_id,status,risk_level,decided_at)
select user_id,'APPROVED','LOW',statement_timestamp() from welcome_risk_ctx;
insert into public.risk_flags(user_id,flag_code,severity,source_type,evidence,model_version,
  resolved_at,resolution_reason)
select ctx.user_id,input.code,input.severity,'QUALIFICATION_TEST','{}','risk-parity-v1',
  case when input.resolved then statement_timestamp() end,
  case when input.resolved then 'reviewed test identity issue resolved' end
from welcome_risk_ctx ctx join (values
  ('shared_high','SHARED_IP','HIGH',false),
  ('shared_critical','SHARED_IP','CRITICAL',false),
  ('identity_medium','IDENTITY_REUSE','MEDIUM',false),
  ('material_high','MATERIAL_ABUSE','HIGH',false),
  ('shared_and_material','SHARED_IP','HIGH',false),
  ('shared_and_material','IDENTITY_REUSE','MEDIUM',false),
  ('resolved_identity','IDENTITY_REUSE','CRITICAL',true)
) input(scenario,code,severity,resolved) on input.scenario=ctx.scenario;

grant select,update on welcome_risk_ctx to service_role;
set local role service_role;
update welcome_risk_ctx ctx set
  conversion_id=result.conversion_id,
  ledger_transaction_id=result.ledger_transaction_id,
  amount=result.converted_amount_atomic
from (
  select original.user_id,converted.* from welcome_risk_ctx original
  cross join lateral public.convert_trial_welcome_reward(
    original.user_id,'welcome-risk-'||original.scenario,gen_random_uuid(),1,'risk-parity-v1') converted
  where original.allowed
) result where result.user_id=ctx.user_id;
select throws_ok($$select * from public.convert_trial_welcome_reward(
  (select user_id from welcome_risk_ctx where scenario='identity_medium'),
  'welcome-risk-identity-medium',gen_random_uuid(),1,'risk-parity-v1')$$,
  '55000','WELCOME_REWARD_RISK_REVIEW_REQUIRED','identity reuse MEDIUM requires review');
select throws_ok($$select * from public.convert_trial_welcome_reward(
  (select user_id from welcome_risk_ctx where scenario='material_high'),
  'welcome-risk-material-high',gen_random_uuid(),1,'risk-parity-v1')$$,
  '55000','WELCOME_REWARD_RISK_REVIEW_REQUIRED','material HIGH risk requires review');
select throws_ok($$select * from public.convert_trial_welcome_reward(
  (select user_id from welcome_risk_ctx where scenario='shared_and_material'),
  'welcome-risk-shared-material',gen_random_uuid(),1,'risk-parity-v1')$$,
  '55000','WELCOME_REWARD_RISK_REVIEW_REQUIRED','shared IP does not erase a material blocking flag');
select ok((select bool_and(result.conversion_id=ctx.conversion_id
  and result.ledger_transaction_id=ctx.ledger_transaction_id and not result.was_created)
  from welcome_risk_ctx ctx cross join lateral public.convert_trial_welcome_reward(
    ctx.user_id,'welcome-risk-'||ctx.scenario,gen_random_uuid(),1,'risk-parity-v1') result
  where ctx.allowed),'qualified same-key retries return the original conversion and journal');
reset role;
set constraints all immediate;

select ok((select count(*)=3 and bool_and(amount=5000) from welcome_risk_ctx where allowed),
  'SHARED_IP HIGH/CRITICAL alone and resolved identity retain the existing 5000 cap');
select is((select count(*)::integer from public.trial_reward_conversions conversion
  join welcome_risk_ctx ctx on ctx.user_id=conversion.user_id),3,
  'blocked qualifications and retries create no extra conversion');
select ok((select count(*)=3 and bool_and(qualification.evidence->>'blocking_risk_flags'='0'
  and qualification.evidence->>'shared_ip_alone_rejects'='false')
  from public.trial_qualification_snapshots qualification
  join welcome_risk_ctx ctx on ctx.conversion_id=qualification.conversion_id),
  'qualification evidence records actual blocking policy without falsely claiming no shared IP flags');
select ok((select count(*)=3 and bool_and(movement.source_bucket='BONUS'
  and movement.origin_code='WELCOME_REWARD' and movement.amount_atomic=5000
  and app_private.money_source_credit_verified(movement))
  from public.money_source_movements movement join welcome_risk_ctx ctx
    on ctx.ledger_transaction_id=movement.ledger_transaction_id),
  'only qualified conversions capture verified BONUS, never PRINCIPAL');
select ok((select bool_and(entries=2 and balance=0) from (
  select ctx.user_id,count(*) entries,sum(case when entry.side='DEBIT'
    then entry.amount_atomic else -entry.amount_atomic end) balance
  from welcome_risk_ctx ctx join public.ledger_entries entry
    on entry.transaction_id=ctx.ledger_transaction_id group by ctx.user_id
) balance),'qualified conversions post one balanced two-entry journal');
select is((select count(*)::integer from public.outbox_events event join welcome_risk_ctx ctx
  on event.aggregate_id=ctx.conversion_id where event.event_type='TRIAL_REWARD_CONVERTED.v1'),3,
  'qualified conversions emit one original event each');
select is((select count(*)::integer from public.deposit_requests deposit
  join welcome_risk_ctx ctx on ctx.user_id=deposit.user_id),0,
  'START qualification remains independent from any deposit');
select is((select count(*)::integer from public.ledger_transactions journal
  join welcome_risk_ctx ctx on ctx.user_id=journal.member_user_id where not ctx.allowed),0,
  'blocked qualification has no partial financial journal');
select * from finish();
rollback;
