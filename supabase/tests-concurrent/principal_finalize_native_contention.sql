-- ROOT ONLY, exact frozen139 + independently accepted main388 prerequisite.
-- One fresh disposable LOCAL active120 generation PER case. Actual commands,
-- roles, advisory waiters and native deferred commits; no raw financial rows.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();
create temporary table r139_checks(id integer generated always as identity,passed boolean,description text);
create temporary table r139_context(member_id uuid,admin_id uuid,bank_id uuid,policy_id uuid,catalog_id uuid,catalog_digest text,product_id uuid,last_key text,last_withdrawal uuid);
insert into r139_context
select '10626100-0000-4000-8000-000000000002'::uuid,'10626100-0000-4000-8000-000000000001'::uuid,
 o.destination_id,o.policy_id,a.catalog_version_id,p.snapshot_digest,(a.products->0->>'productId')::uuid,
 pending.idempotency_key,pending.withdrawal_id
from app_private.withdrawal_principal_confirmation_originals o
join public.withdrawal_requests r on r.idempotency_key=o.logical_key and r.user_id=o.user_id and r.status='COMPLETED' and r.destination_type='KRW_BANK'
join lateral(select * from app_private.funding_allocation_originals x where x.user_id=o.user_id order by revision desc limit 1)a on true
join app_private.product_catalog_receipts p on p.catalog_id=a.catalog_version_id and p.state='PUBLISHED'
join lateral(select * from public.withdrawal_logical_requests l where l.user_id=o.user_id order by l.created_at desc,l.idempotency_key limit 1)pending on true
where o.user_id='10626100-0000-4000-8000-000000000002'
order by o.confirmed_at desc,o.id limit 1;
create function pg_temp.r139_read(p_conn text,p_sql text) returns text
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare schema_name text; result text;
begin
 select n.nspname into schema_name from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 execute format('select value from %I.dblink(%L,%L) as r(value text)',schema_name,p_conn,p_sql) into result;
 return result;
end;$$;
create function pg_temp.r139_exec(p_conn text,p_sql text) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare schema_name text;
begin
 select n.nspname into schema_name from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 execute format('select %I.dblink_exec(%L,%L)',schema_name,p_conn,p_sql);
end;$$;
create function pg_temp.r139_begin(p_conn text,p_role text,p_isolation text default 'read committed') returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if p_role not in('authenticated','service_role') or p_isolation not in('read committed','repeatable read') then
  raise exception 'R139_TEST_CONTEXT_INVALID';end if;
 perform pg_temp.r139_exec(p_conn,'begin isolation level '||p_isolation);
 perform pg_temp.r139_exec(p_conn,'set local statement_timeout=''15000ms''');
 perform pg_temp.r139_exec(p_conn,'set local role '||p_role);
 perform pg_temp.r139_exec(p_conn,format('set local request.jwt.claims=%L',case when p_role='authenticated'
  then '{"role":"authenticated","sub":"10626100-0000-4000-8000-000000000002"}' else '{"role":"service_role"}' end));
end;$$;
create function pg_temp.r139_attempt(p_conn text,p_sql text) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin return pg_temp.r139_read(p_conn,format('select pg_temp.r139_checked_attempt(%L)::text',p_sql))::jsonb;end;$$;
create function pg_temp.r139_end(p_conn text) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 -- Deliberately preserve actual member/service through all deferred originals.
 perform pg_temp.r139_exec(p_conn,'set constraints all immediate');
 perform pg_temp.r139_exec(p_conn,'commit');
end;$$;
create function pg_temp.r139_command(p_conn text,p_role text,p_sql text,p_isolation text default 'read committed') returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare result jsonb;
begin
 perform pg_temp.r139_begin(p_conn,p_role,p_isolation);result:=pg_temp.r139_attempt(p_conn,p_sql);
 perform pg_temp.r139_end(p_conn);return result;
end;$$;
create function pg_temp.r139_require_ok(p_result jsonb) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if coalesce((p_result->>'ok')::boolean,false) is not true then
  raise exception using errcode='55000',message='R139_CANONICAL_COMMAND_REJECTED',detail=p_result::text;end if;
end;$$;
create function pg_temp.r139_check(p_value boolean,p_description text) returns void
language sql volatile security invoker set search_path=pg_catalog as $$
 insert into pg_temp.r139_checks(passed,description) values(coalesce(p_value,false),p_description);
$$;
create function pg_temp.r139_snapshot() returns jsonb
language sql volatile security invoker set search_path=pg_catalog as $$
 select jsonb_build_object(
 'state',(select to_jsonb(s) from app_private.funding_engine_state s where s.user_id=c.member_id),
 'condition',(select to_jsonb(o) from app_private.funding_engine_state s join app_private.funding_condition_originals o on o.id=s.condition_id where s.user_id=c.member_id),
 'cycle',(select to_jsonb(w) from app_private.funding_engine_state s join app_private.funding_cycle_windows w on w.id=s.cycle_id where s.user_id=c.member_id),
 'caps',app_private.funding_state_effective_capacities((select id from app_private.funding_engine_state where user_id=c.member_id)),
 'wallet',(select to_jsonb(w) from public.wallet_accounts w where w.user_id=c.member_id and w.currency='KRW' and w.closed_at is null),
 'consents',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from app_private.withdrawal_principal_confirmation_originals o where o.user_id=c.member_id),
 'logicals',(select coalesce(jsonb_agg(to_jsonb(o) order by o.idempotency_key),'[]') from public.withdrawal_logical_requests o where o.user_id=c.member_id),
 'requests',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.withdrawal_requests o where o.user_id=c.member_id),
 'types',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from app_private.funding_principal_recovery_intent_originals o where o.user_id=c.member_id),
 'admissions',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from app_private.funding_withdrawal_clock_admissions o where o.user_id=c.member_id),
 'journals',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.ledger_transactions o where o.member_user_id=c.member_id),
 'sources',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.money_source_movements o where o.user_id=c.member_id),
 'clocks',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from app_private.funding_portion_clock_receipts o where o.user_id=c.member_id),
 'earned',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from app_private.funding_earned_receipts o where o.user_id=c.member_id),
 'allocations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from app_private.funding_allocation_originals o where o.user_id=c.member_id),
 'preparations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from app_private.funding_principal_boundary_preparations o where o.user_id=c.member_id),
 'completions',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from app_private.funding_principal_boundary_completions o where o.user_id=c.member_id),
 'wallet_ledger',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.wallet_ledger o where o.user_id=c.member_id),
 'source_summary',(select to_jsonb(o) from public.money_source_summaries o where o.user_id=c.member_id),
 'external_sends',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.withdrawal_external_sends o join public.withdrawal_requests r on r.id=o.withdrawal_id where r.user_id=c.member_id),
 'coverage',(select coverage from public.money_source_summaries where user_id=c.member_id))
 from pg_temp.r139_context c;
$$;
create function pg_temp.r139_wait(p_holder text,p_writer text,p_mode text) returns boolean
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare holder_pid integer;writer_pid integer;deadline timestamptz:=clock_timestamp()+interval '8 seconds';observed boolean;
begin
 holder_pid:=pg_temp.r139_read(p_holder,'select pg_backend_pid()::text')::integer;
 -- Writer backend PID was captured BEFORE asynchronous dispatch.
 writer_pid:=current_setting('putduk.r139_writer_pid')::integer;
 loop
  perform pg_stat_clear_snapshot();
  select exists(select 1 from pg_locks w join pg_locks h on h.classid=w.classid and h.objid=w.objid and h.objsubid=w.objsubid
   where w.pid=writer_pid and h.pid=holder_pid and w.locktype='advisory' and h.locktype='advisory'
    and not w.granted and h.granted and h.mode='ExclusiveLock' and w.mode=p_mode
    and holder_pid=any(pg_blocking_pids(writer_pid))) into observed;
  if observed then return true;end if;
  if clock_timestamp()>deadline then raise exception 'R139_ACTUAL_ADVISORY_WAITER_MISSING';end if;
  perform pg_sleep(0.01);
 end loop;
end;$$;
create function pg_temp.r139_dispatch(p_conn text,p_role text,p_sql text) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare schema_name text;writer_pid text;holder_pid text;
begin
 perform pg_temp.r139_begin(p_conn,p_role);
 writer_pid:=pg_temp.r139_read(p_conn,'select pg_backend_pid()::text');
 holder_pid:=pg_temp.r139_read('r139_holder','select pg_backend_pid()::text');
 perform set_config('putduk.r139_writer_pid',writer_pid,true);
 perform set_config('putduk.r139_holder_pid',holder_pid,true);
 perform set_config('putduk.r139_writer_role',p_role,true);
 select n.nspname into schema_name from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 execute format('select %I.dblink_send_query(%L,%L)',schema_name,p_conn,format('select pg_temp.r139_checked_attempt(%L)::text',p_sql));
end;$$;
-- Diagnostic only: exact session-helper PIDs captured BEFORE async dispatch.
-- Never emit query bodies, JWT claims, connection strings or native row values.
create function pg_temp.r139_receive_observation(p_conn text) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare writer_pid integer:=current_setting('putduk.r139_writer_pid')::integer;
 holder_pid integer:=current_setting('putduk.r139_holder_pid')::integer;
 case_id text:=current_setting('putduk.test139_case');observed_at timestamptz;observation jsonb;
begin
 if p_conn<>'r139_writer' or writer_pid<=0 or holder_pid<=0 or writer_pid=holder_pid
  or case_id not in('A','B','C','D','E') then raise exception 'R139_DIAGNOSTIC_CONTEXT_INVALID';end if;
 perform pg_stat_clear_snapshot();observed_at:=clock_timestamp();
 select jsonb_build_object(
  'case',case_id,'connection',p_conn,'observed_at_epoch',extract(epoch from observed_at),
  'writer_pid',writer_pid,'holder_pid',holder_pid,
  'requested_SQL_role',current_setting('putduk.r139_writer_role'),
  'writer_backend_present',w.pid is not null,'writer_state',w.state,
  'writer_wait_type',w.wait_event_type,'writer_wait_event',w.wait_event,
  'writer_blocking_pids',case when w.pid is null then null else to_jsonb(pg_blocking_pids(w.pid)) end,
  'writer_query_elapsed_seconds',extract(epoch from observed_at-w.query_start),
  'writer_xact_elapsed_seconds',extract(epoch from observed_at-w.xact_start),
  'writer_checked_attempt_query_prefix',coalesce(left(ltrim(w.query),length('select pg_temp.r139_checked_attempt('))='select pg_temp.r139_checked_attempt(',false),
  'holder_backend_present',h.pid is not null,'holder_state',h.state,
  'holder_wait_type',h.wait_event_type,'holder_wait_event',h.wait_event,
  'holder_blocking_pids',case when h.pid is null then null else to_jsonb(pg_blocking_pids(h.pid)) end,
  'holder_xact_elapsed_seconds',extract(epoch from observed_at-h.xact_start)
 ) into observation
 from (values(1)) seed(x)
 left join pg_stat_activity w on w.pid=writer_pid
 left join pg_stat_activity h on h.pid=holder_pid;
 return observation;
end;$$;
create function pg_temp.r139_receive(p_conn text) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare schema_name text;busy integer;deadline timestamptz:=clock_timestamp()+interval '8 seconds';result text;drain text;
 sample_at timestamptz;observation jsonb;observations jsonb:='[]'::jsonb;
begin
 sample_at:=deadline-interval '2 seconds';
 select n.nspname into schema_name from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 loop
  execute format('select %I.dblink_is_busy(%L)',schema_name,p_conn) into busy;
  exit when busy=0;
  -- At most three samples scheduled at6s/7s/7.75s, before unchanged8s timeout.
  -- These are observations, never an alternative accepted command result.
  if jsonb_array_length(observations)<3 and clock_timestamp()>=sample_at then
   observation:=pg_temp.r139_receive_observation(p_conn);
   observations:=observations||jsonb_build_array(observation);
   raise notice 'R139_RECEIVE_OBSERVATION %',observation::text;
   sample_at:=case jsonb_array_length(observations)
    when 1 then deadline-interval '1 second'
    when 2 then deadline-interval '250 milliseconds'
    else deadline end;
  end if;
  if clock_timestamp()>deadline then
   raise exception using errcode='P0001',message='R139_CANONICAL_COMMAND_RESULT_TIMEOUT',
    detail=jsonb_build_object('case',current_setting('putduk.test139_case'),'connection',p_conn,'observations',observations)::text;
  end if;
  perform pg_sleep(0.01);
 end loop;
 execute format('select value from %I.dblink_get_result(%L) as r(value text)',schema_name,p_conn) into result;
 execute format('select value from %I.dblink_get_result(%L) as r(value text)',schema_name,p_conn) into drain;
 return result::jsonb;
end;$$;


-- Owner-only test probes read immutable originals. No monetary expectation is
-- obtained by invoking the producer or its current-input/math validators.
create function pg_temp.r139_finalize_proof(
 p_request uuid,p_bound timestamptz,p_pause timestamptz,p_resume timestamptz,
 p_caps numeric[],p_available jsonb,p_held jsonb,p_principal numeric,p_recovered numeric
) returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare boundary uuid;owner_id uuid;admitted timestamptz;native_amount bigint;
begin
 select b.id,a.user_id,a.effective_at,r.amount_atomic into boundary,owner_id,admitted,native_amount
 from app_private.funding_withdrawal_clock_admissions a
 join app_private.funding_principal_boundary_preparations b on b.clock_admission_id=a.id
 join public.withdrawal_requests r on r.id=a.withdrawal_id
 where a.withdrawal_id=p_request and a.phase='FINALIZE';
 perform pg_temp.r139_check(boundary is not null and admitted>=p_bound,
  'F01 actual FINALIZE sole financial clock follows observed admission release bound');
 perform pg_temp.r139_check((select k.runtime_outcome='ACCEPTED' and k.reason_code is null and c.cause_principal_boundary_id=b.id
  and c.inputs->>'input_contract_version'='3' and c.inputs->>'principal_atomic'=p_principal::text
  and (c.inputs->>'recovered_principal_atomic')::numeric=p_recovered+native_amount and c.inputs->>'held_principal_atomic'='0'
  from app_private.funding_principal_boundary_preparations b join app_private.funding_principal_boundary_completions k on k.boundary_id=b.id
  join app_private.funding_condition_originals c on c.id=k.condition_id where b.id=boundary),
  'F02 accepted successor binds actual recovered source and does not exclude available principal twice');
 perform pg_temp.r139_check((select a.effective_at=b.effective_at and b.effective_at=e.settled_to
  and b.effective_at=k.effective_at and k.effective_at=c.effective_at and k.effective_at=s.cursor_at
  and a.effective_at=t.created_at and a.effective_at=t.posted_at and a.effective_at=r.ledger_finalized_at
  and a.effective_at=m.effective_at and a.effective_at=x.occurred_at and a.effective_at=x.created_at
  from app_private.funding_principal_boundary_preparations b
  join app_private.funding_withdrawal_clock_admissions a on a.id=b.clock_admission_id
  join app_private.funding_principal_boundary_completions k on k.boundary_id=b.id
  join app_private.funding_earned_receipts e on e.cause_principal_boundary_id=b.id
  join app_private.funding_condition_originals c on c.id=k.condition_id
  join app_private.funding_engine_state_receipts s on s.id=k.accepted_state_id
  join public.withdrawal_requests r on r.id=a.withdrawal_id
  join public.ledger_transactions t on t.id=r.finalize_ledger_transaction_id
  join public.money_source_movements m on m.id=k.source_movement_id
  join public.outbox_events x on x.id=m.source_event_id where b.id=boundary),
  'F03 native journal/source/event/old earning/new condition/state all bind one actual admitted clock');
 perform pg_temp.r139_check((select r.status='COMPLETED' and t.reference_id=r.id and t.member_user_id=owner_id
  and exists(select 1 from public.withdrawal_external_sends send where send.withdrawal_id=r.id and send.method=r.destination_type)
  from public.withdrawal_requests r join public.ledger_transactions t on t.id=r.finalize_ledger_transaction_id where r.id=p_request),
  'F04 genuine recorded native send becomes completed principal payout for exact owner/request');
 perform pg_temp.r139_check((select count(*)=1 and bool_and(w.created_at=admitted and w.amount_atomic=native_amount)
  from public.wallet_ledger w where w.reference_type='withdrawal_request' and w.reference_id=p_request and w.direction='DEBIT' and w.entry_type='WITHDRAWAL'),
  'F05 actual native FINALIZE creates exactly one same-clock wallet payout debit');
 perform pg_temp.r139_check((select count(*)>=2 and sum(case when e.side='DEBIT' then e.amount_atomic else -e.amount_atomic end)=0
  from public.ledger_entries e join public.withdrawal_requests r on r.finalize_ledger_transaction_id=e.transaction_id where r.id=p_request),
  'F06 native principal payout journal independently has entries and balances');
 perform pg_temp.r139_check((select count(*)=1 from app_private.funding_portion_transitions t where t.user_id=owner_id and t.kind='FINALIZE' and t.original_id=p_request),
  'F07 exact native request creates one immutable FINALIZE transition');
 perform pg_temp.r139_check((select eligible_principal_atomic::numeric=p_principal and held_principal_atomic='0'
  and recovered_principal_atomic::numeric=p_recovered+native_amount and coverage='COMPLETE'
  from public.money_source_summaries where user_id=owner_id),
  'F08 native source independently conserves available principal and recovered amount with COMPLETE coverage');
 perform pg_temp.r139_check(p_available=(select coalesce(jsonb_agg(to_jsonb(c) order by c.portion_id),'[]'::jsonb)
  from app_private.funding_portion_clock_state c where c.user_id=owner_id and c.status='AVAILABLE'),
  'F09 all unaffected AVAILABLE portion clocks remain byte-identical with original ages/anchors');
 perform pg_temp.r139_check(not exists(select 1 from jsonb_array_elements(p_held) h
  left join app_private.funding_portion_clock_state c on c.portion_id=(h->>'portion_id')::uuid
  where c.id is null or c.status<>'RECOVERED' or c.resumed_at is not null
  or c.accumulated_eligible_microseconds<>(h->>'accumulated_eligible_microseconds')::bigint
  or c.previous_clock_id<>(h->>'id')::uuid or c.hold_allocation_id<>(h->>'hold_allocation_id')::uuid),
  'F10 exact held portions become RECOVERED preserving parent identity/eligible age with no resumed hold time');
 perform pg_temp.r139_check((select sum(p.amount_micro_krw)=native_amount::numeric*1000000
  from jsonb_array_elements(p_held) h join app_private.funding_principal_portions p on p.id=(h->>'portion_id')::uuid),
  'F11 independently summed recovered portion amount equals actual native payout');
 perform pg_temp.r139_check((select cap.base_capacity_num*p_caps[2]=p_caps[1]*cap.base_capacity_den
  and cap.retention_capacity_num*p_caps[4]=p_caps[3]*cap.retention_capacity_den
  from app_private.funding_principal_boundary_completions k join app_private.funding_effective_capacity_receipts cap on cap.state_id=k.accepted_state_id where k.boundary_id=boundary),
  'F12 FINALIZE preserves both forward capacities because HOLD already removed eligible principal');
 -- Compute elapsed from independently sealed actual pause/resume, not the
 -- producer's eligible interval metadata or its own amount/carry function.
 perform pg_temp.r139_check((select e.amount_atomic=div(q.total_num,q.total_den)::bigint
  and e.calculation->>'qualifiedRetentionNum'='0'
  and s.carry_num*q.total_den=mod(q.total_num,q.total_den)*s.carry_den
  and s.base_used_num*old.base_used_den*v.den=(old.base_used_num*v.den+v.num*old.base_used_den)*s.base_used_den
  from app_private.funding_principal_boundary_preparations b
  join app_private.funding_earned_receipts e on e.cause_principal_boundary_id=b.id
  join app_private.funding_engine_state_receipts old on old.id=b.previous_state_id
  join app_private.funding_engine_state_receipts s on s.id=e.next_state_id
  join app_private.funding_condition_originals c on c.id=old.condition_id
  join app_private.funding_cycle_windows w on w.id=old.cycle_id
  cross join lateral(select(extract(epoch from b.effective_at-old.cursor_at)*1000000)::numeric-
   case when p_pause is null then 0 else greatest(0,(extract(epoch from least(b.effective_at,p_resume)-greatest(old.cursor_at,p_pause))*1000000)::numeric) end elapsed,
   (extract(epoch from w.cycle_end-w.cycle_started_at)*1000000)::numeric span) time
  cross join lateral(select(c.inputs->>'principal_atomic')::numeric*(c.inputs->>'base_bps')::numeric*
   (c.inputs->>'allocation_bps')::numeric*time.elapsed raw_num,100000000*time.span raw_den) raw
  cross join lateral(select app_private.funding_state_effective_capacities(old.id) caps) capacity
  cross join lateral(select capacity.caps[1]*old.base_used_den-old.base_used_num*capacity.caps[2] remaining_num,
   capacity.caps[2]*old.base_used_den remaining_den) remaining
  cross join lateral(select case when raw.raw_num*remaining.remaining_den<=remaining.remaining_num*raw.raw_den then raw.raw_num else remaining.remaining_num end num,
   case when raw.raw_num*remaining.remaining_den<=remaining.remaining_num*raw.raw_den then raw.raw_den else remaining.remaining_den end den) v
  cross join lateral(select v.num*old.carry_den+old.carry_num*v.den total_num,v.den*old.carry_den total_den) q where b.id=boundary),
  'F13 independently capped exact old BASE minus sealed pause plus prior carry equals money/used/carry; no held-end payout');
 perform pg_temp.r139_check((select b.previous_state_id=e.previous_state_id and old.condition_id=e.condition_id
  and s.previous_state_id=old.id and s.revision=old.revision+1 and s.cycle_id=old.cycle_id
  and s.cursor_at=admitted and s.retention_used_num*old.retention_used_den>=old.retention_used_num*s.retention_used_den
  from app_private.funding_principal_boundary_preparations b
  join app_private.funding_earned_receipts e on e.cause_principal_boundary_id=b.id
  join app_private.funding_engine_state_receipts old on old.id=b.previous_state_id
  join app_private.funding_engine_state_receipts s on s.id=e.next_state_id where b.id=boundary),
  'F14 exactly one successor preserves predecessor/cycle and accumulated conditional maintenance');
 perform pg_temp.r139_check((select count(*)=1 from app_private.funding_principal_boundary_completions k where k.boundary_id=boundary and k.runtime_outcome='ACCEPTED')
  and(select count(*)=1 from app_private.funding_earned_receipts e where e.cause_principal_boundary_id=boundary),
  'F15 one genuine completed boundary owns one immutable earned original');
 perform pg_temp.r139_check(not exists(select 1 from app_private.funding_retention_qualifications q where q.user_id=owner_id),
  'F16 no unapproved held-cycle-end maintenance qualification or payout is inferred');
end;$$;

create function pg_temp.r139_global_command(p_conn text,p_paused boolean,p_key text) returns uuid
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare audit_id uuid;
begin
 -- Existing129 canonical command authority is its closed audit trigger:
 -- live operator, exact expected current control revision and immutable key.
 audit_id:=pg_temp.r139_read(p_conn,format($command$
  insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
  values('10626100-0000-4000-8000-000000000001','ADMIN',%L,'SAFE_MODE','GLOBAL',
   'Independent139 local actual GLOBAL command',gen_random_uuid(),
   jsonb_build_object('command_version',1,'component','GLOBAL','is_paused',%L::boolean,'review_at',null,
    'expected_request_id',(select request_id from public.safe_mode_controls where component='GLOBAL'),'idempotency_key',%L)) returning id::text
 $command$,case when p_paused then 'SAFE_MODE_ENABLED' else 'SAFE_MODE_DISABLED' end,p_paused,p_key))::uuid;
 return audit_id;
end;$$;

do $closure$
declare f record;
begin
 for f in select p.oid::regprocedure as identity from pg_proc p where p.pronamespace=pg_my_temp_schema() and p.proname like 'r139_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.identity);
 end loop;
end;$closure$;

do $race$
declare context pg_temp.r139_context%rowtype;case_id text:=current_setting('putduk.test139_case');
 extension_schema text;connection text;helper_sql text;run_key text:=gen_random_uuid()::text;
 result jsonb;replay jsonb;consent jsonb;before_snapshot jsonb;basis_snapshot jsonb;
 key text;v_request_id uuid;send_id uuid;final_journal uuid;final_sql text;allocation_sql text;
 release_bound timestamptz:='-infinity';pause_at timestamptz;resume_at timestamptz;pause_audit uuid;resume_audit uuid;
 available_before jsonb;held_before jsonb;caps_before numeric[];principal_before numeric;recovered_before numeric;
 prior_condition uuid;allocation_condition uuid;allocation_at timestamptz;observed boolean;
 saved_allocation app_private.funding_allocation_originals%rowtype;
begin
 if case_id not in('A','B','C','D','E') then raise exception 'R139_CASE_INVALID';end if;
 select * into context from pg_temp.r139_context;
 if context.member_id is null or context.product_id is null or
  (select coverage from public.money_source_summaries where user_id=context.member_id) is distinct from 'COMPLETE'
  or(select held_principal_atomic from public.money_source_summaries where user_id=context.member_id) is distinct from '0'
  or(select recovered_principal_atomic from public.money_source_summaries where user_id=context.member_id) is distinct from '200000' then
  raise exception 'R139_STRICT_CANONICAL388_BASIS_REQUIRED';end if;
 select n.nspname into extension_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='dblink';
 connection:='host=supabase_db_putduk-mining dbname=postgres user=postgres password=postgres connect_timeout=2';
 execute format('select %I.dblink_connect(%L,%L)',extension_schema,'r139_holder',connection);
 execute format('select %I.dblink_connect(%L,%L)',extension_schema,'r139_writer',connection);
 helper_sql:=$helper$
  create function pg_temp.r139_checked_attempt(p_sql text) returns jsonb
  language plpgsql security invoker set search_path=pg_catalog as $body$
  declare value text;code text;message text;started timestamptz:=statement_timestamp();
  begin
   execute p_sql into value;
   return jsonb_build_object('ok',true,'result',value,'started_microseconds',((extract(epoch from started)*1000000)::bigint)::text);
  exception when others then
   get stacked diagnostics code=returned_sqlstate,message=message_text;
   return jsonb_build_object('ok',false,'sqlstate',code,'message',message,'started_microseconds',((extract(epoch from started)*1000000)::bigint)::text);
  end;$body$;
  revoke all on function pg_temp.r139_checked_attempt(text) from public,anon,authenticated,service_role;
  grant execute on function pg_temp.r139_checked_attempt(text) to authenticated,service_role;
 $helper$;
 perform pg_temp.r139_exec('r139_holder',helper_sql);perform pg_temp.r139_exec('r139_writer',helper_sql);
 -- Every case starts with a NEW real owner confirmation and native principal
 -- HOLD, after acknowledging the previous genuine completed USDT logical row.
 result:=pg_temp.r139_command('r139_holder','service_role',format(
  'select public.resolve_withdrawal_logical_request(%L::uuid,''CONFIRM'',%L,%L::uuid)::text',context.member_id,context.last_key,context.last_withdrawal));
 perform pg_temp.r139_require_ok(result);
 consent:=pg_temp.r139_command('r139_writer','authenticated',format(
  'select public.prepare_withdrawal_logical_request(%L::uuid,''KRW_BANK'',100000::bigint,%L::uuid,10634001,null::text,%L::uuid,''{"version":1,"source":"PRINCIPAL","confirmed":true}''::jsonb)::text',
  context.member_id,context.policy_id,context.bank_id));perform pg_temp.r139_require_ok(consent);
 key:=(consent->>'result')::jsonb->>'key';
 result:=pg_temp.r139_command('r139_holder','service_role',format(
  'select public.hold_withdrawal_logical_request(%L::uuid,%L,''KRW_BANK'',%L::uuid,100000::bigint)::text',context.member_id,key,context.bank_id));
 perform pg_temp.r139_require_ok(result);v_request_id:=(result->>'result')::uuid;
 result:=pg_temp.r139_command('r139_holder','service_role',format(
  'select public.record_krw_external_send(%L::uuid,%L,100000::bigint,%L::uuid,clock_timestamp(),%L)::text',
  v_request_id,'139 LOCAL synthetic operator record '||case_id,context.admin_id,'r139-send-'||case_id||'-'||run_key));
 perform pg_temp.r139_require_ok(result);send_id:=(result->>'result')::uuid;
 perform pg_temp.r139_check((select r.status='EXTERNAL_SENT_RECORDED' and o.logical_key=r.idempotency_key and o.user_id=i.user_id and o.logical_key=key
  and s.id=send_id and s.withdrawal_id=r.id and s.method='KRW_BANK'
  from public.withdrawal_requests r join app_private.funding_principal_recovery_intent_originals i on i.withdrawal_id=r.id
  join app_private.withdrawal_principal_confirmation_originals o on o.logical_key=(select r.idempotency_key from public.withdrawal_requests r where r.id=i.withdrawal_id) and o.user_id=i.user_id
  join public.withdrawal_external_sends s on s.withdrawal_id=r.id where r.id=v_request_id),
  'S01 actual owner confirmation/native HOLD/operator record supplies genuine fresh FINALIZE predecessor');
 basis_snapshot:=pg_temp.r139_snapshot();
 select s.condition_id into prior_condition from app_private.funding_engine_state s where s.user_id=context.member_id;
 select eligible_principal_atomic::numeric,recovered_principal_atomic::numeric into principal_before,recovered_before
  from public.money_source_summaries where user_id=context.member_id;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.portion_id),'[]'::jsonb) into available_before
  from app_private.funding_portion_clock_state c where c.user_id=context.member_id and c.status='AVAILABLE';
 select coalesce(jsonb_agg(to_jsonb(c) order by c.portion_id),'[]'::jsonb) into held_before
  from app_private.funding_portion_clock_state c join public.funding_principal_recovery_allocations a on a.id=c.hold_allocation_id
  join public.withdrawal_requests r on r.hold_ledger_transaction_id=a.hold_ledger_transaction_id where r.id=v_request_id and c.status='HELD';
 caps_before:=app_private.funding_state_effective_capacities((select id from app_private.funding_engine_state where user_id=context.member_id));
 final_sql:=format('select public.finalize_withdrawal_ledger(%L::uuid,%L::uuid,%L)::text',v_request_id,context.admin_id,'r139-finalize-'||case_id||'-'||run_key);

 if case_id in('A','B') then
  before_snapshot:=pg_temp.r139_snapshot();
  perform pg_temp.r139_begin('r139_holder','service_role');
  perform pg_temp.r139_read('r139_holder','select ''locked''::text from pg_advisory_xact_lock(hashtextextended(''putduk-mining.safe-mode:GLOBAL'',0))');
  perform pg_temp.r139_dispatch('r139_writer','service_role',final_sql);
  observed:=pg_temp.r139_wait('r139_holder','r139_writer','ShareLock');
  pause_audit:=pg_temp.r139_global_command('r139_holder',true,'r139-pause-'||case_id||'-'||run_key);
  -- The actual control command fixes its clock after the observed waiter starts.
  pause_at:=pg_temp.r139_read('r139_holder',format('select effective_at::text from app_private.funding_global_control_originals where audit_id=%L::uuid',pause_audit))::timestamptz;
  if case_id='B' then
   resume_audit:=pg_temp.r139_global_command('r139_holder',false,'r139-resume-'||case_id||'-'||run_key);
   resume_at:=pg_temp.r139_read('r139_holder',format('select effective_at::text from app_private.funding_global_control_originals where audit_id=%L::uuid',resume_audit))::timestamptz;
  end if;
  release_bound:=pg_temp.r139_read('r139_holder','select clock_timestamp()::text')::timestamptz;
  perform pg_temp.r139_end('r139_holder');
  result:=pg_temp.r139_receive('r139_writer');perform pg_temp.r139_end('r139_writer');
  perform pg_temp.r139_check(observed,'G01 real native FINALIZE waiter observed same GLOBAL shared lock blocked by exclusive holder');
  perform pg_temp.r139_check((result->>'started_microseconds')::numeric<extract(epoch from pause_at)*1000000,
   'G02 genuine pause begins after waiter statement, so current postwait clock decides admission');
  if case_id='A' then
   perform pg_temp.r139_check(result->>'sqlstate'='55000' and result->>'message'='SAFE_MODE_ACTIVE',
    'A01 native waited FINALIZE rejects exact current pause rather than stale statement time');
   perform pg_temp.r139_check(before_snapshot=pg_temp.r139_snapshot(),
    'A02 rejected waiter has zero admissions/earnings/payout/source/recovered clocks/successor effects; original send retained');
   perform pg_temp.r139_begin('r139_holder','service_role');
   resume_audit:=pg_temp.r139_global_command('r139_holder',false,'r139-resume-A-'||run_key);
   resume_at:=pg_temp.r139_read('r139_holder',format('select effective_at::text from app_private.funding_global_control_originals where audit_id=%L::uuid',resume_audit))::timestamptz;
   release_bound:=pg_temp.r139_read('r139_holder','select clock_timestamp()::text')::timestamptz;
   perform pg_temp.r139_end('r139_holder');
   result:=pg_temp.r139_command('r139_writer','service_role',final_sql);perform pg_temp.r139_require_ok(result);
   perform pg_temp.r139_check((result->>'result')::uuid is not null,
    'A03 actual resumed same native command completes original sent request with actual service deferred commit');
  else
   perform pg_temp.r139_require_ok(result);
   perform pg_temp.r139_check(pause_at<resume_at and resume_at<=release_bound,
    'B01 two canonical pause/resume originals complete before waiter financial clock admission');
   perform pg_temp.r139_check((select b.previous_state_id=(basis_snapshot->'state'->>'id')::uuid
    from app_private.funding_withdrawal_clock_admissions a join app_private.funding_principal_boundary_preparations b on b.clock_admission_id=a.id
    where a.withdrawal_id=v_request_id and a.phase='FINALIZE'),
    'B02 accepted old earning binds actual held predecessor and excludes sealed pause without resetting state');
  end if;
 elsif case_id='C' then
  select * into saved_allocation from app_private.funding_allocation_originals a where a.user_id=context.member_id order by a.revision desc limit 1;
  allocation_sql:=format('select public.confirm_funding_allocation(''CONFIRM'',%L::uuid,%L,%s::bigint,jsonb_build_array(jsonb_build_object(''productId'',%L::uuid,''allocationBps'',''5000'')),%L)::text',
   context.catalog_id,context.catalog_digest,saved_allocation.revision,context.product_id,'r139-allocation-C-'||run_key);
  perform pg_temp.r139_begin('r139_holder','authenticated');result:=pg_temp.r139_attempt('r139_holder',allocation_sql);perform pg_temp.r139_require_ok(result);
  perform pg_temp.r139_exec('r139_holder','set constraints all immediate');
  allocation_condition:=((result->>'result')::jsonb->>'transitionId')::uuid;
  allocation_at:=((result->>'result')::jsonb->>'effectiveAt')::timestamptz;
  perform pg_temp.r139_dispatch('r139_writer','service_role',final_sql);
  observed:=pg_temp.r139_wait('r139_holder','r139_writer','ExclusiveLock');
  release_bound:=pg_temp.r139_read('r139_holder','select clock_timestamp()::text')::timestamptz;
  perform pg_temp.r139_end('r139_holder');result:=pg_temp.r139_receive('r139_writer');perform pg_temp.r139_require_ok(result);perform pg_temp.r139_end('r139_writer');
  perform pg_temp.r139_check(observed,'C01 native FINALIZE observed waiting on actual member allocation transaction, not a fabricated row');
  perform pg_temp.r139_check(allocation_at<=release_bound,'C02 release follows actual owner canonical allocation receipt clock');
  perform pg_temp.r139_check((select old.condition_id=allocation_condition and e.condition_id=allocation_condition and old.cursor_at=allocation_at
   from app_private.funding_withdrawal_clock_admissions a
   join app_private.funding_principal_boundary_preparations b on b.clock_admission_id=a.id
   join app_private.funding_engine_state_receipts old on old.id=b.previous_state_id
   join app_private.funding_earned_receipts e on e.cause_principal_boundary_id=b.id
   where a.withdrawal_id=v_request_id and a.phase='FINALIZE'),
   'C03 postwait earning uses genuinely committed current allocation condition, not prewait held snapshot');
  perform pg_temp.r139_check((select o.current_condition_id=i.previous_condition_id and i.previous_condition_id<>allocation_condition
   from app_private.funding_principal_recovery_intent_originals i join app_private.withdrawal_principal_confirmation_originals o on o.logical_key=(select r.idempotency_key from public.withdrawal_requests r where r.id=i.withdrawal_id) and o.user_id=i.user_id where i.withdrawal_id=v_request_id),
   'C04 original member consent/HOLD remains immutable while sent payout admits current successor condition');
 elsif case_id='D' then
  before_snapshot:=pg_temp.r139_snapshot();
  perform pg_temp.r139_begin('r139_writer','service_role','repeatable read');result:=pg_temp.r139_attempt('r139_writer',final_sql);
  perform pg_temp.r139_exec('r139_writer','rollback');
  perform pg_temp.r139_check(result->>'sqlstate'='25000' and result->>'message'='WITHDRAWAL_CLOCK_FRESH_SNAPSHOT_REQUIRED',
   'D01 fresh RR native admission rejects exact closed-clock snapshot guard');
  perform pg_temp.r139_check(before_snapshot=pg_temp.r139_snapshot(),
   'D02 explicit RR rollback preserves all real send/HOLD/native/source/clock/runtime originals');
  release_bound:=pg_temp.r139_read('r139_holder','select clock_timestamp()::text')::timestamptz;
  result:=pg_temp.r139_command('r139_holder','service_role',final_sql);perform pg_temp.r139_require_ok(result);final_journal:=(result->>'result')::uuid;
  before_snapshot:=pg_temp.r139_snapshot();
  perform pg_temp.r139_begin('r139_holder','service_role');pause_audit:=pg_temp.r139_global_command('r139_holder',true,'r139-replay-pause-D-'||run_key);perform pg_temp.r139_end('r139_holder');
  replay:=pg_temp.r139_command('r139_writer','service_role',final_sql,'repeatable read');perform pg_temp.r139_require_ok(replay);
  perform pg_temp.r139_check((replay->>'result')::uuid=final_journal,
   'D03 completed native original replays before fresh RR/current pause gate and returns identical journal');
  perform pg_temp.r139_check(before_snapshot=pg_temp.r139_snapshot(),
   'D04 completed replay during true pause has zero extra payout/source/clock/earned/current-state effects');
  perform pg_temp.r139_begin('r139_holder','service_role');resume_audit:=pg_temp.r139_global_command('r139_holder',false,'r139-replay-resume-D-'||run_key);perform pg_temp.r139_end('r139_holder');
 elsif case_id='E' then
  perform pg_temp.r139_begin('r139_holder','service_role');release_bound:=pg_temp.r139_read('r139_holder','select clock_timestamp()::text')::timestamptz;
  result:=pg_temp.r139_attempt('r139_holder',final_sql);perform pg_temp.r139_require_ok(result);
  final_journal:=(result->>'result')::uuid;perform pg_temp.r139_exec('r139_holder','set constraints all immediate');
  perform pg_temp.r139_dispatch('r139_writer','service_role',final_sql);observed:=pg_temp.r139_wait('r139_holder','r139_writer','ExclusiveLock');
  perform pg_temp.r139_end('r139_holder');before_snapshot:=pg_temp.r139_snapshot();
  replay:=pg_temp.r139_receive('r139_writer');perform pg_temp.r139_require_ok(replay);perform pg_temp.r139_end('r139_writer');
  perform pg_temp.r139_check(observed,'E01 actual retry waiter serializes behind first uncommitted native FINALIZE member lock');
  perform pg_temp.r139_check((replay->>'result')::uuid=final_journal,
   'E02 both genuine native attempts return exact one committed payout journal');
  perform pg_temp.r139_check(before_snapshot=pg_temp.r139_snapshot(),
   'E03 released retry is a durable original replay with no second admission/earning/payout/source/state');
 end if;
 perform pg_temp.r139_finalize_proof(v_request_id,release_bound,pause_at,resume_at,caps_before,available_before,held_before,principal_before,recovered_before);
 perform pg_temp.r139_check(basis_snapshot->'cycle'=pg_temp.r139_snapshot()->'cycle',
  'Z01 every contended native FINALIZE preserves original cycle anchor/end');
 perform pg_temp.r139_check(not exists(select 1 from public.system_jobs j join app_private.funding_engine_jobs f on f.job_id=j.id
  where f.user_id=context.member_id and j.status in('PENDING','FAILED') and j.available_at<>'infinity'::timestamptz),
  'Z02 no automatic job/scheduler activation is invented by native contention fixture');
 perform pg_temp.r139_check((select count(*)=1 from app_private.funding_withdrawal_clock_admissions a where a.withdrawal_id=v_request_id and a.phase='FINALIZE'),
  'Z03 actual native payout has exactly one closed FINALIZE clock admission across retry/admission cases');
 execute format('select %I.dblink_disconnect(%L)',extension_schema,'r139_writer');
 execute format('select %I.dblink_disconnect(%L)',extension_schema,'r139_holder');
exception when others then
 begin perform pg_temp.r139_exec('r139_writer','rollback');exception when others then null;end;
 begin perform pg_temp.r139_exec('r139_holder','rollback');exception when others then null;end;
 begin execute format('select %I.dblink_disconnect(%L)',extension_schema,'r139_writer');exception when others then null;end;
 begin execute format('select %I.dblink_disconnect(%L)',extension_schema,'r139_holder');exception when others then null;end;
 raise;
end;$race$;
select ok(passed,description) from r139_checks order by id;
select * from finish();
-- Coordinator owns only TEMP probes. Genuine financial remote commits retained
-- until root's guarded full active120 reset. No journal/receipt teardown.
rollback;
