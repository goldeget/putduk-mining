begin;

-- Disconnected private foundation: no credit hook, worker registration, public
-- RPC, assignment/catalog seed, retrospective activation or legacy regrant.
create table app_private.funding_engine_epochs (
  version integer primary key check (version = 1),
  introduced_at timestamptz not null default clock_timestamp()
);
insert into app_private.funding_engine_epochs(version) values (1);
alter table app_private.funding_engine_epochs enable row level security;
alter table app_private.funding_engine_epochs force row level security;
create trigger funding_engine_epochs_append_only before update or delete
  on app_private.funding_engine_epochs for each row execute function app_private.prevent_row_mutation();
revoke all on app_private.funding_engine_epochs from public, anon, authenticated, service_role;
grant select on app_private.funding_engine_epochs to service_role;

create function app_private.funding_exact_ratio(p_num numeric, p_den numeric)
returns numeric[] language plpgsql immutable security invoker set search_path = pg_catalog
as $$
declare v_gcd numeric;
begin
  if p_num is null or p_den is null or p_num < 0 or p_den <= 0
    or p_num <> trunc(p_num) or p_den <> trunc(p_den)
    or p_num::text in ('NaN','Infinity','-Infinity')
    or p_den::text in ('NaN','Infinity','-Infinity') then
    raise exception using errcode='22023', message='FUNDING_EXACT_RATIO_INVALID';
  end if;
  v_gcd := gcd(p_num,p_den);
  return array[div(p_num,v_gcd),div(p_den,v_gcd)];
end;
$$;

create function app_private.funding_exact_sum(p_left numeric[], p_right numeric[])
returns numeric[] language sql immutable security invoker set search_path = pg_catalog
as $$ select app_private.funding_exact_ratio(
  p_left[1]*p_right[2]+p_right[1]*p_left[2],p_left[2]*p_right[2]); $$;

create function app_private.funding_exact_default_interval(
  p_principal_atomic bigint, p_base_bps integer, p_retention_bps integer,
  p_allocation_bps integer, p_cycle_microseconds bigint, p_elapsed_microseconds bigint,
  p_base_used_num numeric, p_base_used_den numeric,
  p_retention_used_num numeric, p_retention_used_den numeric,
  p_carry_num numeric, p_carry_den numeric, p_qualify_retention boolean
) returns jsonb language plpgsql immutable security invoker set search_path = pg_catalog
as $$
declare
  v_base numeric[]; v_retention numeric[]; v_remaining numeric[];
  v_base_used numeric[]; v_retention_used numeric[]; v_carry numeric[];
  v_total numeric[]; v_qualified numeric[] := array[0::numeric,1::numeric];
  v_whole numeric;
begin
  if p_principal_atomic is null or p_principal_atomic <= 0
    or p_base_bps is null or p_base_bps < 0 or p_base_bps > 10000
    or p_retention_bps is null or p_retention_bps < 0 or p_retention_bps > 10000
    or p_allocation_bps is null or p_allocation_bps not between 1 and 10000
    or p_cycle_microseconds is null or p_cycle_microseconds <= 0
    or p_elapsed_microseconds is null or p_elapsed_microseconds < 0
    or p_elapsed_microseconds > p_cycle_microseconds or p_qualify_retention is null then
    raise exception using errcode='22023',message='FUNDING_DEFAULT_INTERVAL_INVALID';
  end if;
  v_base_used := app_private.funding_exact_ratio(p_base_used_num,p_base_used_den);
  v_retention_used := app_private.funding_exact_ratio(p_retention_used_num,p_retention_used_den);
  v_carry := app_private.funding_exact_ratio(p_carry_num,p_carry_den);
  if v_carry[1] >= v_carry[2] then
    raise exception using errcode='22023',message='FUNDING_CARRY_INVALID';
  end if;
  v_base := app_private.funding_exact_ratio(p_principal_atomic::numeric*p_base_bps
    *p_elapsed_microseconds*p_allocation_bps,10000::numeric*p_cycle_microseconds*10000);
  v_remaining := app_private.funding_exact_ratio(greatest(0,
    p_principal_atomic::numeric*p_base_bps*v_base_used[2]-v_base_used[1]*10000),10000*v_base_used[2]);
  if v_base[1]*v_remaining[2] > v_remaining[1]*v_base[2] then v_base := v_remaining; end if;
  -- Maintenance is principal-based and independent of BASE product allocation
  -- weights/modifiers. Its eligibility/qualification remains a separate proof.
  v_retention := app_private.funding_exact_ratio(p_principal_atomic::numeric*p_retention_bps
    *p_elapsed_microseconds,10000::numeric*p_cycle_microseconds);
  v_remaining := app_private.funding_exact_ratio(greatest(0,
    p_principal_atomic::numeric*p_retention_bps*v_retention_used[2]-v_retention_used[1]*10000),
    10000*v_retention_used[2]);
  if v_retention[1]*v_remaining[2] > v_remaining[1]*v_retention[2] then v_retention := v_remaining; end if;
  v_base_used := app_private.funding_exact_sum(v_base_used,v_base);
  v_retention_used := app_private.funding_exact_sum(v_retention_used,v_retention);
  if p_qualify_retention then v_qualified := v_retention_used; end if;
  v_total := app_private.funding_exact_sum(app_private.funding_exact_sum(v_carry,v_base),v_qualified);
  v_whole := div(v_total[1],v_total[2]);
  if v_whole > 9223372036854775807 then
    raise exception using errcode='22003',message='FUNDING_WHOLE_KRW_OVERFLOW';
  end if;
  v_carry := app_private.funding_exact_ratio(mod(v_total[1],v_total[2]),v_total[2]);
  -- Unlike generic ANY jsonb_build_object (STABLE), jsonb_object(text[],text[])
  -- and numeric output are IMMUTABLE. These fixed keys + validated exact
  -- integer strings preserve both JSON semantics and the pure math contract.
  return jsonb_object(array['baseNum','baseDen','conditionalRetentionNum','conditionalRetentionDen',
    'baseUsedNum','baseUsedDen','retentionUsedNum','retentionUsedDen',
    'qualifiedRetentionNum','qualifiedRetentionDen','amountAtomic','carryNum','carryDen'],
    array[v_base[1]::text,v_base[2]::text,v_retention[1]::text,v_retention[2]::text,
      v_base_used[1]::text,v_base_used[2]::text,v_retention_used[1]::text,v_retention_used[2]::text,
      v_qualified[1]::text,v_qualified[2]::text,v_whole::text,v_carry[1]::text,v_carry[2]::text]);
end;
$$;

-- An input-original store, not a member assignment writer. No service INSERT
-- grant exists until the missing catalog/member authority mapping is reviewed.
create table app_private.funding_allocation_originals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  revision bigint not null check(revision > 0),
  catalog_version_id uuid not null references public.product_catalog_versions(id),
  products jsonb not null check(jsonb_typeof(products)='array' and jsonb_array_length(products)>0),
  effects jsonb not null default '{}' check(effects='{}'::jsonb),
  effective_at timestamptz not null check(isfinite(effective_at)),
  audit_id uuid not null unique references public.audit_logs(id),
  source_event_id uuid not null unique references public.outbox_events(id),
  input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  unique(user_id,revision), unique(id,user_id)
);

create table app_private.funding_engine_activations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  trigger_credit_movement_id uuid not null unique references public.money_source_movements(id),
  trigger_principal_revision_id uuid not null unique references public.funding_principal_revisions(id),
  allocation_original_id uuid not null references app_private.funding_allocation_originals(id),
  policy_publication_id uuid not null references app_private.economy_policy_publications(id),
  first_cycle_id uuid not null unique references app_private.funding_cycle_windows(id),
  principal_atomic bigint not null check(principal_atomic > 0),
  effective_at timestamptz not null check(isfinite(effective_at)),
  input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
  audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
  source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(id,user_id)
);

create table app_private.funding_engine_state_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  activation_id uuid not null references app_private.funding_engine_activations(id),
  cycle_id uuid not null references app_private.funding_cycle_windows(id),
  revision bigint not null check(revision >= 0),
  previous_state_id uuid references app_private.funding_engine_state_receipts(id),
  earned_receipt_id uuid unique,
  cursor_at timestamptz not null check(isfinite(cursor_at)),
  base_used_num numeric not null check(base_used_num >= 0 and base_used_num=trunc(base_used_num)),
  base_used_den numeric not null check(base_used_den > 0 and base_used_den=trunc(base_used_den)),
  retention_used_num numeric not null check(retention_used_num >= 0 and retention_used_num=trunc(retention_used_num)),
  retention_used_den numeric not null check(retention_used_den > 0 and retention_used_den=trunc(retention_used_den)),
  carry_num numeric not null check(carry_num >= 0 and carry_num=trunc(carry_num)),
  carry_den numeric not null check(carry_den > carry_num and carry_den=trunc(carry_den)),
  cycle_closed boolean not null default false,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(user_id,revision), unique(id,user_id),
  check((revision=0 and previous_state_id is null and earned_receipt_id is null)
    or (revision>0 and previous_state_id is not null and earned_receipt_id is not null))
);

create table app_private.funding_engine_jobs (
  job_id uuid primary key references public.system_jobs(id),
  user_id uuid not null references auth.users(id),
  activation_id uuid not null references app_private.funding_engine_activations(id),
  expected_state_id uuid not null references app_private.funding_engine_state_receipts(id),
  input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
  audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
  source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
  recorded_at timestamptz not null default clock_timestamp()
);

create table app_private.funding_earned_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  activation_id uuid not null references app_private.funding_engine_activations(id),
  cycle_id uuid not null references app_private.funding_cycle_windows(id),
  job_id uuid not null unique references app_private.funding_engine_jobs(job_id),
  attempt_number integer not null,
  worker_id text not null check(btrim(worker_id)<>''),
  fence_expires_at timestamptz not null check(isfinite(fence_expires_at)),
  previous_state_id uuid not null unique references app_private.funding_engine_state_receipts(id),
  next_state_id uuid not null unique references app_private.funding_engine_state_receipts(id) deferrable initially deferred,
  settled_from timestamptz not null,
  settled_to timestamptz not null check(settled_to>settled_from),
  calculation jsonb not null check(jsonb_typeof(calculation)='object'),
  amount_atomic bigint not null check(amount_atomic >= 0),
  input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
  credit_id uuid unique,
  settlement_id uuid unique,
  audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
  source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key(job_id,attempt_number) references public.system_job_attempts(job_id,attempt_number),
  unique(user_id,cycle_id,settled_from,settled_to), unique(id,user_id),
  check((amount_atomic=0 and credit_id is null and settlement_id is null)
    or (amount_atomic>0 and credit_id is not null and settlement_id is not null))
);
alter table app_private.funding_engine_state_receipts add constraint funding_state_earned_fk
  foreign key(earned_receipt_id) references app_private.funding_earned_receipts(id) deferrable initially deferred;

create table app_private.funding_retention_qualifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  cycle_id uuid not null unique references app_private.funding_cycle_windows(id),
  earned_receipt_id uuid not null unique references app_private.funding_earned_receipts(id),
  qualified_num numeric not null check(qualified_num >= 0 and qualified_num=trunc(qualified_num)),
  qualified_den numeric not null check(qualified_den > 0 and qualified_den=trunc(qualified_den)),
  principal_input_digest text not null check(principal_input_digest ~ '^[a-f0-9]{64}$'),
  qualified_at timestamptz not null check(isfinite(qualified_at)),
  recorded_at timestamptz not null default clock_timestamp()
);

-- No mutable balance/progress authority: current state is an indexed view of
-- append-only state receipts whose next revision belongs to one earned receipt.
create view app_private.funding_engine_state with(security_invoker=true) as
select distinct on(user_id) * from app_private.funding_engine_state_receipts
order by user_id,revision desc;

do $private_fact_lock$
declare v_table text;
begin
  foreach v_table in array array['funding_allocation_originals','funding_engine_activations',
    'funding_engine_state_receipts','funding_engine_jobs','funding_earned_receipts','funding_retention_qualifications'] loop
    execute format('alter table app_private.%I enable row level security',v_table);
    execute format('alter table app_private.%I force row level security',v_table);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',v_table);
    execute format('grant select on app_private.%I to service_role',v_table);
    if v_table<>'funding_allocation_originals' then
      execute format('grant insert on app_private.%I to service_role',v_table);
    end if;
    execute format('create trigger %I before update or delete on app_private.%I for each row execute function app_private.prevent_row_mutation()',
      v_table||'_append_only',v_table);
  end loop;
end;
$private_fact_lock$;
revoke all on app_private.funding_engine_state from public,anon,authenticated,service_role;
grant select on app_private.funding_engine_state to service_role;
revoke all on function app_private.funding_exact_ratio(numeric,numeric),
  app_private.funding_exact_sum(numeric[],numeric[]),
  app_private.funding_exact_default_interval(bigint,integer,integer,integer,bigint,bigint,numeric,numeric,numeric,numeric,numeric,numeric,boolean)
  from public,anon,authenticated;
grant execute on function app_private.funding_exact_ratio(numeric,numeric),
  app_private.funding_exact_sum(numeric[],numeric[]),
  app_private.funding_exact_default_interval(bigint,integer,integer,integer,bigint,bigint,numeric,numeric,numeric,numeric,numeric,numeric,boolean)
  to service_role;

commit;
