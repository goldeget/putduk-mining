begin;

-- PART OF THE NEXT UNAPPLIED WRITER BATCH: not independently executable as a
-- product adapter. Completion/producer validators and canonical writers follow
-- in128200+. Old immutable snapshots keep their exact original field shape.
create table app_private.funding_credit_boundary_preparations(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 origin_code text not null check(origin_code in('KRW_DEPOSIT','USDT_KRW_DEPOSIT')),
 command_original_id uuid not null,previous_state_id uuid,settlement_expected boolean not null,
 unresolved_reason_code text check(unresolved_reason_code ~ '^[A-Z][A-Z0-9_]{2,95}$'),
 current_allocation_original_id uuid,
 effective_at timestamptz not null check(isfinite(effective_at)),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 unique(origin_code,command_original_id),unique(id,user_id),
 foreign key(previous_state_id,user_id) references app_private.funding_engine_state_receipts(id,user_id),
 foreign key(current_allocation_original_id,user_id) references app_private.funding_allocation_originals(id,user_id)
);
create unique index funding_credit_preparation_one_earning on app_private.funding_credit_boundary_preparations(previous_state_id)
 where settlement_expected;
alter table public.money_source_movements add constraint money_source_movements_id_owner_key unique(id,user_id);
create table app_private.funding_credit_boundary_completions(
 id uuid not null unique default gen_random_uuid(),boundary_id uuid primary key,user_id uuid not null references auth.users(id),
 credit_movement_id uuid not null unique,
 condition_id uuid unique,accepted_state_id uuid unique,
 activation_id uuid,
 runtime_outcome text not null check(runtime_outcome in('ACCEPTED','INACTIVE','UNRESOLVED')),
 reason_code text check(reason_code ~ '^[A-Z][A-Z0-9_]{2,95}$'),
 input_original jsonb not null check(jsonb_typeof(input_original)='object'),
 input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 recorded_at timestamptz not null default clock_timestamp(),unique(boundary_id,user_id),
 foreign key(boundary_id,user_id) references app_private.funding_credit_boundary_preparations(id,user_id),
 foreign key(credit_movement_id,user_id) references public.money_source_movements(id,user_id),
 foreign key(condition_id,user_id) references app_private.funding_condition_originals(id,user_id) deferrable initially deferred,
 foreign key(accepted_state_id,user_id) references app_private.funding_engine_state_receipts(id,user_id) deferrable initially deferred,
 foreign key(activation_id,user_id) references app_private.funding_engine_activations(id,user_id),
 check((runtime_outcome='ACCEPTED' and reason_code is null and activation_id is not null
    and condition_id is not null and accepted_state_id is not null)
  or(runtime_outcome='INACTIVE' and reason_code is not null and activation_id is null and condition_id is null and accepted_state_id is null)
  or(runtime_outcome='UNRESOLVED' and reason_code is not null))
);
create table app_private.funding_effective_capacity_receipts(
 state_id uuid primary key,user_id uuid not null references auth.users(id),
 base_capacity_num numeric not null check(base_capacity_num>=0 and base_capacity_num=trunc(base_capacity_num)),
 base_capacity_den numeric not null check(base_capacity_den>0 and base_capacity_den=trunc(base_capacity_den)),
 retention_capacity_num numeric not null check(retention_capacity_num>=0 and retention_capacity_num=trunc(retention_capacity_num)),
 retention_capacity_den numeric not null check(retention_capacity_den>0 and retention_capacity_den=trunc(retention_capacity_den)),
 recorded_at timestamptz not null default clock_timestamp(),unique(state_id,user_id),
 foreign key(state_id,user_id) references app_private.funding_engine_state_receipts(id,user_id) deferrable initially deferred
);
do $close_credit_originals$
declare t text;
begin
 foreach t in array array['funding_credit_boundary_preparations','funding_credit_boundary_completions','funding_effective_capacity_receipts'] loop
  execute format('alter table app_private.%I enable row level security',t);
  execute format('alter table app_private.%I force row level security',t);
  execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on app_private.%I to service_role',t);
  execute format('create trigger %I before update or delete on app_private.%I for each row execute function app_private.prevent_row_mutation()',t||'_append_only',t);
 end loop;
end;
$close_credit_originals$;

alter table app_private.funding_condition_originals
 add column cause_credit_boundary_id uuid,
 add column current_allocation_original_id uuid,
 add foreign key(cause_credit_boundary_id,user_id) references app_private.funding_credit_boundary_preparations(id,user_id),
 add foreign key(current_allocation_original_id,user_id) references app_private.funding_allocation_originals(id,user_id);
-- Ask this PG parser to canonicalize the exact approved predecessor formulas.
-- Temporary-only assertions avoid guessing parentheses in pg_get_constraintdef.
create temporary table funding_credit_prior_contract_assertion(
 revision bigint,previous_condition_id uuid,allocation_original_id uuid,
 runtime_version integer,condition_id uuid,cause_allocation_id uuid,job_id uuid,attempt_number integer,
 worker_id text,fence_expires_at timestamptz,settled_to timestamptz,settled_from timestamptz,
 constraint expected_condition check((revision=0 and previous_condition_id is null and allocation_original_id is null)
  or(revision>0 and previous_condition_id is not null and allocation_original_id is not null)),
 constraint expected_interval check(settled_to>settled_from
  or(runtime_version=2 and cause_allocation_id is not null and settled_to=settled_from)),
 constraint expected_cause check(
  (runtime_version=1 and condition_id is null and cause_allocation_id is null
   and job_id is not null and attempt_number is not null and worker_id is not null and fence_expires_at is not null)
  or(runtime_version=2 and condition_id is not null and
   ((job_id is not null and cause_allocation_id is null and attempt_number is not null and worker_id is not null and fence_expires_at is not null)
    or(job_id is null and cause_allocation_id is not null and attempt_number is null and worker_id is null and fence_expires_at is null))))
);
do $exact_condition_contract$
begin
 if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='app_private.funding_condition_originals'::regclass
   and conname='funding_condition_originals_check') is distinct from
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid='pg_temp.funding_credit_prior_contract_assertion'::regclass
   and conname='expected_condition') then
  raise exception using errcode='55000',message='FUNDING_CONDITION_PREVIOUS_CONTRACT_UNEXPECTED'; end if;
end;
$exact_condition_contract$;
alter table app_private.funding_condition_originals drop constraint funding_condition_originals_check;
alter table app_private.funding_condition_originals add constraint funding_condition_originals_check check(
 (revision=0 and previous_condition_id is null and allocation_original_id is null)
 or(revision>0 and previous_condition_id is not null and
   ((allocation_original_id is not null and cause_credit_boundary_id is null)
    or(allocation_original_id is null and cause_credit_boundary_id is not null))));
create unique index funding_condition_one_credit_cause on app_private.funding_condition_originals(cause_credit_boundary_id)
 where cause_credit_boundary_id is not null;

alter table app_private.funding_earned_receipts add column cause_credit_boundary_id uuid,
 add foreign key(cause_credit_boundary_id,user_id) references app_private.funding_credit_boundary_preparations(id,user_id);
-- Applied126 contract names are exact; never drop a broad/dynamic constraint.
do $exact_earned_contract$
begin
 if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='app_private.funding_earned_receipts'::regclass
   and conname='funding_earned_interval_order') is distinct from
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid='pg_temp.funding_credit_prior_contract_assertion'::regclass
   and conname='expected_interval')
  or (select pg_get_constraintdef(oid) from pg_constraint where conrelid='app_private.funding_earned_receipts'::regclass
   and conname='funding_earned_cause_branch') is distinct from
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid='pg_temp.funding_credit_prior_contract_assertion'::regclass
   and conname='expected_cause') then
  raise exception using errcode='55000',message='FUNDING_EARNED_PREVIOUS_CONTRACT_UNEXPECTED'; end if;
end;
$exact_earned_contract$;
drop table pg_temp.funding_credit_prior_contract_assertion;
alter table app_private.funding_earned_receipts drop constraint funding_earned_interval_order;
alter table app_private.funding_earned_receipts add constraint funding_earned_interval_order check(settled_to>settled_from
 or(runtime_version=2 and(job_id is null) and(cause_allocation_id is not null or cause_credit_boundary_id is not null) and settled_to=settled_from));
alter table app_private.funding_earned_receipts drop constraint funding_earned_cause_branch;
alter table app_private.funding_earned_receipts add constraint funding_earned_cause_branch check(
 (runtime_version=1 and condition_id is null and cause_allocation_id is null and cause_credit_boundary_id is null
  and job_id is not null and attempt_number is not null and worker_id is not null and fence_expires_at is not null)
 or(runtime_version=2 and condition_id is not null and
  ((job_id is not null and cause_allocation_id is null and cause_credit_boundary_id is null
    and attempt_number is not null and worker_id is not null and fence_expires_at is not null)
   or(job_id is null and attempt_number is null and worker_id is null and fence_expires_at is null and
    ((cause_allocation_id is not null and cause_credit_boundary_id is null)
     or(cause_allocation_id is null and cause_credit_boundary_id is not null))))));
create unique index funding_earned_one_credit_boundary on app_private.funding_earned_receipts(cause_credit_boundary_id)
 where cause_credit_boundary_id is not null;

create function app_private.funding_credit_preparation_snapshot(p app_private.funding_credit_boundary_preparations)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('contract_version',2,'user_id',p.user_id,'origin_code',p.origin_code,
  'command_original_id',p.command_original_id,'previous_state_id',p.previous_state_id,'settlement_expected',p.settlement_expected,
  'unresolved_reason_code',p.unresolved_reason_code,
  'current_allocation_id',p.current_allocation_original_id,
  'effective_at_microseconds',((extract(epoch from p.effective_at)*1000000)::bigint)::text);
$$;
create function app_private.funding_credit_completion_snapshot(p app_private.funding_credit_boundary_completions)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('contract_version',2,'boundary_id',p.boundary_id,'user_id',p.user_id,
  'credit_movement_id',p.credit_movement_id,'condition_id',p.condition_id,'accepted_state_id',p.accepted_state_id,
  'activation_id',p.activation_id,'runtime_outcome',p.runtime_outcome,'reason_code',p.reason_code,'input_original',p.input_original);
$$;

create or replace function app_private.funding_condition_snapshot(p_condition app_private.funding_condition_originals)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('user_id',p_condition.user_id,'activation_id',p_condition.activation_id,
  'revision',p_condition.revision::text,'previous_condition_id',p_condition.previous_condition_id,
  'allocation_id',p_condition.allocation_original_id,
  'effective_at_microseconds',((extract(epoch from p_condition.effective_at)*1000000)::bigint)::text,
  'inputs',p_condition.inputs) || case when p_condition.inputs->>'input_contract_version'='2' then
   jsonb_build_object('condition_contract_version',2,'cause_credit_boundary_id',p_condition.cause_credit_boundary_id,
    'current_allocation_id',p_condition.current_allocation_original_id) else '{}'::jsonb end;
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
   else '{}'::jsonb end;
$$;

revoke all on function app_private.funding_credit_preparation_snapshot(app_private.funding_credit_boundary_preparations),
 app_private.funding_credit_completion_snapshot(app_private.funding_credit_boundary_completions) from public,anon,authenticated,service_role;
grant execute on function app_private.funding_credit_preparation_snapshot(app_private.funding_credit_boundary_preparations),
 app_private.funding_credit_completion_snapshot(app_private.funding_credit_boundary_completions) to service_role;

commit;
