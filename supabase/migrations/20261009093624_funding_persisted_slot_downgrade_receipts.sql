begin;
-- A2 proposal: Primary owns CLI-generated migration integration.


create or replace function app_private.assert_prospective_allocation(p_id uuid,p_user uuid,p_config jsonb,p_slots integer)
returns integer language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare a app_private.funding_allocation_originals%rowtype; log public.audit_logs%rowtype;
 item jsonb; total integer:=0; active_total integer:=0; ordinal integer:=0; bps integer; publication uuid;
begin
 select * into a from app_private.funding_allocation_originals where id=p_id;
 select * into log from public.audit_logs where id=a.audit_id;
 if a.id is null or a.user_id is distinct from p_user or a.effects<>'{}'
  or a.recorded_at is distinct from a.effective_at or a.effective_at>clock_timestamp()
  or p_slots is null or p_slots not between 0 and 128
  or a.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_allocation_snapshot(a)) then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_ALLOCATION_INVALID'; end if;
 perform app_private.assert_funding_engine_seal(a.id,'FUNDING_ALLOCATION_CONFIRMED',p_user,a.input_digest,
  a.audit_id,a.source_event_id,app_private.funding_allocation_snapshot(a));
 publication:=app_private.assert_published_product_catalog(a.catalog_version_id);
 if log.actor_user_id is distinct from p_user or log.created_at is distinct from a.effective_at
  or log.metadata->>'command_version' is distinct from '1'
  or log.metadata->>'expected_revision' is distinct from (a.revision-1)::text
  or log.metadata->>'catalog_publication_receipt_id' is distinct from publication::text
  or char_length(coalesce(log.metadata->>'idempotency_key','')) not between 8 and 200
  or not exists(select 1 from public.outbox_events e where e.id=a.source_event_id
    and e.occurred_at=a.effective_at and e.created_at=a.effective_at and e.correlation_id=log.request_id)
  or (select count(*) from app_private.funding_allocation_originals where user_id=p_user and revision<=a.revision)<>a.revision
  or (select published_at from public.product_catalog_versions where id=a.catalog_version_id)>a.effective_at then
  raise exception using errcode='55000',message='FUNDING_ALLOCATION_COMMAND_ORIGINAL_REQUIRED'; end if;
 if (select count(distinct value->>'productId') from jsonb_array_elements(a.products))<>jsonb_array_length(a.products) then
  raise exception using errcode='55000',message='FUNDING_ALLOCATION_DUPLICATE_PRODUCT'; end if;
 for item in select value from jsonb_array_elements(a.products) loop
  if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>3
   or not item ?& array['productId','ruleVersionId','allocationBps']
   or jsonb_typeof(item->'allocationBps') is distinct from 'string'
   or coalesce(item->>'allocationBps','') !~ '^[1-9][0-9]{0,4}$' then
   raise exception using errcode='55000',message='FUNDING_ALLOCATION_PAYLOAD_UNSUPPORTED'; end if;
  bps:=(item->>'allocationBps')::integer;
  if bps>(p_config#>>'{allocation,maximumPerProductBps}')::integer
   or not exists(select 1 from public.product_rule_versions r join public.mining_products p on p.id=r.product_id
    join public.product_availability av on av.product_id=p.id
    where r.id=(item->>'ruleVersionId')::uuid and p.id=(item->>'productId')::uuid
     and p.catalog_version_id=a.catalog_version_id and r.rule_payload='{}' and r.approved_by is not null
     and r.effective_at<=a.effective_at and r.retired_at is null
     and av.status='AVAILABLE' and av.available_from<=a.effective_at
     and (av.available_to is null or av.available_to>a.effective_at) and av.segment_key is null) then
   raise exception using errcode='55000',message='FUNDING_NEUTRAL_PRODUCT_RULE_REQUIRED'; end if;
  total:=total+bps; ordinal:=ordinal+1;
  if ordinal<=p_slots then active_total:=active_total+bps;end if;
 end loop;
 if total>(p_config#>>'{allocation,maximumTotalBps}')::integer then
  raise exception using errcode='55000',message='FUNDING_ALLOCATION_LIMIT_EXCEEDED'; end if;
 return active_total;
end;
$$;


-- Derived immutable receipts bind an original allocation to one exact condition
-- revision. Existing condition JSON/seals are deliberately unchanged.
create table app_private.funding_slot_condition_receipts(
 condition_id uuid primary key references app_private.funding_condition_originals(id),
 user_id uuid not null references auth.users(id),
 previous_condition_id uuid references app_private.funding_condition_originals(id),
 condition_revision bigint not null,
 allocation_original_id uuid not null references app_private.funding_allocation_originals(id),
 allocation_revision bigint not null,
 allocation_digest text not null,
 condition_digest text not null,
 effective_at timestamptz not null check(isfinite(effective_at)),
 approved_slots integer not null check(approved_slots between 0 and 128),
 active_allocation_bps integer not null check(active_allocation_bps between 0 and 10000),
 paused_allocation_bps integer not null check(paused_allocation_bps between 0 and 10000),
 projection jsonb not null check(jsonb_typeof(projection)='array'),
 audit_id uuid not null references public.audit_logs(id) deferrable initially deferred,
 source_event_id uuid not null references public.outbox_events(id) deferrable initially deferred,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table app_private.funding_slot_condition_receipts enable row level security;
alter table app_private.funding_slot_condition_receipts force row level security;
revoke all on app_private.funding_slot_condition_receipts from public,anon,authenticated,service_role;
grant select on app_private.funding_slot_condition_receipts to service_role;
create trigger funding_slot_receipt_append_only before update or delete on app_private.funding_slot_condition_receipts
 for each row execute function app_private.prevent_row_mutation();

create function app_private.funding_slot_projection(p_original uuid,p_user uuid,p_slots integer)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare original app_private.funding_allocation_originals%rowtype; result jsonb;
begin
 select a.* into original from app_private.funding_allocation_originals a where a.id=p_original;
 if original.id is null or original.user_id is distinct from p_user or p_slots is null or p_slots not between 0 and 128 then
  raise exception using errcode='55000',message='FUNDING_SLOT_ORIGINAL_REQUIRED';end if;
 select coalesce(jsonb_agg(jsonb_build_object('ordinal',x.ordinal,'productId',x.value->>'productId',
  'ruleVersionId',x.value->>'ruleVersionId','allocationBps',x.value->>'allocationBps',
  'state',case when x.ordinal<=p_slots then 'RETAINED' else 'PAUSED' end,
  'pauseReason',case when x.ordinal<=p_slots then null else 'SLOT_LIMIT_REDUCED' end) order by x.ordinal),'[]'::jsonb)
 into result from jsonb_array_elements(original.products) with ordinality x(value,ordinal);
 return result;
end;
$$;

-- Current producer only. The caller supplies its captured previous condition;
-- archived verification never consults a latest mutable state or a time cutoff.
create function app_private.assert_funding_slot_recovery_policy(p_previous uuid,p_original uuid,p_slots integer)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare previous app_private.funding_condition_originals%rowtype; original app_private.funding_allocation_originals%rowtype;
 old_slots integer;
begin
 select c.* into previous from app_private.funding_condition_originals c where c.id=p_previous;
 if previous.id is null or p_original is null or p_original is distinct from coalesce(previous.current_allocation_original_id,previous.allocation_original_id) then return;end if;
 if previous.inputs->>'input_contract_version' is distinct from '3' then return;end if;
 select a.* into original from app_private.funding_allocation_originals a where a.id=p_original;
 old_slots:=(previous.inputs->>'slots')::integer;
 if original.user_id is distinct from previous.user_id or old_slots is null or p_slots is null then
  raise exception using errcode='55000',message='FUNDING_SLOT_PREVIOUS_CONDITION_REQUIRED';end if;
 if jsonb_array_length(original.products)>old_slots and p_slots>old_slots then
  raise exception using errcode='55000',message='FUNDING_SLOT_RECOVERY_POLICY_REQUIRED';end if;
end;
$$;

create function app_private.assert_funding_slot_condition_receipt(p_condition uuid,p_required boolean default false)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare condition app_private.funding_condition_originals%rowtype; original app_private.funding_allocation_originals%rowtype;
 receipt app_private.funding_slot_condition_receipts%rowtype; projection jsonb; active_bps integer; paused_bps integer;
begin
 select c.* into condition from app_private.funding_condition_originals c where c.id=p_condition;
 if condition.inputs->>'input_contract_version' is distinct from '3' or coalesce(condition.current_allocation_original_id,condition.allocation_original_id) is null then return;end if;
 select r.* into receipt from app_private.funding_slot_condition_receipts r where r.condition_id=p_condition;
 if receipt.condition_id is null then
  if p_required then raise exception using errcode='55000',message='FUNDING_SLOT_RECEIPT_REQUIRED';end if;
  return; -- immutable pre-migration legacy rows have no new receipt
 end if;
 select a.* into original from app_private.funding_allocation_originals a where a.id=coalesce(condition.current_allocation_original_id,condition.allocation_original_id);
 projection:=app_private.funding_slot_projection(original.id,condition.user_id,(condition.inputs->>'slots')::integer);
 select coalesce(sum((x.value->>'allocationBps')::integer) filter(where x.value->>'state'='RETAINED'),0),
  coalesce(sum((x.value->>'allocationBps')::integer) filter(where x.value->>'state'='PAUSED'),0)
 into active_bps,paused_bps from jsonb_array_elements(projection) x(value);
 if receipt.user_id is distinct from condition.user_id or receipt.previous_condition_id is distinct from condition.previous_condition_id
  or receipt.condition_revision is distinct from condition.revision or receipt.allocation_original_id is distinct from original.id
  or receipt.allocation_revision is distinct from original.revision or receipt.allocation_digest is distinct from original.input_digest
  or receipt.condition_digest is distinct from condition.input_digest or receipt.effective_at is distinct from condition.effective_at
  or receipt.approved_slots is distinct from (condition.inputs->>'slots')::integer or receipt.projection is distinct from projection
  or receipt.active_allocation_bps is distinct from active_bps or receipt.paused_allocation_bps is distinct from paused_bps
  or active_bps::text is distinct from condition.inputs->>'allocation_bps'
  or receipt.audit_id is distinct from condition.audit_id or receipt.source_event_id is distinct from condition.source_event_id then
  raise exception using errcode='55000',message='FUNDING_SLOT_RECEIPT_MISMATCH';end if;
end;
$$;

create function app_private.capture_funding_slot_condition_receipt() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_allocation_originals%rowtype; projection jsonb; active_bps integer; paused_bps integer;
begin
 if new.inputs->>'input_contract_version' is distinct from '3' or coalesce(new.current_allocation_original_id,new.allocation_original_id) is null then return new;end if;
 if current_user<>'postgres' then raise exception using errcode='42501',message='FUNDING_SLOT_CANONICAL_WRITER_REQUIRED';end if;
 select a.* into original from app_private.funding_allocation_originals a where a.id=coalesce(new.current_allocation_original_id,new.allocation_original_id);
 perform app_private.assert_funding_slot_recovery_policy(new.previous_condition_id,original.id,(new.inputs->>'slots')::integer);
 projection:=app_private.funding_slot_projection(original.id,new.user_id,(new.inputs->>'slots')::integer);
 select coalesce(sum((x.value->>'allocationBps')::integer) filter(where x.value->>'state'='RETAINED'),0),
  coalesce(sum((x.value->>'allocationBps')::integer) filter(where x.value->>'state'='PAUSED'),0)
 into active_bps,paused_bps from jsonb_array_elements(projection) x(value);
 insert into app_private.funding_slot_condition_receipts(condition_id,user_id,previous_condition_id,condition_revision,
  allocation_original_id,allocation_revision,allocation_digest,condition_digest,effective_at,approved_slots,
  active_allocation_bps,paused_allocation_bps,projection,audit_id,source_event_id)
 values(new.id,new.user_id,new.previous_condition_id,new.revision,original.id,original.revision,original.input_digest,
  new.input_digest,new.effective_at,(new.inputs->>'slots')::integer,active_bps,paused_bps,projection,new.audit_id,new.source_event_id);
 perform app_private.assert_funding_slot_condition_receipt(new.id,true);
 return new;
end;
$$;
create trigger funding_slot_condition_capture after insert on app_private.funding_condition_originals
 for each row execute function app_private.capture_funding_slot_condition_receipt();

create function app_private.verify_funding_slot_condition_commit() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin perform app_private.assert_funding_slot_condition_receipt(new.id,true);return new;end;
$$;
create constraint trigger funding_slot_condition_complete after insert on app_private.funding_condition_originals
 deferrable initially deferred for each row execute function app_private.verify_funding_slot_condition_commit();

revoke all on function app_private.funding_slot_projection(uuid,uuid,integer),
 app_private.assert_funding_slot_recovery_policy(uuid,uuid,integer),
 app_private.assert_funding_slot_condition_receipt(uuid,boolean),app_private.capture_funding_slot_condition_receipt(),
 app_private.verify_funding_slot_condition_commit() from public,anon,authenticated,service_role;
grant execute on function app_private.funding_slot_projection(uuid,uuid,integer),
 app_private.assert_funding_slot_condition_receipt(uuid,boolean) to service_role;


create or replace function app_private.principal_boundary_expected_capacities(p_boundary uuid,p_next_inputs jsonb) returns numeric[]
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_principal_boundary_preparations%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; caps numeric[]; base numeric[]; maintenance numeric[];
 old_base numeric[]; new_base numeric[]; old_maintenance numeric[]; new_maintenance numeric[];
 span bigint; remaining bigint;
begin
 select b.* into preparation from app_private.funding_principal_boundary_preparations b where b.id=p_boundary;
 perform app_private.assert_principal_history_executor(preparation.user_id);
 select w.* into cycle from app_private.funding_cycle_windows w where w.id=preparation.cycle_id;
 if not preparation.settlement_expected or p_next_inputs->>'input_contract_version' is distinct from '3'
  or (p_next_inputs->>'tier_activated') is null
  or p_next_inputs->>'tier_activated' not in('true','false')
  or(p_next_inputs->>'tier_activated'='false' and(p_next_inputs->>'slots' is distinct from '0' or p_next_inputs->>'retention_bps' is distinct from '0' or p_next_inputs->>'tier_code' is not null))
  or p_next_inputs->>'user_id' is distinct from preparation.user_id::text
  or p_next_inputs->>'policy_publication_id' is distinct from preparation.old_input_original->>'policy_publication_id'
  or p_next_inputs->>'policy_config_digest' is distinct from preparation.old_input_original->>'policy_config_digest'
  or p_next_inputs->>'cycle_days' is distinct from preparation.old_input_original->>'cycle_days'
  or p_next_inputs->>'base_bps' is distinct from preparation.old_input_original->>'base_bps'
  or preparation.effective_at>=cycle.cycle_end then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_NEXT_CONDITION_UNRESOLVED'; end if;
 caps:=app_private.funding_state_effective_capacities(preparation.previous_state_id);
 span:=(extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint;
 remaining:=(extract(epoch from cycle.cycle_end-preparation.effective_at)*1000000)::bigint;
 old_base:=app_private.funding_exact_ratio((preparation.old_input_original->>'principal_atomic')::numeric*(preparation.old_input_original->>'base_bps')::numeric,10000);
 new_base:=app_private.funding_exact_ratio((p_next_inputs->>'principal_atomic')::numeric*(p_next_inputs->>'base_bps')::numeric,10000);
 old_maintenance:=app_private.funding_exact_ratio((preparation.old_input_original->>'principal_atomic')::numeric*(preparation.old_input_original->>'retention_bps')::numeric,10000);
 new_maintenance:=app_private.funding_exact_ratio((p_next_inputs->>'principal_atomic')::numeric*(p_next_inputs->>'retention_bps')::numeric,10000);
 base:=app_private.funding_exact_forward_capacity(caps[1],caps[2],old_base[1],old_base[2],new_base[1],new_base[2],remaining,span);
 maintenance:=app_private.funding_exact_forward_capacity(caps[3],caps[4],old_maintenance[1],old_maintenance[2],new_maintenance[1],new_maintenance[2],remaining,span);
 if(preparation.old_interval_calculation->>'baseUsedNum')::numeric*base[2]>base[1]*(preparation.old_interval_calculation->>'baseUsedDen')::numeric
  or(preparation.old_interval_calculation->>'retentionUsedNum')::numeric*maintenance[2]>maintenance[1]*(preparation.old_interval_calculation->>'retentionUsedDen')::numeric then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CAPACITY_HISTORY_UNSUPPORTED'; end if;
 return array[base[1],base[2],maintenance[1],maintenance[2]];
end;
$$;

create or replace function app_private.assert_principal_input_snapshot(p_boundary uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_principal_boundary_preparations%rowtype;
 completion app_private.funding_principal_boundary_completions%rowtype; inputs jsonb; item jsonb;
 movement public.money_source_movements%rowtype; lot public.funding_principal_lots%rowtype;
 revision public.funding_principal_revisions%rowtype; clock app_private.funding_portion_clock_receipts%rowtype;
 portion app_private.funding_principal_portions%rowtype; transition app_private.funding_portion_transitions%rowtype;
 admission app_private.funding_withdrawal_clock_admissions%rowtype;
 last_revision bigint; available numeric:=0; held numeric:=0; recovered numeric:=0; gross numeric:=0; actual_count bigint;
 expected jsonb; policy app_private.economy_policy_published%rowtype; tier jsonb; allocation_bps integer; native_allocation public.funding_principal_recovery_allocations%rowtype;
begin
 select b.* into preparation from app_private.funding_principal_boundary_preparations b where b.id=p_boundary;
 select c.* into completion from app_private.funding_principal_boundary_completions c where c.boundary_id=p_boundary;
 if completion.condition_id is not null then perform app_private.assert_funding_slot_condition_receipt(completion.condition_id);end if;
 perform app_private.assert_principal_history_executor(preparation.user_id);
 last_revision:=app_private.principal_snapshot_last_transition(p_boundary);inputs:=completion.input_original;
 if inputs->>'user_id' is distinct from preparation.user_id::text
  or inputs->>'principal_original_digest' is distinct from app_private.funding_engine_digest(inputs->'credit_originals')
  or inputs->>'recovery_original_digest' is distinct from app_private.funding_engine_digest(inputs->'recovery_originals')
  or inputs->>'portion_clock_original_digest' is distinct from app_private.funding_engine_digest(inputs->'portion_clock_originals') then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_INPUT_MISMATCH';end if;
 for item in select value from jsonb_array_elements(inputs->'credit_originals') loop
  select m.* into movement from public.money_source_movements m where m.id=(item->>'credit_id')::uuid;
  select l.* into lot from public.funding_principal_lots l where l.id=(item->>'lot_id')::uuid;
  select r.* into revision from public.funding_principal_revisions r where r.id=(item->>'principal_revision_id')::uuid;
  if movement.user_id is distinct from preparation.user_id or movement.source_bucket is distinct from 'PRINCIPAL'
   or movement.origin_code not in('KRW_DEPOSIT','USDT_KRW_DEPOSIT') or movement.movement_kind is distinct from 'CREDIT'
   or movement.effective_at>preparation.effective_at or lot.user_id is distinct from preparation.user_id
   or lot.money_source_movement_id is distinct from movement.id or revision.money_source_movement_id is distinct from movement.id
   or revision.user_id is distinct from preparation.user_id or revision.lot_id is distinct from lot.id
   or revision.direction is distinct from 'INCREASE' or revision.delta_micro_krw is distinct from lot.amount_micro_krw
   or lot.amount_atomic is distinct from movement.amount_atomic or lot.amount_micro_krw is distinct from app_private.funding_principal_micro_krw(movement.amount_atomic)
   or lot.ledger_transaction_id is distinct from movement.ledger_transaction_id or lot.source_event_id is distinct from movement.source_event_id
   or lot.effective_at is distinct from movement.effective_at or revision.effective_at is distinct from movement.effective_at
   or revision.ledger_transaction_id is distinct from movement.ledger_transaction_id or revision.source_event_id is distinct from movement.source_event_id
   or revision.hold_ledger_transaction_id is not null
   or revision.eligible_principal_micro_krw_after is distinct from app_private.funding_principal_mining_eligible_micro(preparation.user_id,movement.effective_at)
   or movement.effective_at<(select introduced_at from app_private.funding_engine_epochs where version=1)
   or item->>'amount_atomic' is distinct from movement.amount_atomic::text
   or item->>'effective_at_microseconds' is distinct from((extract(epoch from movement.effective_at)*1000000)::bigint)::text
   or not exists(select 1 from app_private.funding_portion_transitions t where t.user_id=preparation.user_id
    and t.kind='CREDIT' and t.original_id=lot.id and t.revision<=last_revision) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CREDIT_MISMATCH';end if;
  perform app_private.assert_money_source_credit(movement);gross:=gross+lot.amount_micro_krw;
 end loop;
 select count(*) into actual_count from public.funding_principal_lots l join app_private.funding_portion_transitions t
  on t.kind='CREDIT' and t.original_id=l.id where l.user_id=preparation.user_id and t.revision<=last_revision;
 if actual_count<>jsonb_array_length(inputs->'credit_originals')
  or actual_count<>(select count(distinct x->>'credit_id') from jsonb_array_elements(inputs->'credit_originals') x) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CREDIT_MISMATCH';end if;
 for item in select value from jsonb_array_elements(inputs->'recovery_originals') loop
  select m.* into movement from public.money_source_movements m where m.id=(item->>'movement_id')::uuid;
  select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=(item->>'clock_admission_id')::uuid;
  if movement.user_id is distinct from preparation.user_id or admission.user_id is distinct from preparation.user_id
   or movement.effective_at>preparation.effective_at or movement.effective_at is distinct from admission.effective_at
   or admission.phase is distinct from(case when movement.origin_code='PRINCIPAL_RECOVERY_HOLD' then 'HOLD' when movement.origin_code='PRINCIPAL_RECOVERY_RELEASE' then 'RELEASE' when movement.origin_code='PRINCIPAL_RECOVERY_FINALIZE' then 'FINALIZE' else null end)
   or movement.ledger_transaction_id is distinct from(select(case when admission.phase='HOLD' then r.hold_ledger_transaction_id when admission.phase='RELEASE' then r.release_ledger_transaction_id else r.finalize_ledger_transaction_id end) from public.withdrawal_requests r where r.id=admission.withdrawal_id)
   or item->>'origin_code' is distinct from movement.origin_code or item->>'ledger_transaction_id' is distinct from movement.ledger_transaction_id::text
   or item->>'source_event_id' is distinct from movement.source_event_id::text or item->>'amount_atomic' is distinct from movement.amount_atomic::text
   or item->>'effective_at_microseconds' is distinct from((extract(epoch from movement.effective_at)*1000000)::bigint)::text
   or item->>'intent_id' is distinct from(select i.id::text from app_private.funding_principal_recovery_intent_originals i
    where i.withdrawal_id=admission.withdrawal_id and i.user_id=preparation.user_id) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_RECOVERY_MISMATCH';end if;
  perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
  perform app_private.assert_principal_recovery_movement(movement);
 end loop;
 select count(distinct m.id) into actual_count from public.money_source_movements m
  join app_private.funding_portion_transitions t on t.user_id=m.user_id and t.revision<=last_revision
  left join public.funding_principal_recovery_allocations a on t.kind='HOLD' and a.id=t.original_id
  left join public.funding_principal_recovery_releases r on t.kind='RELEASE' and r.id=t.original_id
  left join public.withdrawal_requests finalized on t.kind='FINALIZE' and finalized.id=t.original_id
  where m.user_id=preparation.user_id and
   ((m.origin_code='PRINCIPAL_RECOVERY_HOLD' and m.ledger_transaction_id=a.hold_ledger_transaction_id)
    or(m.origin_code='PRINCIPAL_RECOVERY_RELEASE' and m.ledger_transaction_id=r.release_ledger_transaction_id)
    or(m.origin_code='PRINCIPAL_RECOVERY_FINALIZE' and m.ledger_transaction_id=finalized.finalize_ledger_transaction_id));
 if actual_count<>jsonb_array_length(inputs->'recovery_originals')
  or actual_count<>(select count(distinct x->>'movement_id') from jsonb_array_elements(inputs->'recovery_originals') x) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_RECOVERY_MISMATCH';end if;
 -- Archived DECREASE revisions are independently bound to native HOLD
 -- allocation/source, not inferred from the aggregate JSON or present wallet.
 for native_allocation in select a.* from public.funding_principal_recovery_allocations a
  join app_private.funding_portion_transitions t on t.kind='HOLD' and t.original_id=a.id
  where a.user_id=preparation.user_id and t.revision<=last_revision loop
  select r.* into revision from public.funding_principal_revisions r where r.user_id=preparation.user_id
   and r.hold_ledger_transaction_id=native_allocation.hold_ledger_transaction_id and r.lot_id=native_allocation.lot_id;
  if native_allocation.policy_code is distinct from 'NEWEST_FIRST' or revision.id is null
   or revision.direction is distinct from 'DECREASE' or revision.money_source_movement_id is not null
   or revision.ledger_transaction_id is distinct from native_allocation.hold_ledger_transaction_id
   or revision.delta_micro_krw is distinct from native_allocation.allocation_micro_krw
   or revision.effective_at is distinct from native_allocation.effective_at
   or revision.source_event_id is distinct from(select m.source_event_id from public.money_source_movements m
    where m.user_id=preparation.user_id and m.ledger_transaction_id=native_allocation.hold_ledger_transaction_id and m.origin_code='PRINCIPAL_RECOVERY_HOLD')
   or revision.eligible_principal_micro_krw_after is distinct from app_private.funding_principal_mining_eligible_micro(preparation.user_id,native_allocation.effective_at) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_RECOVERY_REVISION_MISMATCH';end if;
 end loop;
 for transition in select t.* from app_private.funding_portion_transitions t
  where t.user_id=preparation.user_id and t.revision<=last_revision order by t.revision loop
  perform app_private.verify_principal_history_portion_fact_bounded(transition,p_boundary,last_revision);
 end loop;
 for item in select value from jsonb_array_elements(inputs->'portion_clock_originals') loop
  select c.* into clock from app_private.funding_portion_clock_receipts c where c.id=(item->>'clock_id')::uuid;
  select p.* into portion from app_private.funding_principal_portions p where p.id=clock.portion_id;
  select t.* into transition from app_private.funding_portion_transitions t where t.id=clock.transition_id;
  expected:=jsonb_build_object('portion_id',portion.id,'lot_id',portion.lot_id,'parent_portion_id',portion.parent_portion_id,
   'amount_micro_krw',portion.amount_micro_krw::text,'clock_id',clock.id,'clock_revision',clock.revision::text,
   'transition_id',clock.transition_id,'status',clock.status,
   'clock_at_microseconds',((extract(epoch from clock.effective_at)*1000000)::bigint)::text,
   'accumulated_eligible_microseconds',clock.accumulated_eligible_microseconds::text,
   'resumed_at_microseconds',(case when clock.resumed_at is null then null else((extract(epoch from clock.resumed_at)*1000000)::bigint)::text end),
   'hold_allocation_id',clock.hold_allocation_id);
  if portion.user_id is distinct from preparation.user_id or clock.user_id is distinct from preparation.user_id
   or item is distinct from expected or transition.revision>last_revision
   or exists(select 1 from app_private.funding_portion_clock_receipts next_clock
    join app_private.funding_portion_transitions next_transition on next_transition.id=next_clock.transition_id
    where next_clock.portion_id=portion.id and next_clock.revision>clock.revision and next_transition.revision<=last_revision) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CLOCK_MISMATCH';end if;
  perform app_private.assert_principal_history_clock_original_bounded(clock.id,p_boundary,last_revision);
  if clock.status='AVAILABLE' then available:=available+portion.amount_micro_krw;
  elsif clock.status='HELD' then held:=held+portion.amount_micro_krw;
  elsif clock.status='RECOVERED' then recovered:=recovered+portion.amount_micro_krw;
  elsif clock.status<>'SPLIT' then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_STATUS_UNSUPPORTED';end if;
 end loop;
 select count(*) into actual_count from app_private.funding_principal_portions p
  join app_private.funding_portion_transitions t on t.id=p.introduced_by_transition_id
  where p.user_id=preparation.user_id and t.revision<=last_revision;
 if actual_count<>jsonb_array_length(inputs->'portion_clock_originals')
  or actual_count<>(select count(distinct x->>'portion_id') from jsonb_array_elements(inputs->'portion_clock_originals') x)
  or available+held+recovered is distinct from gross or available/1000000 is distinct from(inputs->>'principal_atomic')::numeric
  or held/1000000 is distinct from(inputs->>'held_principal_atomic')::numeric
  or recovered/1000000 is distinct from coalesce((inputs->>'recovered_principal_atomic')::numeric,0)
  or recovered is distinct from(select coalesce(sum(m.amount_atomic::numeric*1000000),0) from public.money_source_movements m
    join public.withdrawal_requests r on r.finalize_ledger_transaction_id=m.ledger_transaction_id
    join app_private.funding_portion_transitions t on t.kind='FINALIZE' and t.original_id=r.id
    where m.user_id=preparation.user_id and m.origin_code='PRINCIPAL_RECOVERY_FINALIZE' and t.revision<=last_revision) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CONSERVATION_REQUIRED';end if;
 select p.* into policy from app_private.economy_policy_published p where p.publication_id=(inputs->>'policy_publication_id')::uuid;
 if policy.config_digest is distinct from inputs->>'policy_config_digest' or policy.effective_from>preparation.effective_at
  or(policy.effective_until is not null and policy.effective_until<=preparation.effective_at)
  or inputs->>'base_bps' is distinct from policy.config->>'baseCycleRateBps'
  or inputs->>'cycle_days' is distinct from policy.config->>'cycleDays' then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_POLICY_MISMATCH';end if;
 perform app_private.assert_economy_policy_receipt(policy.revision_id);
 select value into tier from jsonb_array_elements(policy.config->'tiers') where
  (value->>'minimumPrincipalKrw')::numeric<=available/1000000
  and(value->>'maximumPrincipalKrw' is null or(value->>'maximumPrincipalKrw')::numeric>=available/1000000);
 if (tier is null and(available/1000000>=(policy.config->>'minimumPrincipalKrw')::numeric
  or inputs->>'retention_bps' is distinct from '0' or inputs->>'tier_code' is not null
  or inputs->>'slots' is distinct from '0' or inputs->>'tier_activated' is distinct from 'false'))
  or(tier is not null and(inputs->>'retention_bps' is distinct from tier->>'retentionBonusBps'
  or inputs->>'tier_code' is distinct from tier->>'code' or inputs->>'slots' is distinct from tier->>'slots'
  or inputs->>'tier_activated' is distinct from 'true')) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_TIER_MISMATCH';end if;
 if preparation.current_allocation_original_id is null then allocation_bps:=0;
 else allocation_bps:=app_private.assert_prospective_allocation(preparation.current_allocation_original_id,preparation.user_id,policy.config,coalesce((tier->>'slots')::integer,0));end if;
 if inputs->>'allocation_id' is distinct from preparation.current_allocation_original_id::text
  or inputs->>'allocation_bps' is distinct from allocation_bps::text
  or inputs->>'allocation_digest' is distinct from(select a.input_digest from app_private.funding_allocation_originals a
   where a.id=preparation.current_allocation_original_id) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_ALLOCATION_MISMATCH';end if;
end;
$$;

create or replace function app_private.assert_input3_condition_snapshot(p_condition uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare condition app_private.funding_condition_originals%rowtype; inputs jsonb; item jsonb;
 movement public.money_source_movements%rowtype; lot public.funding_principal_lots%rowtype;
 revision public.funding_principal_revisions%rowtype; clock app_private.funding_portion_clock_receipts%rowtype;
 portion app_private.funding_principal_portions%rowtype; transition app_private.funding_portion_transitions%rowtype;
 admission app_private.funding_withdrawal_clock_admissions%rowtype;
 last_revision bigint; available numeric:=0; held numeric:=0; recovered numeric:=0; gross numeric:=0; actual_count bigint;
 expected jsonb; policy app_private.economy_policy_published%rowtype; tier jsonb; allocation_bps integer; native_allocation public.funding_principal_recovery_allocations%rowtype;
begin
 select c.* into condition from app_private.funding_condition_originals c where c.id=p_condition;
 perform app_private.assert_funding_slot_condition_receipt(condition.id);
 perform app_private.assert_verified_input3_history_executor(condition.user_id);
 perform app_private.input3_condition_accepted_state(condition.id);
 if condition.cause_principal_boundary_id is not null then
  perform app_private.assert_principal_input_snapshot(condition.cause_principal_boundary_id);return;
 end if;
 if(select c.inputs->>'input_contract_version' from app_private.funding_condition_originals c where c.id=condition.previous_condition_id)='3' then
  perform app_private.assert_input3_condition_snapshot(condition.previous_condition_id);
 end if;
 last_revision:=app_private.input3_snapshot_last_transition(p_condition);inputs:=condition.inputs;
 if inputs->>'user_id' is distinct from condition.user_id::text
  or inputs->>'principal_original_digest' is distinct from app_private.funding_engine_digest(inputs->'credit_originals')
  or inputs->>'recovery_original_digest' is distinct from app_private.funding_engine_digest(inputs->'recovery_originals')
  or inputs->>'portion_clock_original_digest' is distinct from app_private.funding_engine_digest(inputs->'portion_clock_originals') then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_INPUT_MISMATCH';end if;
 for item in select value from jsonb_array_elements(inputs->'credit_originals') loop
  select m.* into movement from public.money_source_movements m where m.id=(item->>'credit_id')::uuid;
  select l.* into lot from public.funding_principal_lots l where l.id=(item->>'lot_id')::uuid;
  select r.* into revision from public.funding_principal_revisions r where r.id=(item->>'principal_revision_id')::uuid;
  if movement.user_id is distinct from condition.user_id or movement.source_bucket is distinct from 'PRINCIPAL'
   or movement.origin_code not in('KRW_DEPOSIT','USDT_KRW_DEPOSIT') or movement.movement_kind is distinct from 'CREDIT'
   or movement.effective_at>condition.effective_at or lot.user_id is distinct from condition.user_id
   or lot.money_source_movement_id is distinct from movement.id or revision.money_source_movement_id is distinct from movement.id
   or revision.user_id is distinct from condition.user_id or revision.lot_id is distinct from lot.id
   or revision.direction is distinct from 'INCREASE' or revision.delta_micro_krw is distinct from lot.amount_micro_krw
   or lot.amount_atomic is distinct from movement.amount_atomic or lot.amount_micro_krw is distinct from app_private.funding_principal_micro_krw(movement.amount_atomic)
   or lot.ledger_transaction_id is distinct from movement.ledger_transaction_id or lot.source_event_id is distinct from movement.source_event_id
   or lot.effective_at is distinct from movement.effective_at or revision.effective_at is distinct from movement.effective_at
   or revision.ledger_transaction_id is distinct from movement.ledger_transaction_id or revision.source_event_id is distinct from movement.source_event_id
   or revision.hold_ledger_transaction_id is not null
   or revision.eligible_principal_micro_krw_after is distinct from app_private.funding_principal_mining_eligible_micro(condition.user_id,movement.effective_at)
   or movement.effective_at<(select introduced_at from app_private.funding_engine_epochs where version=1)
   or item->>'amount_atomic' is distinct from movement.amount_atomic::text
   or item->>'effective_at_microseconds' is distinct from((extract(epoch from movement.effective_at)*1000000)::bigint)::text
   or not exists(select 1 from app_private.funding_portion_transitions t where t.user_id=condition.user_id
    and t.kind='CREDIT' and t.original_id=lot.id and t.revision<=last_revision) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CREDIT_MISMATCH';end if;
  perform app_private.assert_money_source_credit(movement);gross:=gross+lot.amount_micro_krw;
 end loop;
 select count(*) into actual_count from public.funding_principal_lots l join app_private.funding_portion_transitions t
  on t.kind='CREDIT' and t.original_id=l.id where l.user_id=condition.user_id and t.revision<=last_revision;
 if actual_count<>jsonb_array_length(inputs->'credit_originals')
  or actual_count<>(select count(distinct x->>'credit_id') from jsonb_array_elements(inputs->'credit_originals') x) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CREDIT_MISMATCH';end if;
 for item in select value from jsonb_array_elements(inputs->'recovery_originals') loop
  select m.* into movement from public.money_source_movements m where m.id=(item->>'movement_id')::uuid;
  select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=(item->>'clock_admission_id')::uuid;
  if movement.user_id is distinct from condition.user_id or admission.user_id is distinct from condition.user_id
   or movement.effective_at>condition.effective_at or movement.effective_at is distinct from admission.effective_at
   or admission.phase is distinct from(case when movement.origin_code='PRINCIPAL_RECOVERY_HOLD' then 'HOLD' when movement.origin_code='PRINCIPAL_RECOVERY_RELEASE' then 'RELEASE' when movement.origin_code='PRINCIPAL_RECOVERY_FINALIZE' then 'FINALIZE' else null end)
   or movement.ledger_transaction_id is distinct from(select(case when admission.phase='HOLD' then r.hold_ledger_transaction_id when admission.phase='RELEASE' then r.release_ledger_transaction_id else r.finalize_ledger_transaction_id end) from public.withdrawal_requests r where r.id=admission.withdrawal_id)
   or item->>'origin_code' is distinct from movement.origin_code or item->>'ledger_transaction_id' is distinct from movement.ledger_transaction_id::text
   or item->>'source_event_id' is distinct from movement.source_event_id::text or item->>'amount_atomic' is distinct from movement.amount_atomic::text
   or item->>'effective_at_microseconds' is distinct from((extract(epoch from movement.effective_at)*1000000)::bigint)::text
   or item->>'intent_id' is distinct from(select i.id::text from app_private.funding_principal_recovery_intent_originals i
    where i.withdrawal_id=admission.withdrawal_id and i.user_id=condition.user_id) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_RECOVERY_MISMATCH';end if;
  perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
  perform app_private.assert_principal_recovery_movement(movement);
 end loop;
 select count(distinct m.id) into actual_count from public.money_source_movements m
  join app_private.funding_portion_transitions t on t.user_id=m.user_id and t.revision<=last_revision
  left join public.funding_principal_recovery_allocations a on t.kind='HOLD' and a.id=t.original_id
  left join public.funding_principal_recovery_releases r on t.kind='RELEASE' and r.id=t.original_id
  left join public.withdrawal_requests finalized on t.kind='FINALIZE' and finalized.id=t.original_id
  where m.user_id=condition.user_id and
   ((m.origin_code='PRINCIPAL_RECOVERY_HOLD' and m.ledger_transaction_id=a.hold_ledger_transaction_id)
    or(m.origin_code='PRINCIPAL_RECOVERY_RELEASE' and m.ledger_transaction_id=r.release_ledger_transaction_id)
    or(m.origin_code='PRINCIPAL_RECOVERY_FINALIZE' and m.ledger_transaction_id=finalized.finalize_ledger_transaction_id));
 if actual_count<>jsonb_array_length(inputs->'recovery_originals')
  or actual_count<>(select count(distinct x->>'movement_id') from jsonb_array_elements(inputs->'recovery_originals') x) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_RECOVERY_MISMATCH';end if;
 -- Archived DECREASE revisions are independently bound to native HOLD
 -- allocation/source, not inferred from the aggregate JSON or present wallet.
 for native_allocation in select a.* from public.funding_principal_recovery_allocations a
  join app_private.funding_portion_transitions t on t.kind='HOLD' and t.original_id=a.id
  where a.user_id=condition.user_id and t.revision<=last_revision loop
  select r.* into revision from public.funding_principal_revisions r where r.user_id=condition.user_id
   and r.hold_ledger_transaction_id=native_allocation.hold_ledger_transaction_id and r.lot_id=native_allocation.lot_id;
  if native_allocation.policy_code is distinct from 'NEWEST_FIRST' or revision.id is null
   or revision.direction is distinct from 'DECREASE' or revision.money_source_movement_id is not null
   or revision.ledger_transaction_id is distinct from native_allocation.hold_ledger_transaction_id
   or revision.delta_micro_krw is distinct from native_allocation.allocation_micro_krw
   or revision.effective_at is distinct from native_allocation.effective_at
   or revision.source_event_id is distinct from(select m.source_event_id from public.money_source_movements m
    where m.user_id=condition.user_id and m.ledger_transaction_id=native_allocation.hold_ledger_transaction_id and m.origin_code='PRINCIPAL_RECOVERY_HOLD')
   or revision.eligible_principal_micro_krw_after is distinct from app_private.funding_principal_mining_eligible_micro(condition.user_id,native_allocation.effective_at) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_RECOVERY_REVISION_MISMATCH';end if;
 end loop;
 for transition in select t.* from app_private.funding_portion_transitions t
  where t.user_id=condition.user_id and t.revision<=last_revision order by t.revision loop
  perform app_private.verify_input3_history_portion_fact_bounded(transition,p_condition,last_revision);
 end loop;
 for item in select value from jsonb_array_elements(inputs->'portion_clock_originals') loop
  select c.* into clock from app_private.funding_portion_clock_receipts c where c.id=(item->>'clock_id')::uuid;
  select p.* into portion from app_private.funding_principal_portions p where p.id=clock.portion_id;
  select t.* into transition from app_private.funding_portion_transitions t where t.id=clock.transition_id;
  expected:=jsonb_build_object('portion_id',portion.id,'lot_id',portion.lot_id,'parent_portion_id',portion.parent_portion_id,
   'amount_micro_krw',portion.amount_micro_krw::text,'clock_id',clock.id,'clock_revision',clock.revision::text,
   'transition_id',clock.transition_id,'status',clock.status,
   'clock_at_microseconds',((extract(epoch from clock.effective_at)*1000000)::bigint)::text,
   'accumulated_eligible_microseconds',clock.accumulated_eligible_microseconds::text,
   'resumed_at_microseconds',(case when clock.resumed_at is null then null else((extract(epoch from clock.resumed_at)*1000000)::bigint)::text end),
   'hold_allocation_id',clock.hold_allocation_id);
  if portion.user_id is distinct from condition.user_id or clock.user_id is distinct from condition.user_id
   or item is distinct from expected or transition.revision>last_revision
   or exists(select 1 from app_private.funding_portion_clock_receipts next_clock
    join app_private.funding_portion_transitions next_transition on next_transition.id=next_clock.transition_id
    where next_clock.portion_id=portion.id and next_clock.revision>clock.revision and next_transition.revision<=last_revision) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CLOCK_MISMATCH';end if;
  perform app_private.assert_input3_history_clock_original_bounded(clock.id,p_condition,last_revision);
  if clock.status='AVAILABLE' then available:=available+portion.amount_micro_krw;
  elsif clock.status='HELD' then held:=held+portion.amount_micro_krw;
  elsif clock.status='RECOVERED' then recovered:=recovered+portion.amount_micro_krw;
  elsif clock.status<>'SPLIT' then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_STATUS_UNSUPPORTED';end if;
 end loop;
 select count(*) into actual_count from app_private.funding_principal_portions p
  join app_private.funding_portion_transitions t on t.id=p.introduced_by_transition_id
  where p.user_id=condition.user_id and t.revision<=last_revision;
 if actual_count<>jsonb_array_length(inputs->'portion_clock_originals')
  or actual_count<>(select count(distinct x->>'portion_id') from jsonb_array_elements(inputs->'portion_clock_originals') x)
  or available+held+recovered is distinct from gross or available/1000000 is distinct from(inputs->>'principal_atomic')::numeric
  or held/1000000 is distinct from(inputs->>'held_principal_atomic')::numeric
  or recovered/1000000 is distinct from coalesce((inputs->>'recovered_principal_atomic')::numeric,0)
  or recovered is distinct from(select coalesce(sum(m.amount_atomic::numeric*1000000),0) from public.money_source_movements m
    join public.withdrawal_requests r on r.finalize_ledger_transaction_id=m.ledger_transaction_id
    join app_private.funding_portion_transitions t on t.kind='FINALIZE' and t.original_id=r.id
    where m.user_id=condition.user_id and m.origin_code='PRINCIPAL_RECOVERY_FINALIZE' and t.revision<=last_revision) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CONSERVATION_REQUIRED';end if;
 select p.* into policy from app_private.economy_policy_published p where p.publication_id=(inputs->>'policy_publication_id')::uuid;
 if policy.config_digest is distinct from inputs->>'policy_config_digest' or policy.effective_from>condition.effective_at
  or(policy.effective_until is not null and policy.effective_until<=condition.effective_at)
  or inputs->>'base_bps' is distinct from policy.config->>'baseCycleRateBps'
  or inputs->>'cycle_days' is distinct from policy.config->>'cycleDays' then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_POLICY_MISMATCH';end if;
 perform app_private.assert_economy_policy_receipt(policy.revision_id);
 select value into tier from jsonb_array_elements(policy.config->'tiers') where
  (value->>'minimumPrincipalKrw')::numeric<=available/1000000
  and(value->>'maximumPrincipalKrw' is null or(value->>'maximumPrincipalKrw')::numeric>=available/1000000);
 if (tier is null and(available/1000000>=(policy.config->>'minimumPrincipalKrw')::numeric
  or inputs->>'retention_bps' is distinct from '0' or inputs->>'tier_code' is not null
  or inputs->>'slots' is distinct from '0' or inputs->>'tier_activated' is distinct from 'false'))
  or(tier is not null and(inputs->>'retention_bps' is distinct from tier->>'retentionBonusBps'
  or inputs->>'tier_code' is distinct from tier->>'code' or inputs->>'slots' is distinct from tier->>'slots'
  or inputs->>'tier_activated' is distinct from 'true')) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_TIER_MISMATCH';end if;
 if coalesce(condition.current_allocation_original_id,condition.allocation_original_id) is null then allocation_bps:=0;
 else allocation_bps:=app_private.assert_prospective_allocation(coalesce(condition.current_allocation_original_id,condition.allocation_original_id),condition.user_id,policy.config,coalesce((tier->>'slots')::integer,0));end if;
 if inputs->>'allocation_id' is distinct from coalesce(condition.current_allocation_original_id,condition.allocation_original_id)::text
  or inputs->>'allocation_bps' is distinct from allocation_bps::text
  or inputs->>'allocation_digest' is distinct from(select a.input_digest from app_private.funding_allocation_originals a
   where a.id=coalesce(condition.current_allocation_original_id,condition.allocation_original_id)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_ALLOCATION_MISMATCH';end if;
end;
$$;

create or replace function app_private.finish_principal_runtime_boundary(p_admission uuid) returns void
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare preparation app_private.funding_principal_boundary_preparations%rowtype;
 completion app_private.funding_principal_boundary_completions%rowtype;
 admission app_private.funding_withdrawal_clock_admissions%rowtype;
 previous app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype;
 earned app_private.funding_earned_receipts%rowtype;movement public.money_source_movements%rowtype;
 inputs jsonb; caps numeric[]; next_condition uuid; reason_code text;
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_PRINCIPAL_COMPLETION_SERVICE_REQUIRED';end if;
 select b.* into preparation from app_private.funding_principal_boundary_preparations b where b.clock_admission_id=p_admission;
 if preparation.id is null then return;end if; -- generic/history with no cause
 if auth.role() is distinct from 'service_role' and exists(select 1 from app_private.funding_principal_boundary_completions c where c.boundary_id=preparation.id) then
  perform app_private.assert_funding_withdrawal_clock_completion(p_admission);return;end if;
 if exists(select 1 from app_private.funding_principal_boundary_completions c where c.boundary_id=preparation.id) then
  perform app_private.assert_principal_history_executor(preparation.user_id);
  perform app_private.assert_principal_boundary_complete(preparation.id);return;end if;
 perform app_private.assert_principal_input_executor(preparation.user_id);
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||preparation.user_id::text,0));
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=p_admission;
 perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
 select m.* into movement from public.money_source_movements m join public.withdrawal_requests r on r.id=admission.withdrawal_id
  where m.user_id=preparation.user_id and m.ledger_transaction_id=(case when admission.phase='HOLD' then r.hold_ledger_transaction_id when admission.phase='RELEASE' then r.release_ledger_transaction_id else r.finalize_ledger_transaction_id end)
   and m.origin_code=(case when admission.phase='HOLD' then 'PRINCIPAL_RECOVERY_HOLD' when admission.phase='RELEASE' then 'PRINCIPAL_RECOVERY_RELEASE' else 'PRINCIPAL_RECOVERY_FINALIZE' end);
 if movement.id is null then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_NATIVE_SOURCE_REQUIRED';end if;
 select s.* into previous from app_private.funding_engine_state s where s.user_id=preparation.user_id;
 if previous.id is distinct from preparation.previous_state_id then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_COMPLETION_STATE_STALE';end if;
 select e.* into earned from app_private.funding_earned_receipts e where e.cause_principal_boundary_id=preparation.id;
 reason_code:=preparation.unresolved_reason_code;
 if preparation.settlement_expected then
  if earned.id is null then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_OLD_EARNING_REQUIRED';end if;
  caps:=app_private.funding_state_effective_capacities(previous.id);
  begin
   inputs:=app_private.read_principal_portion_funding_inputs(preparation.user_id,preparation.current_allocation_original_id,admission.effective_at);
   perform app_private.assert_funding_slot_recovery_policy(previous.condition_id,preparation.current_allocation_original_id,(inputs->>'slots')::integer);
   caps:=app_private.principal_boundary_expected_capacities(preparation.id,inputs);
  exception when sqlstate '55000' then
   reason_code:=sqlerrm;
   if reason_code !~ '^[A-Z][A-Z0-9_]{2,95}$' then raise;end if;
   caps:=app_private.funding_state_effective_capacities(previous.id);
  end;
  next_condition:=previous.condition_id;
  if reason_code is null then
   select c.* into condition from app_private.funding_condition_originals c where c.id=previous.condition_id;
   condition.id:=gen_random_uuid();condition.previous_condition_id:=previous.condition_id;condition.revision:=condition.revision+1;
   condition.allocation_original_id:=null;condition.cause_credit_boundary_id:=null;condition.cause_principal_boundary_id:=preparation.id;
   condition.current_allocation_original_id:=preparation.current_allocation_original_id;
   condition.effective_at:=admission.effective_at;condition.recorded_at:=admission.effective_at;condition.inputs:=inputs;
   condition.audit_id:=gen_random_uuid();condition.source_event_id:=gen_random_uuid();
   condition.input_digest:=app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition));
   insert into app_private.funding_condition_originals select condition.*;
   perform app_private.write_principal_boundary_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,
    condition.input_digest,condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition),admission.id);
   next_condition:=condition.id;
  end if;
  insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den,recorded_at)
   values(earned.next_state_id,preparation.user_id,caps[1],caps[2],caps[3],caps[4],admission.effective_at);
  insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,earned_receipt_id,
   cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id,recorded_at)
  values(earned.next_state_id,previous.user_id,previous.activation_id,previous.cycle_id,previous.revision+1,previous.id,earned.id,
   admission.effective_at,(earned.calculation->>'baseUsedNum')::numeric,(earned.calculation->>'baseUsedDen')::numeric,
   (earned.calculation->>'retentionUsedNum')::numeric,(earned.calculation->>'retentionUsedDen')::numeric,
   (earned.calculation->>'carryNum')::numeric,(earned.calculation->>'carryDen')::numeric,next_condition,admission.effective_at);
  completion.accepted_state_id:=earned.next_state_id;
 else completion.accepted_state_id:=previous.id;
 end if;
 completion.id:=gen_random_uuid();completion.boundary_id:=preparation.id;completion.user_id:=preparation.user_id;
 completion.source_movement_id:=movement.id;completion.condition_id:=condition.id;
 completion.runtime_outcome:=(case when reason_code is null then 'ACCEPTED' else 'UNRESOLVED' end);
 completion.reason_code:=reason_code;completion.input_original:=coalesce(inputs,jsonb_build_object('input_contract_version',3,
  'user_id',preparation.user_id,'runtime_input_unresolved',true));
 completion.effective_at:=admission.effective_at;completion.recorded_at:=admission.effective_at;
 completion.audit_id:=gen_random_uuid();completion.source_event_id:=gen_random_uuid();
 completion.input_digest:=app_private.funding_engine_digest(app_private.funding_principal_completion_snapshot(completion));
 insert into app_private.funding_principal_boundary_completions select completion.*;
 perform app_private.write_principal_boundary_seal(completion.id,'FUNDING_PRINCIPAL_BOUNDARY_COMPLETED',completion.user_id,
  completion.input_digest,completion.audit_id,completion.source_event_id,app_private.funding_principal_completion_snapshot(completion),admission.id);
end;
$$;

create or replace function app_private.finish_input3_credit_funding_boundary(p_boundary uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_credit_boundary_preparations%rowtype;
 completion app_private.funding_credit_boundary_completions%rowtype;source public.money_source_movements%rowtype;
 state app_private.funding_engine_state_receipts%rowtype;condition app_private.funding_condition_originals%rowtype;
 cycle app_private.funding_cycle_windows%rowtype;earned app_private.funding_earned_receipts%rowtype;
 caps numeric[];old_base numeric[];old_retention numeric[];next_base numeric[];next_retention numeric[];
 inputs jsonb;message text;lot_id uuid;span bigint;remaining bigint;
begin
 perform app_private.assert_credit_boundary_executor();
 select b.* into preparation from app_private.funding_credit_boundary_preparations b where b.id=p_boundary;
 source:=app_private.read_credit_boundary_source(p_boundary);
 select s.* into state from app_private.funding_engine_state_receipts s where s.id=preparation.previous_state_id;
 select c.* into condition from app_private.funding_condition_originals c where c.id=state.condition_id;
 select c.* into cycle from app_private.funding_cycle_windows c where c.id=state.cycle_id;
 select e.* into earned from app_private.funding_earned_receipts e where e.cause_credit_boundary_id=preparation.id;
 if not preparation.settlement_expected or condition.inputs->>'input_contract_version' is distinct from '3'
  or state.user_id is distinct from preparation.user_id or earned.id is null
  or earned.previous_state_id is distinct from state.id then
  raise exception using errcode='55000',message='FUNDING_INPUT3_CREDIT_OLD_INTERVAL_REQUIRED';end if;
 -- Genuine new credit root clocks are initialized before the fresh input3
 -- snapshot and successor cursor. No earlier root/age is rebuilt or rewritten.
 for lot_id in select l.id from public.funding_principal_lots l where l.user_id=preparation.user_id
  and l.money_source_movement_id=source.id
  and not exists(select 1 from app_private.funding_principal_portions p where p.lot_id=l.id and p.parent_portion_id is null)
  order by l.effective_at,l.recorded_at,l.id loop
  perform app_private.initialize_funding_portion_clock(lot_id);
 end loop;
 completion.id:=gen_random_uuid();completion.boundary_id:=preparation.id;completion.user_id:=preparation.user_id;
 completion.credit_movement_id:=source.id;completion.activation_id:=state.activation_id;
 completion.accepted_state_id:=earned.next_state_id;completion.reason_code:=preparation.unresolved_reason_code;
 caps:=app_private.funding_state_effective_capacities(state.id);
 next_base:=array[caps[1],caps[2]];next_retention:=array[caps[3],caps[4]];
 if completion.reason_code is null then
  begin
   inputs:=app_private.read_verified_input3_funding_inputs(preparation.user_id,preparation.current_allocation_original_id,preparation.effective_at);
   perform app_private.assert_funding_slot_recovery_policy(state.condition_id,preparation.current_allocation_original_id,(inputs->>'slots')::integer);
   span:=(extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint;
   remaining:=(extract(epoch from cycle.cycle_end-preparation.effective_at)*1000000)::bigint;
   if inputs->>'tier_activated' is distinct from 'true' or remaining<=0 or state.cycle_closed then
    raise exception using errcode='55000',message='FUNDING_INPUT3_CREDIT_FIRST_CYCLE_REQUIRED';end if;
   old_base:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'base_bps')::numeric,10000);
   old_retention:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'retention_bps')::numeric,10000);
   next_base:=app_private.funding_exact_forward_capacity(caps[1],caps[2],old_base[1],old_base[2],
    (inputs->>'principal_atomic')::numeric*(inputs->>'base_bps')::numeric,10000,remaining,span);
   next_retention:=app_private.funding_exact_forward_capacity(caps[3],caps[4],old_retention[1],old_retention[2],
    (inputs->>'principal_atomic')::numeric*(inputs->>'retention_bps')::numeric,10000,remaining,span);
   if next_base[1]*(earned.calculation->>'baseUsedDen')::numeric<
      (earned.calculation->>'baseUsedNum')::numeric*next_base[2]
    or next_retention[1]*(earned.calculation->>'retentionUsedDen')::numeric<
      (earned.calculation->>'retentionUsedNum')::numeric*next_retention[2] then
    raise exception using errcode='55000',message='FUNDING_INPUT3_CREDIT_CAPACITY_BELOW_USED';end if;
  exception when sqlstate '55000' or sqlstate '42501' then
   get stacked diagnostics message=message_text;
   completion.reason_code:=case when message ~ '^[A-Z][A-Z0-9_]{2,95}$' then message else 'FUNDING_INPUT_ORIGINAL_UNRESOLVED' end;
   next_base:=array[caps[1],caps[2]];next_retention:=array[caps[3],caps[4]];
  end;
 end if;
 completion.input_original:=coalesce(inputs,jsonb_build_object('input_contract_version',3,'user_id',preparation.user_id,
  'credit_id',source.id,'runtime_input_unresolved',true));
 if completion.reason_code is null then
  condition.id:=gen_random_uuid();condition.revision:=condition.revision+1;condition.previous_condition_id:=state.condition_id;
  condition.cause_principal_boundary_id:=null;condition.allocation_original_id:=null;condition.cause_credit_boundary_id:=preparation.id;
  condition.current_allocation_original_id:=preparation.current_allocation_original_id;condition.effective_at:=preparation.effective_at;
  condition.inputs:=inputs;condition.audit_id:=gen_random_uuid();condition.source_event_id:=gen_random_uuid();condition.recorded_at:=clock_timestamp();
  condition.input_digest:=app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition));
  insert into app_private.funding_condition_originals select condition.*;
  perform app_private.write_credit_boundary_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,condition.input_digest,
   condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition),preparation.effective_at);
  completion.condition_id:=condition.id;completion.runtime_outcome:='ACCEPTED';
 else completion.condition_id:=state.condition_id;completion.runtime_outcome:='UNRESOLVED';end if;
 insert into app_private.funding_effective_capacity_receipts(state_id,user_id,base_capacity_num,base_capacity_den,retention_capacity_num,retention_capacity_den)
 values(earned.next_state_id,preparation.user_id,next_base[1],next_base[2],next_retention[1],next_retention[2]);
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
  earned_receipt_id,cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,condition_id)
 values(earned.next_state_id,preparation.user_id,state.activation_id,state.cycle_id,state.revision+1,state.id,earned.id,preparation.effective_at,
  (earned.calculation->>'baseUsedNum')::numeric,(earned.calculation->>'baseUsedDen')::numeric,
  (earned.calculation->>'retentionUsedNum')::numeric,(earned.calculation->>'retentionUsedDen')::numeric,
  (earned.calculation->>'carryNum')::numeric,(earned.calculation->>'carryDen')::numeric,completion.condition_id);
 completion.audit_id:=gen_random_uuid();completion.source_event_id:=gen_random_uuid();completion.recorded_at:=clock_timestamp();
 completion.input_digest:=app_private.funding_engine_digest(app_private.funding_credit_completion_snapshot(completion));
 insert into app_private.funding_credit_boundary_completions select completion.*;
 perform app_private.write_credit_boundary_seal(completion.id,'FUNDING_CREDIT_BOUNDARY_COMPLETED',completion.user_id,
  completion.input_digest,completion.audit_id,completion.source_event_id,app_private.funding_credit_completion_snapshot(completion),preparation.effective_at);
end;
$$;

create or replace function app_private.read_forward_funding_runtime_display(p_user uuid,p_at timestamptz) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; condition app_private.funding_condition_originals%rowtype;
 inputs jsonb; calculation jsonb; capacities numeric[]; capacity numeric[]; used numeric[]; remaining numeric[];
 maintenance numeric[]; pending numeric[]; speed numeric[]; committed numeric; runtime_status text; stop_reason text; global_control jsonb;
begin
 select * into activation from app_private.funding_engine_activations where user_id=p_user;
 select * into state from app_private.funding_engine_state where user_id=p_user;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 inputs:=app_private.read_forward_neutral_job_inputs(activation.id,state.id,p_at);
 calculation:=app_private.calculate_credit_boundary_interval(state.id,p_at);
 capacities:=app_private.funding_state_effective_capacities(state.id);
 capacity:=app_private.funding_exact_sum(array[capacities[1],capacities[2]],array[capacities[3],capacities[4]]);
 used:=app_private.funding_exact_sum(array[(calculation->>'baseUsedNum')::numeric,(calculation->>'baseUsedDen')::numeric],
 array[(calculation->>'retentionUsedNum')::numeric,(calculation->>'retentionUsedDen')::numeric]);
 remaining:=app_private.funding_exact_ratio(greatest(0,capacity[1]*used[2]-used[1]*capacity[2]),capacity[2]*used[2]);
 maintenance:=array[(calculation->>'retentionUsedNum')::numeric,(calculation->>'retentionUsedDen')::numeric];
 pending:=app_private.funding_exact_sum(array[state.carry_num,state.carry_den],array[(calculation->>'baseNum')::numeric,(calculation->>'baseDen')::numeric]);
 speed:=app_private.funding_exact_ratio((inputs->>'allocation_bps')::numeric,10000);
 global_control:=app_private.funding_global_eligible_interval(p_at,p_at);
 if global_control->>'paused_at_end'='true' then runtime_status:='STOPPED'; stop_reason:='SAFE_MODE';
 elsif inputs->>'tier_activated'='false' then runtime_status:='STOPPED';stop_reason:='FUNDING_BELOW_MINIMUM';
 elsif (inputs->>'allocation_bps')::integer=0 then runtime_status:='STOPPED'; stop_reason:='NO_ACTIVE_ALLOCATION';
 elsif (calculation->>'baseUsedNum')::numeric*capacities[2]>=capacities[1]*(calculation->>'baseUsedDen')::numeric then
  runtime_status:='STOPPED'; stop_reason:='CAPACITY_USED';
 else runtime_status:='ACTIVE'; end if;
 select coalesce(sum(amount_atomic),0) into committed from app_private.funding_earned_receipts where activation_id=activation.id;
 return jsonb_build_object('available',true,'eligible_principal_micro_krw',((inputs->>'principal_atomic')::numeric*1000000)::text,
 'tier_code',inputs->>'tier_code','tier_activated',coalesce((inputs->>'tier_activated')::boolean,true),
 'cycle_started_at',to_char(cycle.cycle_started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'cycle_end',to_char(cycle.cycle_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'effective_capacity_micro_krw',div(capacity[1]*1000000,capacity[2])::text,
 'remaining_capacity_micro_krw',div(remaining[1]*1000000,remaining[2])::text,
 'used_capacity_micro_krw',div(used[1]*1000000,used[2])::text,'speed_multiplier_bps','10000',
 'pending_micro_krw',div(pending[1]*1000000,pending[2])::text,
 'retention_unconfirmed_micro_krw',div(maintenance[1]*1000000,maintenance[2])::text,
 'funded_runtime',jsonb_build_object('schema_version',2,'runtime_version',2,'state_revision',state.revision::text,
 'condition_revision',condition.revision::text,
 'accepted_cursor_at',to_char(state.cursor_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'evaluated_at',to_char(p_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'allocation_bps',inputs->>'allocation_bps','status',runtime_status,'stop_reason',stop_reason,
 'speed',jsonb_build_object('product_multiplier_bps','10000','user_multiplier_bps','10000',
 'common_multiplier',jsonb_build_object('numerator','1','denominator','1'),
 'effective_global_multiplier',jsonb_build_object('numerator',speed[1]::text,'denominator',speed[2]::text)),
 'committed_reward_total_atomic',committed::text,
 'reward_carry',jsonb_build_object('numerator',state.carry_num::text,'denominator',state.carry_den::text,'unit','KRW'),
 'conditional_maintenance',jsonb_build_object('numerator',maintenance[1]::text,'denominator',maintenance[2]::text,'unit','KRW','qualification','UNCONFIRMED')));
end;
$$;

commit;
