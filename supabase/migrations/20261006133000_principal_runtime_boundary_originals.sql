begin;

-- Unapplied outside-only coherent133 candidate. Requires all later133 guards,
-- producer/posting/completion and canonical hooks before any acceptance.
-- Closed server type is NOT a member principal confirmation contract.
-- Existing cycle id is already a primary key. PostgreSQL still requires
-- this exact composite unique key for the new same-member FK below.
-- Add no data, grants, monetary changes or fallback ownership.
alter table app_private.funding_cycle_windows
 add constraint funding_cycle_windows_id_user_unique unique(id,user_id);

create table app_private.funding_principal_boundary_preparations(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 intent_id uuid not null,clock_admission_id uuid not null unique,
 phase text not null check(phase in('HOLD','RELEASE')),
 previous_state_id uuid not null unique,cycle_id uuid not null,
 current_allocation_original_id uuid,
 settlement_expected boolean not null,
 unresolved_reason_code text check(unresolved_reason_code ~ '^[A-Z][A-Z0-9_]{2,95}$'),
 effective_at timestamptz not null check(isfinite(effective_at)),
 old_input_original jsonb not null check(jsonb_typeof(old_input_original)='object'),
 old_interval_calculation jsonb not null check(jsonb_typeof(old_interval_calculation)='object'),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null check(recorded_at=effective_at),unique(id,user_id),
 foreign key(intent_id,user_id) references app_private.funding_principal_recovery_intent_originals(id,user_id),
 foreign key(clock_admission_id,user_id) references app_private.funding_withdrawal_clock_admissions(id,user_id),
 foreign key(previous_state_id,user_id) references app_private.funding_engine_state_receipts(id,user_id),
 foreign key(cycle_id,user_id) references app_private.funding_cycle_windows(id,user_id),
 foreign key(current_allocation_original_id,user_id) references app_private.funding_allocation_originals(id,user_id),
 check((settlement_expected and unresolved_reason_code is null) or(not settlement_expected and unresolved_reason_code is not null))
);
create table app_private.funding_principal_boundary_completions(
 id uuid not null unique default gen_random_uuid(),boundary_id uuid primary key,
 user_id uuid not null references auth.users(id),source_movement_id uuid not null unique,
 condition_id uuid,accepted_state_id uuid not null,
 runtime_outcome text not null check(runtime_outcome in('ACCEPTED','UNRESOLVED')),
 reason_code text check(reason_code ~ '^[A-Z][A-Z0-9_]{2,95}$'),
 input_original jsonb not null check(jsonb_typeof(input_original)='object'),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
 effective_at timestamptz not null check(isfinite(effective_at)),
 recorded_at timestamptz not null check(recorded_at=effective_at),unique(boundary_id,user_id),
 foreign key(boundary_id,user_id) references app_private.funding_principal_boundary_preparations(id,user_id),
 foreign key(source_movement_id,user_id) references public.money_source_movements(id,user_id),
 foreign key(condition_id,user_id) references app_private.funding_condition_originals(id,user_id) deferrable initially deferred,
 foreign key(accepted_state_id,user_id) references app_private.funding_engine_state_receipts(id,user_id) deferrable initially deferred,
 check((runtime_outcome='ACCEPTED' and reason_code is null and condition_id is not null)
  or(runtime_outcome='UNRESOLVED' and reason_code is not null and condition_id is null))
);
-- A refused/ended-cycle CANCEL may retain the previously accepted state.
-- Only a genuinely new ACCEPTED boundary must own a unique successor.
create unique index funding_principal_completion_one_accepted_state on app_private.funding_principal_boundary_completions(accepted_state_id)
 where runtime_outcome='ACCEPTED';
do $closed_principal_originals$
declare relation_name text;
begin
 foreach relation_name in array array['funding_principal_boundary_preparations','funding_principal_boundary_completions'] loop
  execute format('alter table app_private.%I enable row level security',relation_name);
  execute format('alter table app_private.%I force row level security',relation_name);
  execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',relation_name);
  execute format('grant select on app_private.%I to service_role',relation_name);
  execute format('create trigger %I before update or delete on app_private.%I for each row execute function app_private.prevent_row_mutation()',relation_name||'_append_only',relation_name);
 end loop;
end;
$closed_principal_originals$;

alter table app_private.funding_condition_originals add column cause_principal_boundary_id uuid,
 add foreign key(cause_principal_boundary_id,user_id) references app_private.funding_principal_boundary_preparations(id,user_id);
alter table app_private.funding_earned_receipts add column cause_principal_boundary_id uuid,
 add foreign key(cause_principal_boundary_id,user_id) references app_private.funding_principal_boundary_preparations(id,user_id);

-- Assert the exact current128 contract using this PostgreSQL parser before
-- replacing only the three exact named checks. No broad/dynamic drop.
create temporary table funding_principal_prior_contract_assertion(
 revision bigint,previous_condition_id uuid,allocation_original_id uuid,cause_credit_boundary_id uuid,
 runtime_version integer,condition_id uuid,cause_allocation_id uuid,job_id uuid,attempt_number integer,
 worker_id text,fence_expires_at timestamptz,settled_to timestamptz,settled_from timestamptz,
 constraint expected_condition check(
  (revision=0 and previous_condition_id is null and allocation_original_id is null)
  or(revision>0 and previous_condition_id is not null and
    ((allocation_original_id is not null and cause_credit_boundary_id is null)
     or(allocation_original_id is null and cause_credit_boundary_id is not null)))),
 constraint expected_interval check(settled_to>settled_from
  or(runtime_version=2 and(job_id is null) and(cause_allocation_id is not null or cause_credit_boundary_id is not null) and settled_to=settled_from)),
 constraint expected_cause check(
  (runtime_version=1 and condition_id is null and cause_allocation_id is null and cause_credit_boundary_id is null
   and job_id is not null and attempt_number is not null and worker_id is not null and fence_expires_at is not null)
  or(runtime_version=2 and condition_id is not null and
   ((job_id is not null and cause_allocation_id is null and cause_credit_boundary_id is null
     and attempt_number is not null and worker_id is not null and fence_expires_at is not null)
    or(job_id is null and attempt_number is null and worker_id is null and fence_expires_at is null and
     ((cause_allocation_id is not null and cause_credit_boundary_id is null)
      or(cause_allocation_id is null and cause_credit_boundary_id is not null))))))
);
do $assert_exact_principal_predecessor$
begin
 if(select pg_get_constraintdef(oid) from pg_constraint where conrelid='app_private.funding_condition_originals'::regclass
    and conname='funding_condition_originals_check') is distinct from
   (select pg_get_constraintdef(oid) from pg_constraint where conrelid='pg_temp.funding_principal_prior_contract_assertion'::regclass
    and conname='expected_condition')
  or(select pg_get_constraintdef(oid) from pg_constraint where conrelid='app_private.funding_earned_receipts'::regclass
    and conname='funding_earned_interval_order') is distinct from
   (select pg_get_constraintdef(oid) from pg_constraint where conrelid='pg_temp.funding_principal_prior_contract_assertion'::regclass
    and conname='expected_interval')
  or(select pg_get_constraintdef(oid) from pg_constraint where conrelid='app_private.funding_earned_receipts'::regclass
    and conname='funding_earned_cause_branch') is distinct from
   (select pg_get_constraintdef(oid) from pg_constraint where conrelid='pg_temp.funding_principal_prior_contract_assertion'::regclass
    and conname='expected_cause') then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_PREDECESSOR_CONTRACT_UNEXPECTED'; end if;
end;
$assert_exact_principal_predecessor$;
drop table pg_temp.funding_principal_prior_contract_assertion;

alter table app_private.funding_condition_originals drop constraint funding_condition_originals_check;
alter table app_private.funding_condition_originals add constraint funding_condition_originals_check check(
 (revision=0 and previous_condition_id is null and allocation_original_id is null and cause_credit_boundary_id is null and cause_principal_boundary_id is null)
 or(revision>0 and previous_condition_id is not null and num_nonnulls(allocation_original_id,cause_credit_boundary_id,cause_principal_boundary_id)=1));
create unique index funding_condition_one_principal_cause on app_private.funding_condition_originals(cause_principal_boundary_id)
 where cause_principal_boundary_id is not null;
alter table app_private.funding_earned_receipts drop constraint funding_earned_interval_order;
alter table app_private.funding_earned_receipts add constraint funding_earned_interval_order check(settled_to>settled_from
 or(runtime_version=2 and job_id is null and num_nonnulls(cause_allocation_id,cause_credit_boundary_id,cause_principal_boundary_id)=1 and settled_to=settled_from));
alter table app_private.funding_earned_receipts drop constraint funding_earned_cause_branch;
alter table app_private.funding_earned_receipts add constraint funding_earned_cause_branch check(
 (runtime_version=1 and condition_id is null and cause_allocation_id is null and cause_credit_boundary_id is null and cause_principal_boundary_id is null
  and job_id is not null and attempt_number is not null and worker_id is not null and fence_expires_at is not null)
 or(runtime_version=2 and condition_id is not null and
  ((job_id is not null and cause_allocation_id is null and cause_credit_boundary_id is null and cause_principal_boundary_id is null
    and attempt_number is not null and worker_id is not null and fence_expires_at is not null)
   or(job_id is null and attempt_number is null and worker_id is null and fence_expires_at is null
    and num_nonnulls(cause_allocation_id,cause_credit_boundary_id,cause_principal_boundary_id)=1))));
create unique index funding_earned_one_principal_cause on app_private.funding_earned_receipts(cause_principal_boundary_id)
 where cause_principal_boundary_id is not null;

create function app_private.funding_principal_preparation_snapshot(p app_private.funding_principal_boundary_preparations)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('principal_contract_version',1,'user_id',p.user_id,'intent_id',p.intent_id,
 'clock_admission_id',p.clock_admission_id,'phase',p.phase,'previous_state_id',p.previous_state_id,'cycle_id',p.cycle_id,
 'current_allocation_original_id',p.current_allocation_original_id,
 'settlement_expected',p.settlement_expected,'unresolved_reason_code',p.unresolved_reason_code,
 'effective_at_microseconds',((extract(epoch from p.effective_at)*1000000)::bigint)::text,
 'old_input_original',p.old_input_original,'old_interval_calculation',p.old_interval_calculation,
 'member_confirmation','NOT_PROVEN','executor','closed_withdrawal_capture');
$$;
create function app_private.funding_principal_completion_snapshot(p app_private.funding_principal_boundary_completions)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('principal_contract_version',1,'user_id',p.user_id,'boundary_id',p.boundary_id,
 'source_movement_id',p.source_movement_id,'condition_id',p.condition_id,'accepted_state_id',p.accepted_state_id,
 'runtime_outcome',p.runtime_outcome,'reason_code',p.reason_code,'input_original',p.input_original,
 'effective_at_microseconds',((extract(epoch from p.effective_at)*1000000)::bigint)::text,
 'member_confirmation','NOT_PROVEN','executor','closed_principal_completion');
$$;
revoke all on function app_private.funding_principal_preparation_snapshot(app_private.funding_principal_boundary_preparations),
 app_private.funding_principal_completion_snapshot(app_private.funding_principal_boundary_completions)
 from public,anon,authenticated,service_role;

create or replace function app_private.funding_condition_snapshot(p_condition app_private.funding_condition_originals)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('user_id',p_condition.user_id,'activation_id',p_condition.activation_id,
  'revision',p_condition.revision::text,'previous_condition_id',p_condition.previous_condition_id,
  'allocation_id',p_condition.allocation_original_id,
  'effective_at_microseconds',((extract(epoch from p_condition.effective_at)*1000000)::bigint)::text,
  'inputs',p_condition.inputs) || case when p_condition.inputs->>'input_contract_version' in('2','3') then
   jsonb_build_object('condition_contract_version',2,'cause_credit_boundary_id',p_condition.cause_credit_boundary_id,
    'current_allocation_id',p_condition.current_allocation_original_id) else '{}'::jsonb end || case when p_condition.cause_principal_boundary_id is not null then jsonb_build_object('condition_contract_version',3,'cause_principal_boundary_id',p_condition.cause_principal_boundary_id) else '{}'::jsonb end;
$$;

create or replace function app_private.funding_earned_snapshot(p_e app_private.funding_earned_receipts)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('user_id',p_e.user_id,'activation_id',p_e.activation_id,'cycle_id',p_e.cycle_id,
  'job_id',p_e.job_id,'attempt_number',p_e.attempt_number,'worker_id',p_e.worker_id,
  'fence_expires_at_microseconds',((extract(epoch from p_e.fence_expires_at)*1000000)::bigint)::text,
  'previous_state_id',p_e.previous_state_id,'next_state_id',p_e.next_state_id,
  'settled_from_microseconds',((extract(epoch from p_e.settled_from)*1000000)::bigint)::text,
  'settled_to_microseconds',((extract(epoch from p_e.settled_to)*1000000)::bigint)::text,'calculation',p_e.calculation,
  'credit_id',p_e.credit_id,'settlement_id',p_e.settlement_id) || case when p_e.runtime_version=2 then
   jsonb_build_object('runtime_version',2,'condition_id',p_e.condition_id,'cause_allocation_id',p_e.cause_allocation_id)
    ||case when p_e.cause_credit_boundary_id is not null then jsonb_build_object('earned_contract_version',2,
      'cause_credit_boundary_id',p_e.cause_credit_boundary_id) else '{}'::jsonb end
   else '{}'::jsonb end || case when p_e.cause_principal_boundary_id is not null then jsonb_build_object('earned_contract_version',3,'cause_principal_boundary_id',p_e.cause_principal_boundary_id) else '{}'::jsonb end;
$$;

commit;
