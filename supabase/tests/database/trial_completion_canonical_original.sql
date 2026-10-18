begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

create temporary table test_context (
  user_id uuid not null,
  program_id uuid,
  curve_id uuid,
  session_id uuid
);

insert into test_context (user_id)
values ('9fb9207f-9a43-4a0d-8bd7-3f453c50420e');

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
select
  user_id,
  'authenticated',
  'authenticated',
  'trial-settlement@putduk.test',
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(), statement_timestamp(), '', '', '', ''
from test_context;

with inserted as (
  insert into public.trial_programs (
    name,
    version,
    is_enabled,
    duration_seconds,
    target_reward_krw,
    first_result_target_seconds,
    first_world_id,
    completion_copy,
    effective_at
  )
  select
    'PGTAP_TRIAL',
    1,
    false,
    3600,
    3000,
    60,
    world.id,
    '테스트 체험 완료',
    statement_timestamp() - interval '4 hours'
  from public.asset_worlds as world
  where world.code = 'KOREA'
  returning id
)
update test_context
set program_id = inserted.id
from inserted;

with inserted as (
  insert into public.trial_reward_curves (
    trial_program_id,
    version,
    effective_at
  )
  select context.program_id, 1, program.effective_at
  from test_context as context
  join public.trial_programs as program on program.id = context.program_id
  returning id
)
update test_context
set curve_id = inserted.id
from inserted;

insert into public.trial_reward_curve_points (
  trial_reward_curve_id,
  sequence,
  elapsed_seconds,
  cumulative_quota_bps,
  cumulative_reward_bps
)
select curve_id, 0, 0, 0, 0 from test_context
union all
select curve_id, 1, 1800, 5000, 5000 from test_context
union all
select curve_id, 2, 3600, 10000, 10000 from test_context;

update public.trial_programs
set is_enabled = true
where id = (select program_id from test_context);

do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
grant select,update on test_context to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select ok(
  (select is_enabled from public.trial_programs where id = (select program_id from test_context)),
  'a complete monotonic trial curve can be enabled'
);

update test_context
set session_id = public.start_trial(user_id, 'pgtap-trial-start-0001');

select isnt(
  (select session_id from test_context),
  null,
  'start_trial creates a server-side session'
);

reset role;
update public.trial_accounts
set
  started_at = statement_timestamp() - interval '30 minutes',
  expires_at = statement_timestamp() + interval '30 minutes',
  last_settled_at = statement_timestamp() - interval '30 minutes'
where user_id = (select user_id from test_context);

update public.trial_sessions
set
  started_at = statement_timestamp() - interval '30 minutes',
  last_settled_at = statement_timestamp() - interval '30 minutes'
where id = (select session_id from test_context);

set local role service_role;
create temporary table first_settlement as
select *
from public.settle_trial(
  (select user_id from test_context),
  'pgtap-trial-settle-0001'
);

select is(
  (select status::text from first_settlement),
  'ACTIVE',
  'midpoint settlement keeps the trial active'
);

select ok(
  (select quota_consumed_bps between 5000 and 5001 from first_settlement),
  'midpoint settlement interpolates quota from server elapsed time'
);

select ok(
  (select reward_atomic between 1500 and 1501 from first_settlement),
  'midpoint settlement interpolates the configured reward curve'
);

select is(
  (
    select count(*)::integer
    from public.trial_ledger
    where user_id = (select user_id from test_context)
  ),
  1,
  'trial settlement creates one append-only ledger delta'
);

select public.settle_trial(
  (select user_id from test_context),
  'pgtap-trial-settle-0001'
);

select is(
  (
    select count(*)::integer
    from public.trial_ledger
    where user_id = (select user_id from test_context)
  ),
  1,
  'repeating an idempotency key does not duplicate the trial ledger'
);

reset role;
update public.trial_accounts
set
  started_at = statement_timestamp() - interval '1 hour',
  expires_at = statement_timestamp(),
  last_settled_at = statement_timestamp() - interval '30 minutes'
where user_id = (select user_id from test_context);

update public.trial_sessions
set
  started_at = statement_timestamp() - interval '1 hour',
  last_settled_at = statement_timestamp() - interval '30 minutes'
where id = (select session_id from test_context);

create function pg_temp.reject_trial_source()returns trigger language plpgsql as $$begin raise exception 'LOCAL_TRIAL_SOURCE_FAULT';end;$$;
create trigger local_trial_source_fault before insert on app_private.trial_completion_originals for each row execute function pg_temp.reject_trial_source();
set local role service_role;
select throws_like($$select * from public.settle_trial((select user_id from test_context),'pgtap-trial-final-fault')$$,'LOCAL_TRIAL_SOURCE_FAULT','original failure rolls back actual trial terminal writer');
select is((select count(*)from public.trial_ledger where user_id=(select user_id from test_context)),1::bigint,'failed terminal writes no second trial delta');
select is((select status::text from public.trial_accounts where user_id=(select user_id from test_context)),'ACTIVE','failed original cannot leave completed account');
reset role;drop trigger local_trial_source_fault on app_private.trial_completion_originals;
set local role service_role;
create temporary table final_settlement as
select *
from public.settle_trial(
  (select user_id from test_context),
  'pgtap-trial-settle-0002'
);

select is(
  (select status::text from final_settlement),
  'COMPLETED',
  'the configured duration completes the trial'
);

select is(
  (select reward_atomic from final_settlement),
  3000::bigint,
  'completion reaches the operator-configured target reward'
);


select public.settle_trial((select user_id from test_context),'pgtap-trial-settle-0002');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_like($$select * from public.settle_trial((select user_id from test_context),'invalid-context-trial')$$,'TRIAL_CLOSED_EXECUTOR_REQUIRED','SQL service role paired with client JWT cannot enter closed trial executor');
select set_config('request.jwt.claims','{}',true);
select throws_like($$select * from public.settle_trial((select user_id from test_context),'missing-context-trial')$$,'TRIAL_CLOSED_EXECUTOR_REQUIRED','missing JWT role cannot bypass closed executor');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_like($$insert into public.trial_ledger(trial_account_id,user_id,direction,entry_type,amount_atomic,idempotency_key,source_type)select id,user_id,'CREDIT','MINING_REWARD',1,'direct-trial-write-forbidden','forged'from public.trial_accounts where user_id=(select user_id from test_context)$$,'permission denied for table trial_ledger','closed executor does not restore raw service ledger INSERT');
select throws_like($$select * from app_private.trial_completion_originals$$,'permission denied for table trial_completion_originals','service cannot inspect private trial original');
reset role;
select is((select count(*)from app_private.trial_completion_originals where user_id=(select user_id from test_context)),1::bigint,'actual completion plus response-loss replay publishes one sealed original');
select lives_ok($$select app_private.assert_trial_completion_original(id)from app_private.trial_completion_originals where user_id=(select user_id from test_context)$$,'original ties actual session/completion/full trial ledger to business clock');
select throws_like($$update public.outbox_events set payload='{}'where id=(select outbox_id from app_private.trial_completion_originals where user_id=(select user_id from test_context))$$,'TRIAL_COMPLETION_SOURCE_IMMUTABLE','trial source envelope immutable after completion');
select throws_like($$update public.trial_accounts set reward_atomic=reward_atomic+1 where user_id=(select user_id from test_context)$$,'TRIAL_COMPLETION_SOURCE_IMMUTABLE','completed reward state cannot drift away from original');
select is((select count(*)from public.ledger_transactions where member_user_id=(select user_id from test_context)),0::bigint,'trial completion alone creates no real wallet money');
select lives_ok($$set constraints all immediate$$,'trial original deferred integrity completes');
set local role authenticated;
select throws_like($$select * from public.settle_trial('9fb9207f-9a43-4a0d-8bd7-3f453c50420e','client-forbidden-final')$$,'permission denied for function settle_trial','client cannot invoke service trial settlement');
reset role;
create temporary table local_trial_source as select outbox_id from app_private.trial_completion_originals where user_id=(select user_id from test_context);
grant select on local_trial_source to service_role;
create function pg_temp.read_trial_source(p_id uuid) returns jsonb language sql security definer set search_path=pg_catalog as $proof$select app_private.read_nonmoney_mission_original(p_id)$proof$;
revoke all on function pg_temp.read_trial_source(uuid) from public;
grant execute on function pg_temp.read_trial_source(uuid) to service_role;
set local role service_role;
select ok((select pg_temp.read_trial_source(outbox_id)->>'member_id'=(select user_id::text from test_context) and pg_temp.read_trial_source(outbox_id)->>'source_type'='TRIAL_COMPLETED.v1' from local_trial_source),'ID-only reader derives the real trial owner and type from sealed completion');
select throws_like($proof$select app_private.read_nonmoney_mission_original(outbox_id)from local_trial_source$proof$,'permission denied for function read_nonmoney_mission_original','service cannot directly invoke private qualification reader');
reset role;
insert into app_private.nonmoney_executor_configuration(singleton,local_qa_enabled,project_identity)values(true,true,'putduk-mining-local-recovery-20261009-fi');
update public.outbox_events set available_at='infinity' where id not in(select outbox_id from local_trial_source);
set local role service_role;
select is((select count(*)from public.claim_outbox_events('trial-original-native',1,300)),1::bigint,'actual worker claims the terminal trial source with a durable lease');
select lives_ok($proof$select public.complete_outbox_event(outbox_id,'trial-original-native')from local_trial_source$proof$,'canonical consumer validates the actual terminal source');
select lives_ok($proof$set constraints all immediate$proof$,'trial source and worker effects preserve native integrity');
reset role;
select is((select count(*)from public.member_event_awards where user_id=(select user_id from test_context)),0::bigint,'trial original alone never creates an award without approved rule and join');
select is((select count(*)from public.outbox_events where id in(select outbox_id from local_trial_source)and status='PROCESSED'),1::bigint,'terminal source closes through the actual worker command');
select is((select count(*)from app_private.domain_notification_originals where source_event_id in(select outbox_id from local_trial_source)),1::bigint,'actual sole-writer sources create one ordinary notice per distinct original');
select is((select count(*)from public.notifications where source_event_id in(select outbox_id from local_trial_source)),1::bigint,'ordinary milestone notices reuse actual original owner only');
select is((select count(*)from public.notifications where source_event_id in(select outbox_id from local_trial_source)and user_id<>(select user_id from test_context)),0::bigint,'milestone notice cannot target a different member');
select is((select count(*)from public.member_event_awards where user_id=(select user_id from test_context)),0::bigint,'ordinary milestone notice does not invent rewards');
set local role service_role;
select lives_ok('set constraints all immediate','milestone ordinary notification source and private projection seals are valid');
reset role;
select * from finish();

rollback;
