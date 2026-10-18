begin;
-- Existing trial writer/curve/ledger retained. Its closed executor owns all writes;
-- direct service INSERT cannot append an unsealed trial delta or completion.
revoke insert on public.trial_ledger,public.trial_completions from service_role;
create table app_private.trial_completion_originals(
 id uuid primary key default gen_random_uuid(),completion_id uuid not null unique references public.trial_completions(id),
 account_id uuid not null unique references public.trial_accounts(id),session_id uuid not null references public.trial_sessions(id),
 user_id uuid not null references auth.users(id),effective_at timestamptz not null,observed_at timestamptz not null,
 snapshot jsonb not null,digest text not null,outbox_id uuid not null unique references public.outbox_events(id) deferrable initially deferred);
alter table app_private.trial_completion_originals enable row level security;
alter table app_private.trial_completion_originals force row level security;
revoke all on app_private.trial_completion_originals from public,anon,authenticated,service_role;
create trigger trial_completion_original_immutable before update or delete on app_private.trial_completion_originals
for each row execute function app_private.prevent_row_mutation();
create function app_private.trial_completion_snapshot(p_completion uuid,p_session uuid)returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
select jsonb_build_object('completion',to_jsonb(c),'session',jsonb_build_object('id',s.id,'user_id',s.user_id,
 'account_id',s.trial_account_id,'started_at',s.started_at,'last_settled_at',s.last_settled_at,'ended_at',s.ended_at,'idempotency_key',s.idempotency_key),
 'account',jsonb_build_object('id',a.id,'user_id',a.user_id,'program_id',a.trial_program_id,'program_version',a.trial_program_version,
 'world_id',a.world_id,'started_at',a.started_at,'expires_at',a.expires_at,'last_settled_at',a.last_settled_at,
 'quota_consumed_bps',a.quota_consumed_bps,'reward_atomic',a.reward_atomic,'target_reward_krw',a.target_reward_krw),
 'trial_credits',coalesce((select jsonb_agg(to_jsonb(l) order by l.id)from public.trial_ledger l where l.trial_account_id=a.id and l.direction='CREDIT' and l.entry_type='MINING_REWARD'),'[]'))
from public.trial_completions c join public.trial_accounts a on a.id=c.trial_account_id
join public.trial_sessions s on s.id=p_session and s.trial_account_id=a.id where c.id=p_completion;
$$;
create function app_private.assert_trial_completion_original(p_id uuid)returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare o app_private.trial_completion_originals%rowtype;c public.trial_completions%rowtype;
 a public.trial_accounts%rowtype;s public.trial_sessions%rowtype;e public.outbox_events%rowtype;
begin
 select * into o from app_private.trial_completion_originals where id=p_id;
 select * into c from public.trial_completions where id=o.completion_id;
 select * into a from public.trial_accounts where id=o.account_id;
 select * into s from public.trial_sessions where id=o.session_id;
 select * into e from public.outbox_events where id=o.outbox_id;
 if o.id is null or c.id is null or a.status<>'COMPLETED' or s.id is null
  or row(o.user_id,o.account_id,o.effective_at)is distinct from row(c.user_id,c.trial_account_id,c.completed_at)
  or a.user_id is distinct from o.user_id or s.user_id is distinct from o.user_id or s.trial_account_id is distinct from a.id
  or c.completed_at is distinct from s.ended_at or a.last_settled_at is distinct from c.completed_at or s.last_settled_at is distinct from c.completed_at
  or c.completed_at<a.started_at or c.completed_at>a.expires_at or c.completed_at>o.observed_at or o.observed_at>clock_timestamp()
  or c.final_quota_bps is distinct from a.quota_consumed_bps or c.final_reward_atomic is distinct from a.reward_atomic
  or c.final_reward_atomic is distinct from(select coalesce(sum(amount_atomic),0)::bigint from public.trial_ledger where trial_account_id=a.id and direction='CREDIT' and entry_type='MINING_REWARD')
  or(c.reason='TIME' and c.completed_at<>a.expires_at)or(c.reason='QUOTA' and c.final_quota_bps<>10000)
  or o.snapshot is distinct from app_private.trial_completion_snapshot(c.id,s.id)or o.digest is distinct from app_private.funding_engine_digest(o.snapshot)
  or e.id is null or e.event_type<>'TRIAL_COMPLETED.v1' or e.schema_version<>1 or e.aggregate_type<>'trial_completion'
  or e.aggregate_id is distinct from c.id or e.actor_user_id is distinct from o.user_id
  or e.occurred_at is distinct from o.effective_at or e.created_at is distinct from o.observed_at
  or e.payload is distinct from jsonb_build_object('user_id',o.user_id,'original_id',o.id,'completion_id',c.id,'digest',o.digest)
  or e.idempotency_key is distinct from 'trial-completion:'||c.id::text then raise exception using errcode='55000',message='TRIAL_COMPLETION_ORIGINAL_INVALID';end if;
end;$$;
create function app_private.emit_trial_completion(p_account uuid,p_session uuid)returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare c public.trial_completions%rowtype;o app_private.trial_completion_originals%rowtype;request_id uuid:=gen_random_uuid();
begin
 select * into c from public.trial_completions where trial_account_id=p_account;
 if c.id is null then raise exception using errcode='55000',message='ACTUAL_TRIAL_COMPLETION_REQUIRED';end if;
 select * into o from app_private.trial_completion_originals where completion_id=c.id;
 if o.id is not null then perform app_private.assert_trial_completion_original(o.id);return;end if;
 o.id:=gen_random_uuid();o.completion_id:=c.id;o.account_id:=p_account;o.session_id:=p_session;o.user_id:=c.user_id;
 o.effective_at:=c.completed_at;o.observed_at:=clock_timestamp();o.snapshot:=app_private.trial_completion_snapshot(c.id,p_session);
 o.digest:=app_private.funding_engine_digest(o.snapshot);o.outbox_id:=gen_random_uuid();
 insert into app_private.trial_completion_originals select o.*;
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,request_id,correlation_id,idempotency_key,occurred_at,created_at)
 values(o.outbox_id,'TRIAL_COMPLETED.v1',1,'trial_completion',c.id,c.user_id,
 jsonb_build_object('user_id',c.user_id,'original_id',o.id,'completion_id',c.id,'digest',o.digest),request_id,request_id,'trial-completion:'||c.id::text,c.completed_at,o.observed_at);
 perform app_private.assert_trial_completion_original(o.id);
end;$$;
create function app_private.verify_trial_completion_original_commit()returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin perform app_private.assert_trial_completion_original(new.id);return null;end;$$;
create constraint trigger trial_completion_original_complete after insert on app_private.trial_completion_originals
deferrable initially deferred for each row execute function app_private.verify_trial_completion_original_commit();
create function app_private.guard_trial_completion_source()returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare old_json jsonb:=to_jsonb(old);new_json jsonb:=to_jsonb(new);sealed boolean;
begin
 if tg_table_name='outbox_events'then
  sealed:=exists(select 1 from app_private.trial_completion_originals where outbox_id=(old_json->>'id')::uuid);
  old_json:=old_json-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at'];
  new_json:=new_json-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at'];
 elsif tg_table_name='trial_sessions'then
  sealed:=exists(select 1 from app_private.trial_completion_originals where session_id=(old_json->>'id')::uuid);
  old_json:=old_json-'created_at';new_json:=new_json-'created_at';
 elsif tg_table_name='trial_accounts'then
  sealed:=exists(select 1 from app_private.trial_completion_originals where account_id=(old_json->>'id')::uuid);
  old_json:=old_json-array['created_at','updated_at'];new_json:=new_json-array['created_at','updated_at'];
 else sealed:=exists(select 1 from app_private.trial_completion_originals where completion_id=(old_json->>'id')::uuid);end if;
 if sealed and(tg_op='DELETE' or new_json is distinct from old_json)then raise exception using errcode='55000',message='TRIAL_COMPLETION_SOURCE_IMMUTABLE';end if;
 if tg_op='DELETE'then return old;end if;return new;
end;$$;
create trigger trial_completion_outbox_immutable before update or delete on public.outbox_events for each row execute function app_private.guard_trial_completion_source();
create trigger trial_completion_domain_immutable before update or delete on public.trial_completions for each row execute function app_private.guard_trial_completion_source();
create trigger trial_completion_account_immutable before update or delete on public.trial_accounts for each row execute function app_private.guard_trial_completion_source();
create trigger trial_completion_session_immutable before update or delete on public.trial_sessions for each row execute function app_private.guard_trial_completion_source();
revoke all on function app_private.trial_completion_snapshot(uuid,uuid),app_private.assert_trial_completion_original(uuid),app_private.emit_trial_completion(uuid,uuid),
 app_private.verify_trial_completion_original_commit(),app_private.guard_trial_completion_source()from public,anon,authenticated,service_role;
create function app_private.execute_trial_settlement(
  p_user_id uuid,
  p_idempotency_key text
)
returns table (
  trial_account_id uuid,
  status public.trial_status,
  quota_consumed_bps integer,
  reward_atomic bigint,
  completion_reason public.trial_completion_reason
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_account public.trial_accounts%rowtype;
  v_completion_reason public.trial_completion_reason;
  v_curve_id uuid;
  v_elapsed_seconds integer;
  v_existing_status text;
  v_idempotency_id uuid;
  v_now timestamptz := statement_timestamp();
  v_previous public.trial_reward_curve_points%rowtype;
  v_next public.trial_reward_curve_points%rowtype;
  v_quota_bps integer;
  v_reward_bps integer;
  v_reward_delta bigint;
  v_session public.trial_sessions%rowtype;
  v_settle_to timestamptz;
  v_target_reward_atomic bigint;
begin
  if current_user<>'postgres' or ((current_setting('role',true)='service_role' and auth.role()='service_role')
   or(current_setting('role',true)='none' and session_user='postgres'))is distinct from true then raise exception using errcode='42501',message='TRIAL_CLOSED_EXECUTOR_REQUIRED';end if;
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  insert into app_private.idempotency_keys (
    scope,
    actor_id,
    idempotency_key,
    request_hash,
    status,
    locked_until
  ) values (
    'trial.settle',
    p_user_id,
    p_idempotency_key,
    encode(extensions.digest(p_user_id::text, 'sha256'), 'hex'),
    'PROCESSING',
    v_now + interval '5 minutes'
  )
  on conflict (scope, actor_id, idempotency_key) do nothing
  returning id into v_idempotency_id;

  if v_idempotency_id is null then
    select key_record.status
    into v_existing_status
    from app_private.idempotency_keys as key_record
    where key_record.scope = 'trial.settle'
      and key_record.actor_id = p_user_id
      and key_record.idempotency_key = p_idempotency_key;

    if v_existing_status <> 'COMPLETED' then
      raise exception using errcode = '40001', message = 'TRIAL_SETTLEMENT_IN_PROGRESS';
    end if;
  end if;

  select account.*
  into v_account
  from public.trial_accounts as account
  where account.user_id = p_user_id
  for update;

  if v_account.id is null then
    raise exception using errcode = 'P0001', message = 'TRIAL_ACCOUNT_NOT_FOUND';
  end if;

  if v_existing_status = 'COMPLETED'
    or v_account.status in ('COMPLETED', 'EXPIRED')
  then
    select completion.reason
    into v_completion_reason
    from public.trial_completions as completion
    where completion.trial_account_id = v_account.id;

    if v_idempotency_id is not null then
      update app_private.idempotency_keys
      set
        status = 'COMPLETED',
        response_status = 200,
        response_payload = jsonb_build_object('trial_account_id', v_account.id),
        completed_at = statement_timestamp(),
        locked_until = null
      where id = v_idempotency_id;
    end if;

    return query
    select
      v_account.id,
      v_account.status,
      v_account.quota_consumed_bps,
      v_account.reward_atomic,
      v_completion_reason;
    return;
  end if;

  if v_account.status <> 'ACTIVE'
    or v_account.started_at is null
    or v_account.expires_at is null
    or v_account.last_settled_at is null
  then
    raise exception using errcode = '55000', message = 'TRIAL_NOT_ACTIVE';
  end if;

  select session.*
  into v_session
  from public.trial_sessions as session
  where session.trial_account_id = v_account.id
    and session.user_id = p_user_id
    and session.ended_at is null
  order by session.started_at desc
  limit 1
  for update;

  if v_session.id is null then
    raise exception using errcode = 'P0001', message = 'ACTIVE_TRIAL_SESSION_MISSING';
  end if;

  v_settle_to := least(v_now, v_account.expires_at);

  select curve.id
  into v_curve_id
  from public.trial_reward_curves as curve
  where curve.trial_program_id = v_account.trial_program_id
    and curve.effective_at <= v_account.started_at
  order by curve.effective_at desc, curve.version desc
  limit 1;

  if v_curve_id is null then
    raise exception using errcode = 'P0001', message = 'TRIAL_REWARD_CURVE_UNAVAILABLE';
  end if;

  v_elapsed_seconds := greatest(
    0,
    floor(extract(epoch from v_settle_to - v_account.started_at))::integer
  );

  select point.*
  into v_previous
  from public.trial_reward_curve_points as point
  where point.trial_reward_curve_id = v_curve_id
    and point.elapsed_seconds <= v_elapsed_seconds
  order by point.elapsed_seconds desc
  limit 1;

  select point.*
  into v_next
  from public.trial_reward_curve_points as point
  where point.trial_reward_curve_id = v_curve_id
    and point.elapsed_seconds >= v_elapsed_seconds
  order by point.elapsed_seconds asc
  limit 1;

  if v_previous.id is null or v_next.id is null then
    raise exception using errcode = 'P0001', message = 'TRIAL_REWARD_CURVE_INCOMPLETE';
  end if;

  if v_previous.elapsed_seconds = v_next.elapsed_seconds then
    v_quota_bps := v_previous.cumulative_quota_bps;
    v_reward_bps := v_previous.cumulative_reward_bps;
  else
    v_quota_bps := v_previous.cumulative_quota_bps + floor(
      (v_next.cumulative_quota_bps - v_previous.cumulative_quota_bps)::numeric
      * (v_elapsed_seconds - v_previous.elapsed_seconds)::numeric
      / (v_next.elapsed_seconds - v_previous.elapsed_seconds)::numeric
    )::integer;
    v_reward_bps := v_previous.cumulative_reward_bps + floor(
      (v_next.cumulative_reward_bps - v_previous.cumulative_reward_bps)::numeric
      * (v_elapsed_seconds - v_previous.elapsed_seconds)::numeric
      / (v_next.elapsed_seconds - v_previous.elapsed_seconds)::numeric
    )::integer;
  end if;

  v_quota_bps := least(10000, v_quota_bps);
  v_reward_bps := least(10000, v_reward_bps);
  v_target_reward_atomic := floor(
    v_account.target_reward_krw * v_reward_bps::numeric / 10000
  )::bigint;

  if v_quota_bps < v_account.quota_consumed_bps
    or v_target_reward_atomic < v_account.reward_atomic
  then
    raise exception using errcode = 'P0001', message = 'TRIAL_REWARD_CURVE_NON_MONOTONIC';
  end if;

  v_reward_delta := v_target_reward_atomic - v_account.reward_atomic;

  if v_reward_delta > 0 then
    insert into public.trial_ledger (
      trial_account_id,
      user_id,
      direction,
      entry_type,
      amount_atomic,
      idempotency_key,
      source_type,
      source_id
    ) values (
      v_account.id,
      p_user_id,
      'CREDIT',
      'MINING_REWARD',
      v_reward_delta,
      p_idempotency_key,
      'trial_session',
      v_session.id
    );
  end if;

  if v_quota_bps >= 10000 then
    v_completion_reason := 'QUOTA';
  elsif v_settle_to >= v_account.expires_at then
    v_completion_reason := 'TIME';
  else
    v_completion_reason := null;
  end if;

  update public.trial_accounts
  set
    quota_consumed_bps = v_quota_bps,
    reward_atomic = v_target_reward_atomic,
    last_settled_at = v_settle_to,
    status = case
      when v_completion_reason is null then 'ACTIVE'::public.trial_status
      else 'COMPLETED'::public.trial_status
    end
  where id = v_account.id;

  update public.trial_sessions
  set
    last_settled_at = v_settle_to,
    ended_at = case
      when v_completion_reason is null then null
      else v_settle_to
    end
  where id = v_session.id;

  if v_completion_reason is not null then
    insert into public.trial_completions (
      trial_account_id,
      user_id,
      reason,
      final_quota_bps,
      final_reward_atomic,
      completed_at
    ) values (
      v_account.id,
      p_user_id,
      v_completion_reason,
      v_quota_bps,
      v_target_reward_atomic,
      v_settle_to
    )
    on conflict on constraint trial_completions_trial_account_id_key do nothing;
  end if;

  update app_private.idempotency_keys
  set
    status = 'COMPLETED',
    response_status = 200,
    response_payload = jsonb_build_object(
      'trial_account_id', v_account.id,
      'status', case when v_completion_reason is null then 'ACTIVE' else 'COMPLETED' end,
      'quota_consumed_bps', v_quota_bps,
      'reward_atomic', v_target_reward_atomic
    ),
    completed_at = statement_timestamp(),
    locked_until = null
  where id = v_idempotency_id;

  if v_completion_reason is not null then perform app_private.emit_trial_completion(v_account.id,v_session.id);end if;
  return query
  select
    v_account.id,
    case
      when v_completion_reason is null then 'ACTIVE'::public.trial_status
      else 'COMPLETED'::public.trial_status
    end,
    v_quota_bps,
    v_target_reward_atomic,
    v_completion_reason;
end;
$$;


revoke all on function app_private.execute_trial_settlement(uuid,text)from public,anon,authenticated,service_role;
grant execute on function app_private.execute_trial_settlement(uuid,text)to service_role;
create or replace function public.settle_trial(p_user_id uuid,p_idempotency_key text)
returns table(trial_account_id uuid,status public.trial_status,quota_consumed_bps integer,reward_atomic bigint,completion_reason public.trial_completion_reason)
language sql volatile security invoker set search_path=pg_catalog
begin atomic select * from app_private.execute_trial_settlement(p_user_id,p_idempotency_key);end;
revoke all on function public.settle_trial(uuid,text)from public,anon,authenticated;
grant execute on function public.settle_trial(uuid,text)to service_role;
create or replace function app_private.read_nonmoney_mission_original(p_source uuid)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;m public.money_source_movements%rowtype;
 w public.withdrawal_requests%rowtype;a app_private.funding_withdrawal_clock_admissions%rowtype;
 t public.ledger_transactions%rowtype;owner_id uuid;effective_at timestamptz;original jsonb;mission app_private.funded_mining_mission_originals%rowtype;trial app_private.trial_completion_originals%rowtype;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';end if;
 select * into e from public.outbox_events where id=p_source;
 if e.id is null or e.schema_version<>1 then raise exception using errcode='55000',message='NONMONEY_CANONICAL_ORIGINAL_REQUIRED';end if;
 if e.event_type in('DEPOSIT_CONFIRMED.v1','TRIAL_REWARD_CONVERTED.v1') then
  if (select count(*) from public.money_source_movements where source_event_id=e.id and movement_kind='CREDIT')<>1 then
   raise exception using errcode='55000',message='NONMONEY_SOURCE_CREDIT_ORIGINAL_REQUIRED';end if;
  select * into m from public.money_source_movements where source_event_id=e.id and movement_kind='CREDIT';
  if (e.event_type='DEPOSIT_CONFIRMED.v1' and(e.aggregate_type<>'deposit_request' or m.origin_code<>'KRW_DEPOSIT'))
   or(e.event_type='TRIAL_REWARD_CONVERTED.v1' and(e.aggregate_type<>'trial_reward_conversion' or m.origin_code<>'WELCOME_REWARD')) then
   raise exception using errcode='55000',message='NONMONEY_SOURCE_KIND_MISMATCH';end if;
  -- This exact existing validator verifies terminal domain row, member, amounts,
  -- balanced journal, wallet, request/correlation, canonical idempotency and audit.
  perform app_private.assert_money_source_credit_complete(m);
  select * into t from public.ledger_transactions where id=m.ledger_transaction_id;
  owner_id:=m.user_id;effective_at:=m.effective_at;
  if effective_at is distinct from t.posted_at then raise exception using errcode='55000',message='NONMONEY_BUSINESS_CLOCK_MISMATCH';end if;
  original:=jsonb_build_object('credit_movement_id',m.id,'ledger_transaction_id',t.id,'wallet_ledger_id',m.wallet_ledger_id,
   'domain_id',e.aggregate_id,'domain_kind',e.aggregate_type,'member_id',owner_id,'effective_at',effective_at,
   'credit_movement',to_jsonb(m),'ledger_original',to_jsonb(t));
 elsif e.event_type='WITHDRAWAL_COMPLETED.v1' then
  if e.aggregate_type<>'withdrawal_request' then raise exception using errcode='55000',message='NONMONEY_SOURCE_KIND_MISMATCH';end if;
  select * into w from public.withdrawal_requests where id=e.aggregate_id;
  if w.id is null or w.status<>'COMPLETED' or w.finalize_ledger_transaction_id is null or w.ledger_finalized_at is null
   or e.payload->>'finalize_ledger_transaction_id' is distinct from w.finalize_ledger_transaction_id::text then
   raise exception using errcode='55000',message='NONMONEY_WITHDRAWAL_TERMINAL_REQUIRED';end if;
  if (select count(*) from app_private.funding_withdrawal_clock_admissions where withdrawal_id=w.id and phase='FINALIZE')<>1 then
   raise exception using errcode='55000',message='NONMONEY_WITHDRAWAL_CLOCK_ORIGINAL_REQUIRED';end if;
  select * into a from app_private.funding_withdrawal_clock_admissions where withdrawal_id=w.id and phase='FINALIZE';
  -- Includes real external-send receipt, balanced journal and hold provenance,
  -- immutable admission/seal, actual completed transaction receipt and outbox.
  perform app_private.assert_funding_withdrawal_clock_completion(a.id);
  select * into t from public.ledger_transactions where id=w.finalize_ledger_transaction_id;
  owner_id:=a.user_id;effective_at:=a.effective_at;
  if owner_id is distinct from w.user_id or e.occurred_at is distinct from effective_at or e.created_at is distinct from effective_at
   or t.posted_at is distinct from effective_at or e.request_id is distinct from t.request_id then
   raise exception using errcode='55000',message='NONMONEY_BUSINESS_CLOCK_MISMATCH';end if;
  original:=jsonb_build_object('domain_id',w.id,'domain_kind','withdrawal_request','member_id',owner_id,
   'effective_at',effective_at,'clock_admission_id',a.id,'clock_admission_digest',a.input_digest,
   'ledger_transaction_id',t.id,'clock_original',app_private.funding_withdrawal_clock_snapshot(a),'ledger_original',to_jsonb(t));
  elsif e.event_type in('MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1')then
   select * into mission from app_private.funded_mining_mission_originals where outbox_id=e.id;
   if mission.id is null then raise exception using errcode='55000',message='NONMONEY_MINING_ORIGINAL_REQUIRED';end if;
   perform app_private.assert_funded_mining_mission_original(mission.id);
   owner_id:=mission.user_id;effective_at:=mission.effective_at;
   original:=mission.snapshot||jsonb_build_object('mission_original_id',mission.id,'mission_original_digest',mission.digest);
  elsif e.event_type='TRIAL_COMPLETED.v1'then
   select * into trial from app_private.trial_completion_originals where outbox_id=e.id;
   if trial.id is null then raise exception using errcode='55000',message='NONMONEY_TRIAL_ORIGINAL_REQUIRED';end if;
   perform app_private.assert_trial_completion_original(trial.id);
   owner_id:=trial.user_id;effective_at:=trial.effective_at;
   original:=trial.snapshot||jsonb_build_object('trial_original_id',trial.id,'trial_original_digest',trial.digest);
  elsif e.event_type='REFERRAL_REWARD_PAID.v1'then
   raise exception using errcode='55000',message='NONMONEY_SOURCE_WRITER_NOT_CONNECTED';
 else raise exception using errcode='55000',message='NONMONEY_CANONICAL_ORIGINAL_REQUIRED';end if;
 if owner_id is null or effective_at is null or effective_at>clock_timestamp() then
  raise exception using errcode='55000',message='NONMONEY_SOURCE_OWNER_CLOCK_INVALID';end if;
 original:=original||jsonb_build_object('source_event_id',e.id,'source_type',e.event_type,'schema_version',e.schema_version,
  'source_envelope',to_jsonb(e)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']);
 return jsonb_build_object('member_id',owner_id,'effective_at',effective_at,'source_event_id',e.id,'source_type',e.event_type,
  'source_digest',app_private.funding_engine_digest(original),'original',original);
end;$$;

create or replace function app_private.approve_local_nonmoney_policy(
 p_event uuid,p_revision uuid,p_rule uuid,p_version integer,p_source_type text,p_reward_kind text,p_reward_code text,p_title_ko text,
 p_actor uuid,p_admin_session uuid,p_auth_session text,p_verified_aal text,p_step_up_token text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare role public.app_role;r app_private.liveops_content_receipts%rowtype;prev app_private.liveops_content_receipts%rowtype;
 event public.events%rowtype;policy app_private.nonmoney_event_policies%rowtype;idem app_private.idempotency_keys%rowtype;
 idem_id uuid;request_id uuid:=gen_random_uuid();aid uuid:=gen_random_uuid();eid uuid:=gen_random_uuid();grant_id uuid;
 snapshot jsonb;request_hash text;at timestamptz;result jsonb;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';end if;
 if not exists(select 1 from app_private.nonmoney_executor_configuration where singleton and local_qa_enabled
  and project_identity='putduk-mining-local-recovery-20261009-fi') then raise exception using errcode='42501',message='NONMONEY_LOCAL_QA_DISABLED';end if;
 role:=app_private.liveops_operator_context(p_actor,p_admin_session,p_auth_session,p_verified_aal);
 if p_event is null or p_revision is null or p_rule is null or p_version is null or p_version<1 or p_idempotency_key is null
  or p_source_type not in('DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1','MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1','TRIAL_COMPLETED.v1') or p_source_type is null
  or p_reward_kind not in('BADGE','PROFILE_TITLE') or p_reward_kind is null or p_reward_code is null or p_reward_code!~'^[A-Z][A-Z0-9_]{1,47}$'
  or char_length(btrim(coalesce(p_title_ko,''))) not between 1 and 80 or char_length(btrim(coalesce(p_reason,''))) not between 10 and 500
  or char_length(coalesce(p_step_up_token,'')) not between 16 and 512 then raise exception using errcode='22023',message='INVALID_NONMONEY_POLICY';end if;
 -- Missing trial/referral canonical producers stay closed until an actual sole-writer bridge is reviewed.
 perform pg_advisory_xact_lock(hashtextextended('putduk-nonmoney-policy:'||p_event::text||':'||p_rule::text,0));
 select * into r from app_private.liveops_content_receipts where id=p_revision and content_id=p_event and kind='EVENT';
 select * into prev from app_private.liveops_content_receipts where id=r.previous_revision_id;
 select * into event from public.events where id=p_event for share;
 if r.id is null or r.state<>'PUBLISHED' or prev.state<>'APPROVED' or prev.digest is distinct from r.digest
  or event.id is null or event.status not in('SCHEDULED','LIVE') or event.ends_at<=clock_timestamp()
  or not exists(select 1 from public.event_member_content where event_id=p_event and revision_id=p_revision)
  or exists(select 1 from app_private.liveops_content_receipts where content_id=p_event and revision>r.revision) then
  raise exception using errcode='42501',message='NONMONEY_CURRENT_APPROVAL_REQUIRED';end if;
 perform app_private.assert_liveops_receipt(r.id);perform app_private.assert_liveops_receipt(prev.id);
 request_hash:=app_private.funding_engine_digest(jsonb_build_object('event',p_event,'revision',p_revision,'rule',p_rule,'version',p_version,
  'source_type',p_source_type,'reward_kind',p_reward_kind,'reward_code',p_reward_code,'title_ko',btrim(p_title_ko),'actor',p_actor,
  'admin_session',p_admin_session,'auth_session',p_auth_session,'reason',btrim(p_reason),'proof_hash',encode(extensions.digest(p_step_up_token,'sha256'),'hex')));
 insert into app_private.idempotency_keys(scope,actor_id,idempotency_key,request_hash,status)
 values('nonmoney.local-policy',p_actor,p_idempotency_key::text,request_hash,'PROCESSING') on conflict(scope,actor_id,idempotency_key) do nothing returning id into idem_id;
 if idem_id is null then
  select * into idem from app_private.idempotency_keys where scope='nonmoney.local-policy' and actor_id=p_actor and idempotency_key=p_idempotency_key::text for update;
  if idem.request_hash is distinct from request_hash then raise exception using errcode='22023',message='IDEMPOTENCY_PAYLOAD_MISMATCH';end if;
  if idem.status<>'COMPLETED' then raise exception using errcode='40001',message='NONMONEY_POLICY_IN_PROGRESS';end if;
  perform app_private.assert_nonmoney_policy((idem.response_payload->>'policyId')::uuid);
  return idem.response_payload;
 end if;
 if p_version<>(select coalesce(max(version),0)+1 from app_private.nonmoney_event_policies where event_id=p_event and rule_id=p_rule) then
  raise exception using errcode='40001',message='NONMONEY_POLICY_VERSION_MISMATCH';end if;
 at:=clock_timestamp();grant_id:=app_private.consume_admin_step_up_token(p_actor,p_step_up_token,'LIVEOPS_CONTENT',request_id,p_admin_session);
 policy.id:=gen_random_uuid();snapshot:=jsonb_build_object('policy_id',policy.id,'event_id',p_event,'content_revision_id',p_revision,
  'rule_id',p_rule,'version',p_version,'scope','LOCAL_QA','source_type',p_source_type,'reward_kind',p_reward_kind,'reward_code',p_reward_code,
  'title_ko',btrim(p_title_ko),'starts_at',event.starts_at,'ends_at',event.ends_at,'approved_by',p_actor,'approved_at',at,
  'admin_session_id',p_admin_session,'auth_session_id',p_auth_session,'step_up_grant_id',grant_id,'request_id',request_id,'request_hash',request_hash);
 insert into public.audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(aid,p_actor,role,'NONMONEY_LOCAL_POLICY_APPROVED','nonmoney_event_policy',policy.id::text,btrim(p_reason),request_id,snapshot,
  jsonb_build_object('admin_session_id',p_admin_session,'step_up_grant_id',grant_id,'request_hash',request_hash),at);
 insert into app_private.nonmoney_event_policies(id,event_id,content_revision_id,rule_id,version,scope,source_type,reward_kind,reward_code,title_ko,
  starts_at,ends_at,approved_by,approval_audit_id,snapshot,digest,created_at)
 values(policy.id,p_event,p_revision,p_rule,p_version,'LOCAL_QA',p_source_type,p_reward_kind,p_reward_code,btrim(p_title_ko),event.starts_at,event.ends_at,
  p_actor,aid,snapshot,app_private.funding_engine_digest(snapshot),at) returning * into policy;
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,idempotency_key,occurred_at,created_at)
 values(eid,'NONMONEY_POLICY_APPROVED.v1',1,'nonmoney_event_policy',policy.id,p_actor,
  jsonb_build_object('policy_id',policy.id,'audit_id',aid,'scope','LOCAL_QA','digest',policy.digest),request_id,request_id,
  'nonmoney-local-policy:'||p_actor::text||':'||p_idempotency_key::text,at,at);
 result:=jsonb_build_object('policyId',policy.id,'eventId',p_event,'revisionId',p_revision,'ruleId',p_rule,'version',p_version,'scope','LOCAL_QA',
  'digest',policy.digest,'auditId',aid,'outboxId',eid,'confirmed',true);
 perform app_private.liveops_operator_context(p_actor,p_admin_session,p_auth_session,p_verified_aal);
 update app_private.idempotency_keys set status='COMPLETED',response_status=200,response_payload=result,completed_at=clock_timestamp(),locked_until=null where id=idem_id;
 perform app_private.assert_nonmoney_policy(policy.id);
 return result;
end;$$;

create or replace function public.complete_outbox_event(
  p_event_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_event public.outbox_events%rowtype;
  v_audit public.audit_logs%rowtype;
  v_key app_private.idempotency_keys%rowtype;
  v_delivery public.event_consumer_deliveries%rowtype;
begin
  select event.* into v_event from public.outbox_events as event
  where event.id = p_event_id for update;
  if v_event.id is null or v_event.status <> 'PROCESSING'
    or v_event.lease_owner is distinct from p_worker_id
    or v_event.lease_expires_at is null
    or v_event.lease_expires_at < clock_timestamp() then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;

  if v_event.event_type = 'SAFE_MODE_CHANGED.v1' then
    select audit.* into v_audit from public.audit_logs as audit
    where audit.id::text = v_event.payload->>'audit_id';
    select logical_key.* into v_key from app_private.idempotency_keys as logical_key
    where logical_key.scope = 'safe_mode.control' and logical_key.actor_id is null
      and logical_key.idempotency_key = v_audit.metadata->>'idempotency_key';
    if v_event.schema_version <> 1 or v_event.aggregate_type <> 'safe_mode_control'
      or v_event.payload - array['audit_id', 'component', 'is_paused', 'review_at', 'request_hash'] <> '{}'::jsonb
      or v_audit.id is null or v_key.id is null
      or v_audit.target_type is distinct from 'SAFE_MODE'
      or v_audit.action not in ('SAFE_MODE_ENABLED', 'SAFE_MODE_DISABLED')
      or v_audit.metadata->'command_version' is distinct from '1'::jsonb
      or v_audit.actor_user_id is distinct from v_event.actor_user_id
      or v_audit.request_id is distinct from v_event.request_id
      or v_event.correlation_id is distinct from v_audit.request_id
      or v_audit.after_state->>'id' is distinct from v_event.aggregate_id::text
      or v_audit.after_state->>'component' is distinct from v_audit.target_id
      or v_event.payload->>'component' is distinct from v_audit.target_id
      or v_event.payload->'is_paused' is distinct from v_audit.after_state->'is_paused'
      or v_event.payload->'is_paused' is distinct from to_jsonb(v_audit.action = 'SAFE_MODE_ENABLED')
      or v_event.payload->'review_at' is distinct from v_audit.after_state->'review_at'
      or v_event.payload->>'request_hash' is distinct from v_audit.metadata->>'request_hash'
      or v_event.idempotency_key is distinct from 'safe-mode:' || v_key.idempotency_key
      or v_key.status <> 'COMPLETED' or v_key.completed_at is null
      or v_key.response_status is distinct from 200
      or v_key.request_hash is distinct from v_event.payload->>'request_hash'
      or v_key.response_payload->>'audit_id' is distinct from v_audit.id::text
      or v_key.response_payload->>'control_id' is distinct from v_event.aggregate_id::text
      or not exists (select 1 from public.safe_mode_controls as control
        where control.id = v_event.aggregate_id and control.component = v_audit.target_id)
      or (select count(*) from public.outbox_events as original
        where original.event_type = 'SAFE_MODE_CHANGED.v1'
          and original.payload->>'audit_id' = v_audit.id::text) <> 1 then
      raise exception using errcode = '55000', message = 'SAFE_MODE_EVENT_RECEIPT_MISMATCH';
    end if;
    insert into public.event_consumer_deliveries (
      event_id, consumer_name, status, attempt_count, processed_at
    ) values (
      v_event.id, 'operator_safe_mode_audit.v1', 'SUCCEEDED', 1, statement_timestamp()
    ) on conflict (event_id, consumer_name) do nothing;
    select delivery.* into v_delivery from public.event_consumer_deliveries as delivery
    where delivery.event_id = v_event.id and delivery.consumer_name = 'operator_safe_mode_audit.v1';
    if v_delivery.status is distinct from 'SUCCEEDED' or v_delivery.processed_at is null
      or v_delivery.attempt_count <> 1 or v_delivery.lease_owner is not null
      or v_delivery.lease_expires_at is not null or v_delivery.last_error_code is not null then
      raise exception using errcode = '55000', message = 'SAFE_MODE_DELIVERY_RECEIPT_MISMATCH';
    end if;
  elsif v_event.event_type = 'EVENT_PARTICIPATION_JOINED.v1' then
    perform app_private.consume_event_join(v_event.id,p_worker_id);
  elsif v_event.event_type in('DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1','MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1','TRIAL_COMPLETED.v1') then
    perform app_private.consume_nonmoney_source(v_event.id,p_worker_id);
   else raise exception using errcode='55000',message='OUTBOX_HANDLER_UNSUPPORTED';
   end if;

  update public.outbox_events set status = 'PROCESSED',
    processed_at = statement_timestamp(), lease_owner = null,
    lease_expires_at = null, last_error_code = null where id = v_event.id
    and status = 'PROCESSING' and lease_owner = p_worker_id
    and lease_expires_at >= clock_timestamp();
  if not found then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;
end;
$$;


commit;
