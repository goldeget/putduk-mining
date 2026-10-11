begin;

-- Outside-only candidate. Existing seven-argument preparation and the four-
-- argument ordinary withdrawal commands remain mining-only. No money is posted
-- by this signed-member confirmation producer.
alter table public.withdrawal_logical_requests drop constraint withdrawal_logical_requests_schema_version_check;
alter table public.withdrawal_logical_requests add constraint withdrawal_logical_requests_schema_version_check
 check(schema_version in(2,3));
alter table public.withdrawal_logical_requests add constraint withdrawal_logical_requests_key_owner_unique
 unique(idempotency_key,user_id);

create table app_private.withdrawal_principal_confirmation_originals(
 id uuid primary key default gen_random_uuid(),version integer not null check(version=1),
 user_id uuid not null references auth.users(id),logical_key text not null unique,
 method text not null check(method in('KRW_BANK','USDT_ADDRESS')),
 amount_atomic bigint not null check(amount_atomic>0),policy_id uuid not null references public.withdrawal_policies(id),
 policy_version integer not null check(policy_version>0),destination_id uuid not null references public.withdrawal_destinations(id),
 destination_fingerprint text not null check(destination_fingerprint ~ '^[a-f0-9]{64}$'),
 current_condition_id uuid not null,current_allocation_original_id uuid,portion_transition_id uuid not null,
 principal_atomic bigint not null check(principal_atomic>=amount_atomic),
 confirmed_at timestamptz not null check(isfinite(confirmed_at)),request_id uuid not null,
 confirmation jsonb not null check(confirmation='{"version":1,"source":"PRINCIPAL","confirmed":true}'::jsonb),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),unique(id,user_id),
 foreign key(logical_key,user_id) references public.withdrawal_logical_requests(idempotency_key,user_id),
 foreign key(current_condition_id,user_id) references app_private.funding_condition_originals(id,user_id),
 foreign key(current_allocation_original_id,user_id) references app_private.funding_allocation_originals(id,user_id),
 foreign key(portion_transition_id,user_id) references app_private.funding_portion_transitions(id,user_id)
);
alter table app_private.withdrawal_principal_confirmation_originals enable row level security;
alter table app_private.withdrawal_principal_confirmation_originals force row level security;
revoke all on app_private.withdrawal_principal_confirmation_originals from public,anon,authenticated,service_role;
grant select on app_private.withdrawal_principal_confirmation_originals to service_role;
create trigger withdrawal_principal_confirmations_append_only before update or delete
 on app_private.withdrawal_principal_confirmation_originals for each row execute function app_private.prevent_row_mutation();

create function app_private.withdrawal_principal_confirmation_snapshot(p app_private.withdrawal_principal_confirmation_originals)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('version',p.version,'user_id',p.user_id,'logical_key',p.logical_key,
 'method',p.method,'amount_atomic',p.amount_atomic::text,'policy_id',p.policy_id,'policy_version',p.policy_version,
 'destination_id',p.destination_id,'destination_fingerprint',p.destination_fingerprint,
 'current_condition_id',p.current_condition_id,'current_allocation_original_id',p.current_allocation_original_id,
 'portion_transition_id',p.portion_transition_id,'principal_atomic',p.principal_atomic::text,
 'confirmed_at_microseconds',((extract(epoch from p.confirmed_at)*1000000)::bigint)::text,
 'request_id',p.request_id,'confirmation',p.confirmation,'authenticated_subject',p.user_id);
$$;

create function app_private.assert_withdrawal_principal_confirmation(p_id uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.withdrawal_principal_confirmation_originals%rowtype;
 logical public.withdrawal_logical_requests%rowtype;
begin
 select o.* into original from app_private.withdrawal_principal_confirmation_originals o where o.id=p_id;
 select l.* into logical from public.withdrawal_logical_requests l where l.idempotency_key=original.logical_key;
 if original.id is null or logical.schema_version is distinct from 3
  or row(logical.user_id,logical.method,logical.amount_krw,logical.policy_id,logical.policy_version,
    logical.destination_id,logical.destination_fingerprint,logical.created_at)
   is distinct from row(original.user_id,original.method,original.amount_atomic,original.policy_id,original.policy_version,
    original.destination_id,original.destination_fingerprint,original.confirmed_at)
  or original.confirmation is distinct from '{"version":1,"source":"PRINCIPAL","confirmed":true}'::jsonb
  or original.input_digest is distinct from app_private.funding_engine_digest(app_private.withdrawal_principal_confirmation_snapshot(original))
  or original.confirmed_at>clock_timestamp() then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_CONFIRMATION_ORIGINAL_REQUIRED';end if;
 if not exists(select 1 from app_private.funding_condition_originals c where c.id=original.current_condition_id
   and c.user_id=original.user_id and(c.inputs->>'principal_atomic')::numeric=original.principal_atomic::numeric
   and coalesce(c.current_allocation_original_id,c.allocation_original_id) is not distinct from original.current_allocation_original_id)
  or not exists(select 1 from app_private.funding_portion_transitions t where t.id=original.portion_transition_id
   and t.user_id=original.user_id and t.effective_at<=original.confirmed_at) then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_CONFIRMATION_ORIGINAL_REQUIRED';end if;
 perform app_private.assert_funding_engine_seal(original.id,'WITHDRAWAL_PRINCIPAL_CONFIRMED',original.user_id,
  original.input_digest,original.audit_id,original.source_event_id,app_private.withdrawal_principal_confirmation_snapshot(original));
 if not exists(select 1 from public.audit_logs a where a.id=original.audit_id and a.request_id=original.request_id
   and a.created_at=original.confirmed_at)
  or not exists(select 1 from public.outbox_events e where e.id=original.source_event_id
   and e.request_id=original.request_id and e.correlation_id=original.request_id
   and e.occurred_at=original.confirmed_at and e.created_at=original.confirmed_at) then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_CONFIRMATION_ORIGINAL_REQUIRED';end if;
end;
$$;

-- Source version is explicit. Historical v2 records retain their exact shape.
create or replace function app_private.withdrawal_logical_record(p_record public.withdrawal_logical_requests)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare result jsonb; original app_private.withdrawal_principal_confirmation_originals%rowtype;
begin
 result:=jsonb_build_object('v',p_record.schema_version,'ownerId',p_record.user_id,
  'key',p_record.idempotency_key,'method',p_record.method,'amountKrw',p_record.amount_krw::text,
  'policyId',p_record.policy_id,'policyVersion',p_record.policy_version,
  'destinationIdentity',p_record.destination_fingerprint,'destinationId',p_record.destination_id,
  'withdrawalId',p_record.withdrawal_id,'state',p_record.state,'createdAt',p_record.created_at,
  'updatedAt',p_record.updated_at,'expiresAt',p_record.expires_at);
 if p_record.schema_version=3 then
  select o.* into original from app_private.withdrawal_principal_confirmation_originals o where o.logical_key=p_record.idempotency_key;
  if original.id is null then raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_CONFIRMATION_ORIGINAL_REQUIRED';end if;
  result:=result||jsonb_build_object('source',jsonb_build_object('version',1,'kind','PRINCIPAL','confirmationId',original.id),
   'createdAt',to_char(p_record.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'updatedAt',to_char(p_record.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'expiresAt',to_char(p_record.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 end if;
 return result;
end;
$$;

-- Mandatory eighth argument keeps PostgREST resolution unambiguous. Never grant
-- this member producer to service_role; a server key is not member consent.
create function public.prepare_withdrawal_logical_request(
 p_user_id uuid,p_method text,p_amount_krw bigint,p_policy_id uuid,p_policy_version integer,
 p_destination_fingerprint text,p_destination_id uuid,p_confirmation jsonb
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare owner_id uuid:=auth.uid();logical public.withdrawal_logical_requests%rowtype;
 original app_private.withdrawal_principal_confirmation_originals%rowtype;
 destination public.withdrawal_destinations%rowtype;policy public.withdrawal_policies%rowtype;
 now_at timestamptz;wallet_id uuid;snapshot jsonb;state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype;cycle app_private.funding_cycle_windows%rowtype;
begin
 if current_setting('role',true) is distinct from 'authenticated' or auth.role() is distinct from 'authenticated'
  or owner_id is null or p_user_id is distinct from owner_id then
  raise exception using errcode='42501',message='WITHDRAWAL_PRINCIPAL_MEMBER_AUTH_REQUIRED';end if;
 if p_confirmation is distinct from '{"version":1,"source":"PRINCIPAL","confirmed":true}'::jsonb
  or p_method is null or p_method not in('KRW_BANK','USDT_ADDRESS') or p_amount_krw is null or p_amount_krw<=0
  or p_policy_id is null or p_policy_version is null or p_policy_version<=0
  or p_destination_id is null or p_destination_fingerprint is not null then
  raise exception using errcode='22023',message='WITHDRAWAL_PRINCIPAL_EXPLICIT_CONFIRMATION_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||owner_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('withdrawal-logical:'||owner_id::text,0));
 select l.* into logical from public.withdrawal_logical_requests l where l.user_id=owner_id
  and l.state in('PREPARED','DESTINATION_REGISTERED','OUTCOME_UNCERTAIN') for update;
 if logical.idempotency_key is not null then
  select o.* into original from app_private.withdrawal_principal_confirmation_originals o where o.logical_key=logical.idempotency_key;
  if logical.schema_version is distinct from 3 or original.id is null
   or row(logical.method,logical.amount_krw,logical.policy_id,logical.policy_version,logical.destination_id)
    is distinct from row(p_method,p_amount_krw,p_policy_id,p_policy_version,p_destination_id) then
   raise exception using errcode='55000',message='WITHDRAWAL_LOGICAL_PENDING';end if;
  perform app_private.assert_withdrawal_principal_confirmation(original.id);
  return app_private.withdrawal_logical_record(logical);
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='WITHDRAWAL_PRINCIPAL_FRESH_SNAPSHOT_REQUIRED';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:WITHDRAWAL',0));
 select d.* into destination from public.withdrawal_destinations d where d.id=p_destination_id and d.user_id=owner_id
  and d.destination_type=p_method and d.verification_status='VERIFIED' and d.replaced_at is null for update;
 select w.id into wallet_id from public.wallet_accounts w where w.user_id=owner_id and w.currency='KRW' and w.closed_at is null for update;
 perform app_private.touch_command_rate_limit('PREPARE_WITHDRAWAL_LOGICAL_REQUEST',owner_id::text,60,3600,3600);
 -- Consent time is not the later financial effective time. All admissions and
 -- row waits precede this sole confirmation clock;130 owns financial time.
 now_at:=clock_timestamp();
 if exists(select 1 from public.safe_mode_controls c where c.component in('GLOBAL','WITHDRAWAL')
  and c.is_paused and c.starts_at<=now_at) then raise exception using errcode='55000',message='SAFE_MODE_ACTIVE';end if;
 if destination.id is null or destination.protection_until>now_at then
  raise exception using errcode='55000',message='VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED';end if;
 if wallet_id is null then raise exception using errcode='55000',message='KRW_WALLET_NOT_FOUND';end if;
 select p.* into policy from public.withdrawal_policies p where p.currency='KRW' and p.destination_type=p_method
  and p.is_enabled and p.effective_at<=now_at and(p.expires_at is null or p.expires_at>now_at) order by p.version desc limit 1;
 if policy.id is distinct from p_policy_id or policy.version is distinct from p_policy_version then
  raise exception using errcode='55000',message='WITHDRAWAL_LOGICAL_POLICY_CHANGED';end if;
 if policy.fee_atomic<>0 then raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_FEE_POLICY_UNSUPPORTED';end if;
 if p_amount_krw<policy.minimum_amount_atomic then raise exception using errcode='22003',message='WITHDRAWAL_BELOW_MINIMUM';end if;
 if (select coverage from public.money_source_summaries where user_id=owner_id) is distinct from 'COMPLETE' then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_SOURCE_REQUIRED';end if;
 if p_amount_krw>(select eligible_principal_atomic::numeric from public.money_source_summaries where user_id=owner_id)
  or p_amount_krw>app_private.available_krw_balance(wallet_id) then
  raise exception using errcode='22003',message='INSUFFICIENT_AVAILABLE_BALANCE';end if;
 -- Bind the member's confirmed source/entitlement revision without posting or
 -- creating a preview. A changed condition/allocation/portion before execution
 -- requires explicit reconciliation and new consent, never silent rescaling.
 select s.* into state from app_private.funding_engine_state s where s.user_id=owner_id;
 select c.* into condition from app_private.funding_condition_originals c where c.id=state.condition_id;
 select w.* into cycle from app_private.funding_cycle_windows w where w.id=state.cycle_id;
 if condition.id is null or state.cycle_closed or cycle.id is null or now_at>=cycle.cycle_end or state.cursor_at>now_at
  or not exists(select 1 from app_private.funding_engine_activations a where a.id=state.activation_id
   and a.user_id=owner_id and a.runtime_version=2)
  or coalesce(condition.inputs->>'input_contract_version','') not in('2','3')
  or condition.user_id is distinct from owner_id
  or (condition.inputs->>'principal_atomic')::numeric is distinct from
    (select eligible_principal_atomic::numeric from public.money_source_summaries where user_id=owner_id) then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_CURRENT_CONDITION_REQUIRED';end if;
 original.current_condition_id:=condition.id;
 original.current_allocation_original_id:=coalesce(condition.current_allocation_original_id,condition.allocation_original_id);
 select t.id into original.portion_transition_id from app_private.funding_portion_transitions t
  where t.user_id=owner_id order by t.revision desc limit 1;
 if original.portion_transition_id is null then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_CURRENT_CONDITION_REQUIRED';end if;
 original.principal_atomic:=(condition.inputs->>'principal_atomic')::bigint;
 insert into public.withdrawal_logical_requests(schema_version,user_id,method,amount_krw,policy_id,policy_version,
  destination_fingerprint,destination_id,state,created_at,updated_at,expires_at)
 values(3,owner_id,p_method,p_amount_krw,policy.id,policy.version,destination.value_fingerprint,destination.id,
  'DESTINATION_REGISTERED',now_at,now_at,now_at+interval '24 hours') returning * into logical;
 original.id:=gen_random_uuid();original.version:=1;original.user_id:=owner_id;original.logical_key:=logical.idempotency_key;
 original.method:=p_method;original.amount_atomic:=p_amount_krw;original.policy_id:=policy.id;original.policy_version:=policy.version;
 original.destination_id:=destination.id;original.destination_fingerprint:=destination.value_fingerprint;
 original.confirmed_at:=now_at;original.request_id:=gen_random_uuid();original.confirmation:=p_confirmation;
 original.audit_id:=gen_random_uuid();original.source_event_id:=gen_random_uuid();
 snapshot:=app_private.withdrawal_principal_confirmation_snapshot(original);original.input_digest:=app_private.funding_engine_digest(snapshot);
 insert into app_private.withdrawal_principal_confirmation_originals select original.*;
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(original.audit_id,owner_id,'WITHDRAWAL_PRINCIPAL_CONFIRMED','FUNDING_ENGINE_V1',original.id::text,
  'member explicitly confirmed principal recovery; held eligible age pauses without reset or retroactive accrual',
  original.request_id,snapshot,jsonb_build_object('input_digest',original.input_digest,'command_version',3),now_at);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
  correlation_id,request_id,idempotency_key,occurred_at,created_at,available_at,last_error_code)
 values(original.source_event_id,'WITHDRAWAL_PRINCIPAL_CONFIRMED.v1',1,'funding_engine_v1',original.id,owner_id,
  jsonb_build_object('user_id',owner_id,'audit_id',original.audit_id,'input_digest',original.input_digest),
  original.request_id,original.request_id,'funding:'||original.id::text||':seal',now_at,now_at,'infinity','MEMBER_PRINCIPAL_CONFIRMATION_ONLY');
 return app_private.withdrawal_logical_record(logical);
end;
$$;
alter function public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb) owner to postgres;
revoke all on function public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb) to authenticated;
revoke all on function app_private.withdrawal_principal_confirmation_snapshot(app_private.withdrawal_principal_confirmation_originals),
 app_private.assert_withdrawal_principal_confirmation(uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.withdrawal_principal_confirmation_snapshot(app_private.withdrawal_principal_confirmation_originals),
 app_private.assert_withdrawal_principal_confirmation(uuid) to service_role;

commit;
