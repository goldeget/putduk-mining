begin;

-- Cash is backed only by the existing, fully verified operator deposit
-- receipts. Practice-point tables never participate in this ledger.
create table app_private.workroom_cash_intents (
  logical_key text primary key references public.withdrawal_logical_requests(idempotency_key),
  user_id uuid not null references auth.users(id),
  method text not null check(method in('KRW_BANK','USDT_ADDRESS')),
  amount_atomic bigint not null check(amount_atomic>0),
  policy_id uuid not null references public.withdrawal_policies(id),
  policy_version integer not null check(policy_version>0),
  destination_fingerprint text not null check(destination_fingerprint~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
create table app_private.workroom_cash_withdrawals (
  withdrawal_id uuid primary key references public.withdrawal_requests(id),
  logical_key text not null unique references app_private.workroom_cash_intents(logical_key),
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index workroom_cash_intents_owner on app_private.workroom_cash_intents(user_id);
create index workroom_cash_withdrawals_owner on app_private.workroom_cash_withdrawals(user_id);
create table app_private.workroom_cash_reservations (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references app_private.workroom_cash_withdrawals(withdrawal_id),
  user_id uuid not null references auth.users(id),
  credit_movement_id uuid not null,
  hold_ledger_transaction_id uuid not null references public.ledger_transactions(id),
  amount_atomic bigint not null check(amount_atomic>0),
  ordinal integer not null check(ordinal>=0),
  effective_at timestamptz not null,
  foreign key(credit_movement_id,user_id) references public.money_source_movements(id,user_id),
  unique(withdrawal_id,credit_movement_id),unique(withdrawal_id,ordinal)
);
create index workroom_cash_reservations_credit on app_private.workroom_cash_reservations(credit_movement_id);
create index workroom_cash_reservations_owner on app_private.workroom_cash_reservations(user_id);
create table app_private.workroom_cash_dispositions (
  withdrawal_id uuid primary key references app_private.workroom_cash_withdrawals(withdrawal_id),
  user_id uuid not null references auth.users(id),
  phase text not null check(phase in('RELEASE','FINALIZE')),
  terminal_ledger_transaction_id uuid not null unique references public.ledger_transactions(id),
  wallet_ledger_id uuid unique references public.wallet_ledger(id),
  amount_atomic bigint not null check(amount_atomic>0),
  effective_at timestamptz not null,
  check((phase='RELEASE' and wallet_ledger_id is null) or (phase='FINALIZE' and wallet_ledger_id is not null))
);
create index workroom_cash_dispositions_owner on app_private.workroom_cash_dispositions(user_id);

do $$declare n text;begin
 foreach n in array array['workroom_cash_intents','workroom_cash_withdrawals','workroom_cash_reservations','workroom_cash_dispositions'] loop
  execute format('alter table app_private.%I enable row level security',n);
  execute format('alter table app_private.%I force row level security',n);
  execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',n);
  execute format('grant select,insert on app_private.%I to service_role',n);
  execute format('create trigger %I before update or delete on app_private.%I for each row execute function app_private.workroom_immutable()',n||'_immutable',n);
 end loop;
end$$;

-- Narrow private boolean check: service_role cannot SELECT provider auth.users
-- or private practice accounts. Do not broaden either table's grants.
create function app_private.workroom_cash_owner_ready(p_user uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select p_user is not null and exists(select 1 from auth.users u
   join app_private.workroom_accounts a on a.user_id=u.id
   where u.id=p_user and u.email_confirmed_at is not null and u.deleted_at is null
     and(u.banned_until is null or u.banned_until<=clock_timestamp()))
 and not exists(select 1 from app_private.funding_engine_activations a where a.user_id=p_user)
 and not exists(select 1 from public.funding_principal_recovery_allocations a where a.user_id=p_user)
$$;

create function app_private.workroom_cash_credit(p_move public.money_source_movements) returns boolean
language sql volatile security invoker set search_path=pg_catalog as $$
 select p_move.movement_kind='CREDIT' and p_move.source_bucket='PRINCIPAL'
  and p_move.origin_code in('KRW_DEPOSIT','USDT_KRW_DEPOSIT')
  and app_private.money_source_credit_verified(p_move)
$$;

create function app_private.workroom_cash_totals(p_user uuid) returns jsonb
language sql volatile security invoker set search_path=pg_catalog as $$
 with credits as(select coalesce(sum(m.amount_atomic),0) n from public.money_source_movements m
   where m.user_id=p_user and app_private.workroom_cash_credit(m)),
 reservations as(select coalesce(sum(r.amount_atomic),0) n from app_private.workroom_cash_reservations r where r.user_id=p_user),
 terminals as(select coalesce(sum(d.amount_atomic)filter(where d.phase='RELEASE'),0) released,
   coalesce(sum(d.amount_atomic)filter(where d.phase='FINALIZE'),0) finalized
   from app_private.workroom_cash_dispositions d where d.user_id=p_user)
 select jsonb_build_object('deposited',credits.n::text,'available',(credits.n-reservations.n+terminals.released)::text,
   'held',(reservations.n-terminals.released-terminals.finalized)::text,'withdrawn',terminals.finalized::text)
 from credits,reservations,terminals
$$;

create function public.read_workroom_cash(p_user_id uuid) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare t jsonb;w uuid;available bigint;ready boolean;begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='WORKROOM_CASH_SERVICE_REQUIRED';end if;
 ready:=app_private.workroom_cash_owner_ready(p_user_id);
 select id into w from public.wallet_accounts where user_id=p_user_id and currency='KRW' and closed_at is null;
 if not ready or w is null or(select coverage from public.money_source_summaries where user_id=p_user_id) is distinct from 'COMPLETE' then
  return jsonb_build_object('schemaVersion',1,'currency','KRW','source','DIRECT_DEPOSIT','ready',false,
    'availableKrw','0','heldKrw','0','depositedKrw','0','withdrawnKrw','0');end if;
 t:=app_private.workroom_cash_totals(p_user_id);available:=app_private.available_krw_balance(w);
 if (t->>'available')::numeric<0 or(t->>'held')::numeric<0 or available<0 then
  raise exception using errcode='55000',message='WORKROOM_CASH_SOURCE_UNRESOLVED';end if;
 return jsonb_build_object('schemaVersion',1,'currency','KRW','source','DIRECT_DEPOSIT','ready',true,
  'availableKrw',least((t->>'available')::numeric,available::numeric)::text,'heldKrw',t->>'held',
  'depositedKrw',t->>'deposited','withdrawnKrw',t->>'withdrawn');
end$$;

create function public.prepare_workroom_cash_withdrawal(
 p_user_id uuid,p_method text,p_amount_krw bigint,p_policy_id uuid,p_policy_version integer,
 p_destination_fingerprint text,p_destination_id uuid default null
) returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare r public.withdrawal_logical_requests%rowtype;i app_private.workroom_cash_intents%rowtype;j jsonb;begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='WORKROOM_CASH_SERVICE_REQUIRED';end if;
 if not app_private.workroom_cash_owner_ready(p_user_id) then raise exception using errcode='55000',message='WORKROOM_CASH_OWNER_NOT_READY';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('withdrawal-logical:'||p_user_id::text,0));
 select * into r from public.withdrawal_logical_requests where user_id=p_user_id
  and state in('PREPARED','DESTINATION_REGISTERED','OUTCOME_UNCERTAIN') for update;
 if r.idempotency_key is not null and not exists(select 1 from app_private.workroom_cash_intents x where x.logical_key=r.idempotency_key and x.user_id=p_user_id) then
  raise exception using errcode='55000',message='WORKROOM_CASH_LEGACY_PENDING';end if;
 j:=public.prepare_withdrawal_logical_request(p_user_id,p_method,p_amount_krw,p_policy_id,p_policy_version,p_destination_fingerprint,p_destination_id);
 select * into r from public.withdrawal_logical_requests where idempotency_key=j->>'key' and user_id=p_user_id;
 if r.schema_version<>2 then raise exception using errcode='55000',message='WORKROOM_CASH_LOGICAL_MISMATCH';end if;
 insert into app_private.workroom_cash_intents(logical_key,user_id,method,amount_atomic,policy_id,policy_version,destination_fingerprint)
 values(r.idempotency_key,p_user_id,r.method,r.amount_krw,r.policy_id,r.policy_version,r.destination_fingerprint) on conflict(logical_key)do nothing;
 select * into i from app_private.workroom_cash_intents where logical_key=r.idempotency_key;
 if row(i.user_id,i.method,i.amount_atomic,i.policy_id,i.policy_version,i.destination_fingerprint)
   is distinct from row(r.user_id,r.method,r.amount_krw,r.policy_id,r.policy_version,r.destination_fingerprint) then
  raise exception using errcode='55000',message='WORKROOM_CASH_LOGICAL_MISMATCH';end if;
 return j;
end$$;

create function app_private.workroom_cash_reservation_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare m public.money_source_movements%rowtype;r public.withdrawal_requests%rowtype;used numeric;begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='WORKROOM_CASH_SERVICE_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||new.user_id::text,0));
 select * into m from public.money_source_movements where id=new.credit_movement_id and user_id=new.user_id;
 select q.* into r from public.withdrawal_requests q join app_private.workroom_cash_withdrawals c on c.withdrawal_id=q.id
 where q.id=new.withdrawal_id and q.user_id=new.user_id and c.user_id=new.user_id;
 select coalesce(sum(x.amount_atomic),0)into used from app_private.workroom_cash_reservations x
 where x.credit_movement_id=new.credit_movement_id and not exists(select 1 from app_private.workroom_cash_dispositions d
   where d.withdrawal_id=x.withdrawal_id and d.phase='RELEASE');
 if m.id is null or not app_private.workroom_cash_credit(m) or r.id is null or r.status<>'HELD'
  or r.fee_atomic<>0 or r.welcome_reward_conversion_id is not null or r.currency<>'KRW'
  or new.hold_ledger_transaction_id is distinct from r.hold_ledger_transaction_id
  or new.effective_at is distinct from r.hold_posted_at or m.effective_at>new.effective_at
  or used+new.amount_atomic>m.amount_atomic
  or not app_private.withdrawal_coverage_entries_verified(new.hold_ledger_transaction_id,new.user_id,r.amount_atomic,'HOLD') then
  raise exception using errcode='55000',message='WORKROOM_CASH_CREDIT_RESERVATION_INVALID';end if;
 return new;
end$$;
create trigger workroom_cash_reservation_guard before insert on app_private.workroom_cash_reservations
 for each row execute function app_private.workroom_cash_reservation_guard();

create function public.hold_workroom_cash_withdrawal(
 p_user_id uuid,p_idempotency_key text,p_method text,p_destination_id uuid,p_amount_krw bigint
) returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare l public.withdrawal_logical_requests%rowtype;i app_private.workroom_cash_intents%rowtype;
 d public.withdrawal_destinations%rowtype;p public.withdrawal_policies%rowtype;
 w uuid;r uuid;tx uuid;at_time timestamptz;request_id uuid:=gen_random_uuid();correlation uuid:=gen_random_uuid();
 state jsonb;left_amount bigint;take_amount bigint;ordinal_value integer:=0;credit record;allowed jsonb;begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='WORKROOM_CASH_SERVICE_REQUIRED';end if;
 if p_user_id is null or p_method is null or p_method not in('KRW_BANK','USDT_ADDRESS') or p_destination_id is null
  or p_idempotency_key is null or length(btrim(p_idempotency_key))not between 8 and 200
  or p_amount_krw is null or p_amount_krw<=0 then
  raise exception using errcode='22023',message='WORKROOM_CASH_INPUT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('withdrawal-logical:'||p_user_id::text,0));
 select * into l from public.withdrawal_logical_requests where idempotency_key=p_idempotency_key and user_id=p_user_id for update;
 select * into i from app_private.workroom_cash_intents where logical_key=p_idempotency_key and user_id=p_user_id;
 if i.logical_key is null or l.idempotency_key is null or l.schema_version<>2
  or row(l.method,l.amount_krw,l.destination_id,l.policy_id,l.policy_version,l.destination_fingerprint)
    is distinct from row(p_method,p_amount_krw,p_destination_id,i.policy_id,i.policy_version,i.destination_fingerprint) then
  raise exception using errcode='42501',message='WORKROOM_CASH_LOGICAL_MISMATCH';end if;
 if l.withdrawal_id is not null then
  if not exists(select 1 from app_private.workroom_cash_withdrawals c where c.withdrawal_id=l.withdrawal_id and c.logical_key=l.idempotency_key and c.user_id=p_user_id) then
   raise exception using errcode='55000',message='WORKROOM_CASH_LOGICAL_MISMATCH';end if;return l.withdrawal_id;end if;
 if not app_private.workroom_cash_owner_ready(p_user_id) then raise exception using errcode='55000',message='WORKROOM_CASH_OWNER_NOT_READY';end if;
 perform app_private.assert_not_safe_mode(array['GLOBAL','WITHDRAWAL']);
 if l.state<>'DESTINATION_REGISTERED' or l.expires_at<=clock_timestamp()then
  raise exception using errcode='55000',message='WORKROOM_CASH_LOGICAL_EXPIRED';end if;
 select * into p from public.withdrawal_policies where currency='KRW' and destination_type=p_method and is_enabled
  and effective_at<=clock_timestamp()and(expires_at is null or expires_at>clock_timestamp()) order by version desc limit 1;
 if p.id is distinct from i.policy_id or p.version is distinct from i.policy_version or p.fee_atomic<>0 or p.allows_welcome_reward
  or p_amount_krw<p.minimum_amount_atomic then raise exception using errcode='55000',message='WORKROOM_CASH_POLICY_CHANGED';end if;
 select * into d from public.withdrawal_destinations where id=p_destination_id and user_id=p_user_id
  and destination_type=p_method and value_fingerprint=i.destination_fingerprint
  and verification_status='VERIFIED' and replaced_at is null and protection_until<=clock_timestamp() for update;
 if d.id is null then raise exception using errcode='55000',message='WORKROOM_CASH_DESTINATION_REQUIRED';end if;
 allowed:=p.destination_config->case when p_method='KRW_BANK'then 'allowed_bank_codes' else 'allowed_networks'end;
 if jsonb_typeof(allowed)is distinct from 'array' or not(allowed?split_part(d.display_hint,' ',1))then
  raise exception using errcode='55000',message='WORKROOM_CASH_DESTINATION_NOT_ALLOWED';end if;
 select id into w from public.wallet_accounts where user_id=p_user_id and currency='KRW'and closed_at is null for update;
 state:=public.read_workroom_cash(p_user_id);
 if w is null or state->'ready' is distinct from 'true'::jsonb or(state->>'availableKrw')::numeric<p_amount_krw then
  raise exception using errcode='22003',message='WORKROOM_CASH_INSUFFICIENT';end if;
 insert into public.withdrawal_requests(wallet_account_id,withdrawal_policy_id,withdrawal_destination_id,user_id,currency,
  amount_atomic,fee_atomic,destination_type,destination_snapshot,status,idempotency_key)
 values(w,p.id,d.id,p_user_id,'KRW',p_amount_krw,0,p_method,
  jsonb_build_object('destination_id',d.id,'display',d.display_hint,'verified_at',d.verified_at),'REQUESTED',p_idempotency_key)returning id into r;
 insert into app_private.workroom_cash_withdrawals(withdrawal_id,logical_key,user_id)values(r,l.idempotency_key,p_user_id);
 tx:=app_private.post_withdrawal_hold(p_user_id,r,p_amount_krw,p_idempotency_key,request_id);
 select posted_at into at_time from public.ledger_transactions where id=tx;
 update public.withdrawal_requests set status='HELD',hold_ledger_transaction_id=tx,hold_posted_at=at_time where id=r;
 left_amount:=p_amount_krw;
 for credit in select m.id,(m.amount_atomic-coalesce((select sum(x.amount_atomic)from app_private.workroom_cash_reservations x
   where x.credit_movement_id=m.id and not exists(select 1 from app_private.workroom_cash_dispositions z where z.withdrawal_id=x.withdrawal_id and z.phase='RELEASE')),0))::bigint open_amount
  from public.money_source_movements m where m.user_id=p_user_id and m.effective_at<=at_time and app_private.workroom_cash_credit(m)
  order by m.effective_at desc,m.recorded_at desc,m.id desc loop
  if credit.open_amount<0 then raise exception using errcode='55000',message='WORKROOM_CASH_SOURCE_UNRESOLVED';end if;
  if credit.open_amount=0 then continue;end if;take_amount:=least(credit.open_amount,left_amount);
  insert into app_private.workroom_cash_reservations(withdrawal_id,user_id,credit_movement_id,hold_ledger_transaction_id,amount_atomic,ordinal,effective_at)
   values(r,p_user_id,credit.id,tx,take_amount,ordinal_value,at_time);
  left_amount:=left_amount-take_amount;ordinal_value:=ordinal_value+1;exit when left_amount=0;
 end loop;
 if left_amount<>0 then raise exception using errcode='55000',message='WORKROOM_CASH_INSUFFICIENT';end if;
 insert into public.outbox_events(event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,idempotency_key,occurred_at,created_at)
 values('WITHDRAWAL_REQUESTED.v1',1,'withdrawal_request',r,p_user_id,jsonb_build_object('user_id',p_user_id,'amount_atomic',p_amount_krw::text,
  'fee_atomic','0','currency','KRW','destination_type',p_method,'hold_ledger_transaction_id',tx,'welcome_reward',false),correlation,request_id,p_idempotency_key||':event',at_time,at_time);
 insert into public.transaction_receipts(receipt_number,user_id,transaction_type,source_type,source_id,amount_atomic,currency,status,requested_at,status_timeline)
 values('PDK-WD-'||upper(replace(r::text,'-','')),p_user_id,'WITHDRAWAL','withdrawal_request',r,p_amount_krw,'KRW','HELD',at_time,
  jsonb_build_array(jsonb_build_object('status','REQUESTED','at',at_time),jsonb_build_object('status','HELD','at',at_time)));
 update public.withdrawal_logical_requests set withdrawal_id=r,state='OUTCOME_UNCERTAIN',updated_at=at_time where idempotency_key=l.idempotency_key;
 return r;
end$$;

create function app_private.workroom_cash_capture_terminal()returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare phase_value text;terminal uuid;wallet uuid;j public.ledger_transactions%rowtype;begin
 if not exists(select 1 from app_private.workroom_cash_withdrawals c where c.withdrawal_id=new.id)then return new;end if;
 if old.finalize_ledger_transaction_id is null and new.finalize_ledger_transaction_id is not null then
  phase_value:='FINALIZE';terminal:=new.finalize_ledger_transaction_id;
 elsif old.release_ledger_transaction_id is null and new.release_ledger_transaction_id is not null then
  phase_value:='RELEASE';terminal:=new.release_ledger_transaction_id;
 else return new;end if;
 if(new.finalize_ledger_transaction_id is not null and new.release_ledger_transaction_id is not null)
   or(phase_value='FINALIZE' and new.status<>'COMPLETED')or(phase_value='RELEASE'and new.status not in('CANCELLED','REJECTED'))then
  raise exception using errcode='55000',message='WORKROOM_CASH_DISPOSITION_CONFLICT';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||new.user_id::text,0));
 select * into j from public.ledger_transactions where id=terminal;
 if j.member_user_id is distinct from new.user_id or j.reference_id is distinct from new.id or j.reference_type<>'withdrawal_request'
  or j.metadata->>'phase' is distinct from phase_value or j.currency<>'KRW' or new.fee_atomic<>0
  or not app_private.withdrawal_coverage_entries_verified(terminal,new.user_id,new.amount_atomic,phase_value)then
  raise exception using errcode='55000',message='WORKROOM_CASH_TERMINAL_INVALID';end if;
 if phase_value='FINALIZE'then
  select x.id into wallet from public.wallet_ledger x where x.reference_type='withdrawal_request'and x.reference_id=new.id
   and x.user_id=new.user_id and x.wallet_account_id=new.wallet_account_id and x.direction='DEBIT'
   and x.entry_type='WITHDRAWAL'and x.amount_atomic=new.amount_atomic;
  if wallet is null or not exists(select 1 from public.withdrawal_external_sends s where s.withdrawal_id=new.id and s.method=new.destination_type)then
   raise exception using errcode='55000',message='WORKROOM_CASH_TERMINAL_INVALID';end if;
 elsif exists(select 1 from public.withdrawal_external_sends s where s.withdrawal_id=new.id)then
  raise exception using errcode='55000',message='WORKROOM_CASH_RELEASE_AFTER_SEND_FORBIDDEN';end if;
 insert into app_private.workroom_cash_dispositions(withdrawal_id,user_id,phase,terminal_ledger_transaction_id,wallet_ledger_id,amount_atomic,effective_at)
 values(new.id,new.user_id,phase_value,terminal,wallet,new.amount_atomic,j.posted_at);
 return new;
end$$;
create trigger zz_workroom_cash_capture_terminal after update on public.withdrawal_requests
 for each row execute function app_private.workroom_cash_capture_terminal();

-- DIRECT_CASH_COVERAGE_ASSEMBLED
create function app_private.workroom_cash_coverage_verified(
  p_request public.withdrawal_requests
) returns boolean
-- Existing verified-source assertions are VOLATILE readers. Match their
-- snapshot contract; this function still performs SELECTs only, with no writes.
language plpgsql volatile security invoker set search_path = pg_catalog
as $$
declare
  v_hold public.ledger_transactions%rowtype;
  v_terminal public.ledger_transactions%rowtype;
  v_phase text;
  v_operation text;
  v_key text;
  v_wallet_id uuid;
  v_reserved numeric;
  v_welcome boolean := false;
begin
  if p_request.welcome_reward_conversion_id is not null or not exists (
    select 1 from app_private.workroom_cash_withdrawals c
    join app_private.workroom_cash_intents i on i.logical_key=c.logical_key
    join public.withdrawal_logical_requests l on l.idempotency_key=i.logical_key
    where c.withdrawal_id=p_request.id and c.user_id=p_request.user_id
      and i.user_id=p_request.user_id and i.method=p_request.destination_type
      and i.amount_atomic=p_request.amount_atomic and i.policy_id=p_request.withdrawal_policy_id
      and l.user_id=p_request.user_id and l.withdrawal_id=p_request.id
      and l.idempotency_key=p_request.idempotency_key and l.schema_version=2
      and row(l.method,l.amount_krw,l.policy_id,l.policy_version,l.destination_fingerprint)
        is not distinct from row(i.method,i.amount_atomic,i.policy_id,i.policy_version,i.destination_fingerprint)
  ) or exists(select 1 from public.mining_reward_withdrawal_reservations x
      where x.hold_ledger_transaction_id=p_request.hold_ledger_transaction_id)
  then return false;end if;
  if p_request.id is null or p_request.user_id is null
    or p_request.currency::text is distinct from 'KRW'
    or p_request.amount_atomic is null or p_request.amount_atomic <= 0
    or p_request.fee_atomic is distinct from 0
    or p_request.destination_type not in ('KRW_BANK', 'USDT_ADDRESS')
    or p_request.hold_ledger_transaction_id is null
    or p_request.hold_posted_at is null
    or not exists (select 1 from public.wallet_accounts account
      where account.id = p_request.wallet_account_id
        and account.user_id = p_request.user_id and account.currency = 'KRW')
    or exists (select 1 from public.funding_principal_recovery_allocations allocation
      where allocation.hold_ledger_transaction_id = p_request.hold_ledger_transaction_id)
  then return false; end if;

  select * into v_hold from public.ledger_transactions
  where id = p_request.hold_ledger_transaction_id;
  if v_hold.id is null or v_hold.category::text is distinct from 'WITHDRAWAL'
    or v_hold.currency::text is distinct from 'KRW'
    or v_hold.member_user_id is distinct from p_request.user_id
    or v_hold.reference_type is distinct from 'withdrawal_request'
    or v_hold.reference_id is distinct from p_request.id
    or v_hold.metadata->>'phase' is distinct from 'HOLD'
    or v_hold.metadata->>'amount_atomic' is distinct from p_request.amount_atomic::text
    or v_hold.idempotency_key is distinct from p_request.idempotency_key || ':hold'
    or v_hold.request_id is null or v_hold.correlation_id is null
    or v_hold.created_at < (select introduced_at from app_private.money_source_epochs where version = 1)
    or not app_private.withdrawal_coverage_entries_verified(
      v_hold.id, p_request.user_id, p_request.amount_atomic, 'HOLD')
    or (select count(*) from public.outbox_events event
      where event.event_type = 'WITHDRAWAL_REQUESTED.v1' and event.schema_version = 1
        and event.aggregate_type = 'withdrawal_request' and event.aggregate_id = p_request.id
        and event.actor_user_id = p_request.user_id and event.request_id = v_hold.request_id
        and event.idempotency_key = p_request.idempotency_key || ':event'
        and event.payload->>'user_id' = p_request.user_id::text
        and event.payload->>'amount_atomic' = p_request.amount_atomic::text
        and event.payload->>'fee_atomic' = '0' and event.payload->>'currency' = 'KRW'
        and event.payload->>'destination_type' = p_request.destination_type
        and event.payload->>'hold_ledger_transaction_id' = v_hold.id::text
        and event.payload->'welcome_reward' = to_jsonb(v_welcome)) <> 1
    or (select count(*) from public.transaction_receipts receipt
      where receipt.source_type = 'withdrawal_request' and receipt.source_id = p_request.id
        and receipt.user_id = p_request.user_id and receipt.currency = 'KRW'
        and receipt.amount_atomic = p_request.amount_atomic
        and receipt.transaction_type = case when v_welcome then 'WELCOME_REWARD_WITHDRAWAL' else 'WITHDRAWAL' end) <> 1
  then return false; end if;

  select coalesce(sum(x.amount_atomic),0) into v_reserved
  from app_private.workroom_cash_reservations x where x.withdrawal_id=p_request.id;
  if v_reserved is distinct from p_request.amount_atomic::numeric
    or exists(select 1 from app_private.workroom_cash_reservations x
      left join public.money_source_movements credit on credit.id=x.credit_movement_id
      where x.withdrawal_id=p_request.id and (
        x.user_id is distinct from p_request.user_id
        or x.hold_ledger_transaction_id is distinct from v_hold.id
        or x.effective_at is distinct from p_request.hold_posted_at
        or credit.user_id is distinct from p_request.user_id
        or credit.effective_at>x.effective_at or not app_private.workroom_cash_credit(credit)
        or(select coalesce(sum(y.amount_atomic),0)from app_private.workroom_cash_reservations y
          where y.credit_movement_id=credit.id and not exists(select 1 from app_private.workroom_cash_dispositions z
            where z.withdrawal_id=y.withdrawal_id and z.phase='RELEASE'))>credit.amount_atomic))
  then return false;end if;

  if p_request.status in ('COMPLETED', 'CANCELLED', 'REJECTED') then
    if p_request.status = 'COMPLETED' then
      if p_request.finalize_ledger_transaction_id is null
        or p_request.release_ledger_transaction_id is not null
        or p_request.ledger_finalized_at is null
        or not exists (select 1 from public.withdrawal_external_sends send
          where send.withdrawal_id = p_request.id and send.method = p_request.destination_type)
      then return false; end if;
      v_phase := 'FINALIZE'; v_operation := 'finalize_withdrawal_ledger';
      select * into v_terminal from public.ledger_transactions
      where id = p_request.finalize_ledger_transaction_id;
      v_key := left(v_terminal.idempotency_key, length(v_terminal.idempotency_key) - 9);
      if right(v_terminal.idempotency_key, 9) is distinct from ':finalize'
        or (select count(*) from public.wallet_ledger projection
          where projection.reference_type = 'withdrawal_request' and projection.reference_id = p_request.id) <> 1
      then return false; end if;
      select projection.id into v_wallet_id from public.wallet_ledger projection
      where projection.user_id = p_request.user_id and projection.wallet_account_id = p_request.wallet_account_id
        and projection.direction = 'DEBIT' and projection.entry_type::text = 'WITHDRAWAL'
        and projection.amount_atomic = p_request.amount_atomic
        and projection.reference_type = 'withdrawal_request' and projection.reference_id = p_request.id
        and projection.idempotency_key = v_key || ':wallet'
        and projection.created_by = v_terminal.created_by;
      if v_wallet_id is null
        or not exists (select 1 from public.transaction_receipts receipt
          where receipt.source_type = 'withdrawal_request' and receipt.source_id = p_request.id
            and receipt.status = 'COMPLETED' and receipt.ledger_transaction_id = v_terminal.id)
        or (select count(*) from public.outbox_events event
          where event.event_type = 'WITHDRAWAL_COMPLETED.v1' and event.schema_version = 1
            and event.aggregate_type = 'withdrawal_request' and event.aggregate_id = p_request.id
            and event.actor_user_id = v_terminal.created_by and event.request_id = v_terminal.request_id
            and event.idempotency_key = v_key || ':event'
            and event.payload->>'finalize_ledger_transaction_id' = v_terminal.id::text
            and event.payload->>'amount_atomic' = p_request.amount_atomic::text) <> 1
      then return false; end if;
    else
      if p_request.release_ledger_transaction_id is null
        or p_request.finalize_ledger_transaction_id is not null
        or p_request.hold_released_at is null
        or exists (select 1 from public.withdrawal_external_sends send where send.withdrawal_id = p_request.id)
        or exists (select 1 from public.wallet_ledger projection
          where projection.reference_type = 'withdrawal_request' and projection.reference_id = p_request.id)
      then return false; end if;
      v_phase := 'RELEASE'; v_operation := 'release_withdrawal_hold';
      select * into v_terminal from public.ledger_transactions
      where id = p_request.release_ledger_transaction_id;
      v_key := left(v_terminal.idempotency_key, length(v_terminal.idempotency_key) - 8);
      if right(v_terminal.idempotency_key, 8) is distinct from ':release'
        or v_terminal.category::text is distinct from 'REVERSAL'
        or v_terminal.reversal_of_transaction_id is distinct from v_hold.id
        or v_terminal.metadata->>'disposition' is distinct from p_request.status::text
        or v_terminal.metadata->>'reason' is distinct from p_request.rejection_reason
        or (select count(*) from public.outbox_events event
          where event.event_type = 'WITHDRAWAL_HOLD_RELEASED.v1' and event.schema_version = 1
            and event.aggregate_type = 'withdrawal_request' and event.aggregate_id = p_request.id
            and event.actor_user_id = v_terminal.created_by and event.request_id = v_terminal.request_id
            and event.idempotency_key = v_key || ':event'
            and event.payload->>'release_ledger_transaction_id' = v_terminal.id::text
            and event.payload->>'disposition' = p_request.status::text
            and event.payload->>'reason' = p_request.rejection_reason) <> 1
      then return false; end if;
    end if;

    if v_terminal.id is null or v_terminal.currency::text is distinct from 'KRW'
      or v_terminal.member_user_id is distinct from p_request.user_id
      or v_terminal.reference_type is distinct from 'withdrawal_request'
      or v_terminal.reference_id is distinct from p_request.id
      or v_terminal.metadata->>'phase' is distinct from v_phase
      or v_terminal.created_by is null or v_terminal.request_id is null
      or (v_phase = 'FINALIZE' and v_terminal.category::text is distinct from 'WITHDRAWAL')
      or not app_private.withdrawal_coverage_entries_verified(
        v_terminal.id, p_request.user_id, p_request.amount_atomic, v_phase)
      or (select count(*) from public.audit_logs audit
        where audit.action = v_operation and audit.target_type = 'withdrawal_request'
          and audit.target_id = p_request.id::text and audit.actor_user_id = v_terminal.created_by
          and audit.metadata->>'operation' = v_operation
          and audit.metadata->>'result_id' = v_terminal.id::text
          and audit.metadata->>'actor_user_id' = v_terminal.created_by::text
          and audit.metadata->>'destination_id' = p_request.withdrawal_destination_id::text
          and audit.metadata->>'currency' = 'KRW'
          and audit.metadata->>'amount_atomic' = p_request.amount_atomic::text
          and audit.metadata->>'idempotency_key' = v_key) <> 1
    then return false; end if;

    -- Direct cash has its own immutable terminal receipt, without inventing
    -- a mining reward or another original deposit credit.
    if (select count(*) from app_private.workroom_cash_dispositions disposition
      where disposition.withdrawal_id=p_request.id and disposition.user_id=p_request.user_id
        and disposition.phase=v_phase and disposition.amount_atomic=p_request.amount_atomic
        and disposition.terminal_ledger_transaction_id=v_terminal.id
        and disposition.wallet_ledger_id is not distinct from v_wallet_id
        and disposition.effective_at=v_terminal.posted_at)<>1
    then return false; end if;
    return true;
  end if;

  -- Active requests retain their proven source while the reservation is held.
  -- A terminal ID/debit in an active state is never guessed into coverage.
  return not exists(select 1 from app_private.workroom_cash_dispositions z where z.withdrawal_id=p_request.id)
    and p_request.status in ('HELD', 'ADMIN_PROCESSING', 'REVIEWING', 'APPROVED', 'PROCESSING', 'EXTERNAL_SENT_RECORDED')
    and p_request.release_ledger_transaction_id is null and p_request.finalize_ledger_transaction_id is null
    and not exists (select 1 from public.wallet_ledger projection
      where projection.reference_type = 'withdrawal_request' and projection.reference_id = p_request.id)
    and case when p_request.status = 'EXTERNAL_SENT_RECORDED' then exists (
      select 1 from public.withdrawal_external_sends send
      where send.withdrawal_id = p_request.id and send.method = p_request.destination_type
    ) else not exists (select 1 from public.withdrawal_external_sends send where send.withdrawal_id = p_request.id) end;
end;
$$;

create or replace view public.money_source_summaries with (security_invoker = true) as
select a.user_id, 2 as schema_version,
  m.unclassified_wallet_entries::text as unclassified_wallet_entries,
  w.unconnected_withdrawals::text as unconnected_withdrawals,
  j.unclassified_journals::text as unclassified_journals,
  (c.invalid_source_receipts + p.invalid_fold)::text as invalid_source_receipts,
  case when m.unclassified_wallet_entries + w.unconnected_withdrawals
    + j.unclassified_journals + c.invalid_source_receipts + p.invalid_fold = 0
    then 'COMPLETE' else 'UNRESOLVED' end as coverage,
  case when m.unclassified_wallet_entries + w.unconnected_withdrawals
    + j.unclassified_journals + c.invalid_source_receipts + p.invalid_fold = 0
    then p.available::text end as eligible_principal_atomic,
  c.krw_deposits::text as recorded_krw_principal_deposits_atomic,
  c.usdt_credits::text as recorded_usdt_principal_credits_atomic,
  c.bonus::text as recorded_bonus_atomic,
  statement_timestamp() as observed_at,
  (select introduced_at from app_private.money_source_epochs where version = 1) as capture_started_at,
  case when m.unclassified_wallet_entries + w.unconnected_withdrawals
    + j.unclassified_journals + c.invalid_source_receipts + p.invalid_fold = 0
    then p.held::text end as held_principal_atomic,
  case when m.unclassified_wallet_entries + w.unconnected_withdrawals
    + j.unclassified_journals + c.invalid_source_receipts + p.invalid_fold = 0
    then (c.principal_finalized+cash.finalized)::text end as recovered_principal_atomic
from public.wallet_accounts as a
cross join lateral (
  select coalesce(sum(amount_atomic) filter (where verified and source_bucket = 'PRINCIPAL' and movement_kind = 'CREDIT'), 0) as principal,
    coalesce(sum(amount_atomic) filter (where verified and origin_code = 'KRW_DEPOSIT' and movement_kind = 'CREDIT'), 0) as krw_deposits,
    coalesce(sum(amount_atomic) filter (where verified and origin_code = 'USDT_KRW_DEPOSIT' and movement_kind = 'CREDIT'), 0) as usdt_credits,
    coalesce(sum(amount_atomic) filter (where verified and source_bucket = 'BONUS' and movement_kind = 'CREDIT'), 0) as bonus,
    coalesce(sum(amount_atomic) filter (where verified and origin_code = 'PRINCIPAL_RECOVERY_HOLD'
      and movement_kind = 'RESERVE'), 0) as principal_reserved,
    coalesce(sum(amount_atomic) filter (where verified and origin_code = 'PRINCIPAL_RECOVERY_RELEASE'
      and movement_kind = 'RELEASE'), 0) as principal_released,
    coalesce(sum(amount_atomic) filter (where verified and origin_code = 'PRINCIPAL_RECOVERY_FINALIZE'
      and movement_kind = 'FINALIZE'), 0) as principal_finalized,
    count(*) filter (where not verified) as invalid_source_receipts
  from (select amount_atomic, source_bucket, origin_code, movement_kind,
      app_private.money_source_credit_verified(movement) as verified
    from public.money_source_movements as movement where user_id = a.user_id) as checked
) as c
cross join lateral (
 select coalesce(sum(r.amount_atomic),0) reserved,
   coalesce(sum(r.amount_atomic)filter(where d.phase='RELEASE'),0) released,
   coalesce(sum(r.amount_atomic)filter(where d.phase='FINALIZE'),0) finalized
 from app_private.workroom_cash_reservations r
 left join app_private.workroom_cash_dispositions d on d.withdrawal_id=r.withdrawal_id
 where r.user_id=a.user_id
)cash
cross join lateral (
  select c.principal - c.principal_reserved + c.principal_released - cash.reserved + cash.released as available,
    c.principal_reserved - c.principal_released - c.principal_finalized + cash.reserved - cash.released - cash.finalized as held,
    case when c.principal - c.principal_reserved + c.principal_released - cash.reserved + cash.released < 0
      or c.principal_reserved - c.principal_released - c.principal_finalized + cash.reserved - cash.released - cash.finalized < 0
      then 1 else 0 end as invalid_fold
) as p
cross join lateral (
  select count(*) as unclassified_wallet_entries
  from public.wallet_ledger as projection
  where projection.wallet_account_id = a.id and not exists (
    select 1 from public.money_source_movements as movement where movement.wallet_ledger_id = projection.id
  ) and not exists (
    select 1 from public.withdrawal_requests request
    where request.user_id = a.user_id and request.wallet_account_id = projection.wallet_account_id
      and (request.welcome_reward_conversion_id is not null or exists(select 1 from app_private.workroom_cash_withdrawals cw where cw.withdrawal_id=request.id)) and request.status = 'COMPLETED'
      and projection.reference_type = 'withdrawal_request' and projection.reference_id = request.id
      and projection.user_id = request.user_id and projection.direction = 'DEBIT'
      and projection.entry_type::text = 'WITHDRAWAL' and projection.amount_atomic = request.amount_atomic
      and(app_private.non_principal_withdrawal_coverage_verified(request) or app_private.workroom_cash_coverage_verified(request))
  )
) as m
cross join lateral (
  select count(*) as unconnected_withdrawals
  from public.withdrawal_requests as request
  where request.user_id = a.user_id
    and request.currency = 'KRW'
    and not app_private.non_principal_withdrawal_coverage_verified(request) and not app_private.workroom_cash_coverage_verified(request)
    and not exists (
      select 1
      from public.funding_principal_recovery_allocations as allocation
      where allocation.user_id = request.user_id
        and allocation.hold_ledger_transaction_id = request.hold_ledger_transaction_id
    )
) as w
cross join lateral (
  select count(*) as unclassified_journals from public.ledger_transactions as journal
  join (
    select owned_header.id as journal_id from public.ledger_transactions as owned_header
      where owned_header.member_user_id = a.user_id and owned_header.currency = 'KRW'
    union
    select entry.transaction_id as journal_id from public.ledger_accounts as owned_account
      join public.ledger_entries as entry on entry.account_id = owned_account.id
      where owned_account.owner_user_id = a.user_id and owned_account.currency = 'KRW'
  ) as affected on affected.journal_id = journal.id
  where journal.currency = 'KRW' and not exists (
    select 1 from public.money_source_movements as movement
      where movement.ledger_transaction_id = journal.id and movement.user_id = a.user_id
  ) and not exists (
    select 1 from public.withdrawal_requests request
    where request.user_id = a.user_id
      and journal.id in (request.hold_ledger_transaction_id,
        request.release_ledger_transaction_id, request.finalize_ledger_transaction_id)
      and(app_private.non_principal_withdrawal_coverage_verified(request) or app_private.workroom_cash_coverage_verified(request))
  )
) as j
where a.currency = 'KRW';

create function app_private.workroom_cash_original_guard()returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare l public.withdrawal_logical_requests%rowtype;r public.withdrawal_requests%rowtype;i app_private.workroom_cash_intents%rowtype;begin
 if current_user<>'service_role'then raise exception using errcode='42501',message='WORKROOM_CASH_SERVICE_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||new.user_id::text,0));
 if tg_table_name='workroom_cash_intents'then
  select * into l from public.withdrawal_logical_requests where idempotency_key=new.logical_key and user_id=new.user_id;
  if not app_private.workroom_cash_owner_ready(new.user_id) or l.idempotency_key is null or l.schema_version<>2
   or row(l.method,l.amount_krw,l.policy_id,l.policy_version,l.destination_fingerprint)
    is distinct from row(new.method,new.amount_atomic,new.policy_id,new.policy_version,new.destination_fingerprint)then
   raise exception using errcode='55000',message='WORKROOM_CASH_ORIGINAL_INVALID';end if;
 else
  select * into i from app_private.workroom_cash_intents where logical_key=new.logical_key and user_id=new.user_id;
  select * into r from public.withdrawal_requests where id=new.withdrawal_id and user_id=new.user_id;
  if i.logical_key is null or r.id is null or r.status<>'REQUESTED' or r.fee_atomic<>0 or r.currency<>'KRW'
   or r.welcome_reward_conversion_id is not null or r.hold_ledger_transaction_id is not null
   or row(r.amount_atomic,r.destination_type,r.withdrawal_policy_id,r.idempotency_key)
     is distinct from row(i.amount_atomic,i.method,i.policy_id,i.logical_key)then
   raise exception using errcode='55000',message='WORKROOM_CASH_ORIGINAL_INVALID';end if;
 end if;return new;
end$$;
create trigger workroom_cash_intent_guard before insert on app_private.workroom_cash_intents
 for each row execute function app_private.workroom_cash_original_guard();
create trigger workroom_cash_withdrawal_guard before insert on app_private.workroom_cash_withdrawals
 for each row execute function app_private.workroom_cash_original_guard();

-- Enrolling in direct cash cannot subsequently be reused as a legacy funded
-- engine/principal source. Existing users and rows without cash originals keep
-- their old commands and conditions unchanged.
create function app_private.workroom_cash_legacy_mode_guard()returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$begin
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||new.user_id::text,0));
 if exists(select 1 from app_private.workroom_cash_intents i where i.user_id=new.user_id)then
  raise exception using errcode='55000',message='WORKROOM_CASH_LEGACY_ENGINE_CONFLICT';end if;
 return new;
end$$;
create trigger workroom_cash_legacy_activation_guard before insert on app_private.funding_engine_activations
 for each row execute function app_private.workroom_cash_legacy_mode_guard();
create trigger workroom_cash_legacy_allocation_guard before insert on public.funding_principal_recovery_allocations
 for each row execute function app_private.workroom_cash_legacy_mode_guard();

create function app_private.workroom_cash_disposition_guard()returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.withdrawal_requests%rowtype;j public.ledger_transactions%rowtype;begin
 if current_user<>'service_role'then raise exception using errcode='42501',message='WORKROOM_CASH_SERVICE_REQUIRED';end if;
 select q.* into r from public.withdrawal_requests q join app_private.workroom_cash_withdrawals c on c.withdrawal_id=q.id
  where q.id=new.withdrawal_id and q.user_id=new.user_id and c.user_id=new.user_id;
 select * into j from public.ledger_transactions where id=new.terminal_ledger_transaction_id;
 if r.id is null or new.amount_atomic is distinct from r.amount_atomic or r.fee_atomic<>0
  or j.member_user_id is distinct from new.user_id or j.reference_id is distinct from r.id
  or j.reference_type<>'withdrawal_request' or j.metadata->>'phase' is distinct from new.phase
  or j.posted_at is distinct from new.effective_at
  or(new.phase='FINALIZE'and(r.status<>'COMPLETED' or r.finalize_ledger_transaction_id is distinct from j.id or r.release_ledger_transaction_id is not null))
  or(new.phase='RELEASE'and(r.status not in('CANCELLED','REJECTED')or r.release_ledger_transaction_id is distinct from j.id or r.finalize_ledger_transaction_id is not null))
  or not app_private.withdrawal_coverage_entries_verified(j.id,new.user_id,new.amount_atomic,new.phase)then
  raise exception using errcode='55000',message='WORKROOM_CASH_TERMINAL_INVALID';end if;
 return new;
end$$;
create trigger workroom_cash_disposition_guard before insert on app_private.workroom_cash_dispositions
 for each row execute function app_private.workroom_cash_disposition_guard();

create function app_private.workroom_cash_complete_guard()returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare id_value uuid;r public.withdrawal_requests%rowtype;begin
 if tg_table_schema='public'then id_value:=new.id;else id_value:=new.withdrawal_id;end if;
 if not exists(select 1 from app_private.workroom_cash_withdrawals c where c.withdrawal_id=id_value)then return null;end if;
 select * into r from public.withdrawal_requests where id=id_value;
 if not app_private.workroom_cash_coverage_verified(r)then
  raise exception using errcode='55000',message='WORKROOM_CASH_RECEIPT_INCOMPLETE';end if;return null;
end$$;
create constraint trigger workroom_cash_request_complete after insert or update on public.withdrawal_requests
 deferrable initially deferred for each row execute function app_private.workroom_cash_complete_guard();
create constraint trigger workroom_cash_original_complete after insert on app_private.workroom_cash_withdrawals
 deferrable initially deferred for each row execute function app_private.workroom_cash_complete_guard();
create constraint trigger workroom_cash_reservation_complete after insert on app_private.workroom_cash_reservations
 deferrable initially deferred for each row execute function app_private.workroom_cash_complete_guard();
create constraint trigger workroom_cash_disposition_complete after insert on app_private.workroom_cash_dispositions
 deferrable initially deferred for each row execute function app_private.workroom_cash_complete_guard();

do $$declare p regprocedure;begin
 for p in select oid::regprocedure from pg_proc where pronamespace='app_private'::regnamespace
   and proname like 'workroom_cash_%'loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',p);
  execute format('grant execute on function %s to service_role',p);
 end loop;
end$$;
revoke all on function public.read_workroom_cash(uuid)from public,anon,authenticated,service_role;
revoke all on function public.prepare_workroom_cash_withdrawal(uuid,text,bigint,uuid,integer,text,uuid)from public,anon,authenticated,service_role;
revoke all on function public.hold_workroom_cash_withdrawal(uuid,text,text,uuid,bigint)from public,anon,authenticated,service_role;
grant execute on function public.read_workroom_cash(uuid)to service_role;
grant execute on function public.prepare_workroom_cash_withdrawal(uuid,text,bigint,uuid,integer,text,uuid)to service_role;
grant execute on function public.hold_workroom_cash_withdrawal(uuid,text,text,uuid,bigint)to service_role;

comment on function public.read_workroom_cash(uuid)is
 'Read-only verified direct-deposit cash; practice points never constitute a monetary source.';
comment on table app_private.workroom_cash_reservations is
 'Immutable per-original approved-deposit reservations. Newest verified credits first; proved release permits reuse.';
comment on function public.hold_workroom_cash_withdrawal(uuid,text,text,uuid,bigint)is
 'New direct-deposit cash mode only; existing mining reward/native principal source contracts remain unchanged.';

commit;
