begin;

-- The old 206-source chain and its fixed source/push envelopes remain intact.
-- Lock START during adoption; only currently open rounds acquire a due job.
lock table app_private.workroom_rounds in share row exclusive mode;
create table app_private.workroom_app_jobs (
 round_id uuid primary key references app_private.workroom_rounds(id),
 member_id uuid not null references app_private.workroom_accounts(user_id),
 due_at timestamptz not null, settled_at timestamptz
);
create index workroom_app_due_jobs on app_private.workroom_app_jobs(due_at,round_id) where settled_at is null;
insert into app_private.workroom_app_jobs(round_id,member_id,due_at)
 select id,user_id,started_at+make_interval(secs=>(snapshot->>'duration')::integer)
 from app_private.workroom_rounds where closed_at is null;

create table app_private.workroom_app_threads (
 id uuid primary key default gen_random_uuid(), member_id uuid not null references app_private.workroom_accounts(user_id),
 status text not null default 'OPEN' check(status in('OPEN','ASSIGNED','ANSWERED','RESOLVED')),
 assigned_admin_id uuid references auth.users(id), updated_at timestamptz not null default clock_timestamp()
);
create index workroom_app_threads_member on app_private.workroom_app_threads(member_id,updated_at desc,id desc);
create index workroom_app_threads_recent on app_private.workroom_app_threads(updated_at desc,id desc);
create table app_private.workroom_app_messages (
 id uuid primary key default gen_random_uuid(), thread_id uuid not null references app_private.workroom_app_threads(id),
 seq bigint generated always as identity, sender uuid not null references auth.users(id),
 sender_role text not null check(sender_role in('ADMIN','MEMBER')),
 body text not null check(length(btrim(body)) between 1 and 2000), created_at timestamptz not null default clock_timestamp(),
 unique(thread_id,seq)
);
create table app_private.workroom_app_cursors (
 thread_id uuid not null, reader uuid not null references auth.users(id), audience text not null check(audience in('ADMIN','MEMBER')),
 seq bigint not null, primary key(thread_id,reader,audience),
 foreign key(thread_id,seq) references app_private.workroom_app_messages(thread_id,seq)
);
create table app_private.workroom_app_events (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in(
 'ROUND_COMPLETED','SUPPORT_RECEIVED','SUPPORT_ANSWERED','DEPOSIT_CONFIRMED','WITHDRAWAL_COMPLETED','WITHDRAWAL_RELEASED','KRW_DEPOSIT_REQUESTED','USDT_DEPOSIT_REQUESTED','KRW_WITHDRAWAL_REQUESTED','USDT_WITHDRAWAL_REQUESTED')),
 source_id uuid not null, resource_id uuid not null, member_id uuid not null references auth.users(id),
 legacy_source uuid references public.outbox_events(id), created_at timestamptz not null default clock_timestamp(),
 unique(kind,source_id)
);
create table app_private.workroom_app_inbox (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references app_private.workroom_app_events(id),
 recipient uuid not null references auth.users(id), audience text not null check(audience in('ADMIN','MEMBER')),
 created_at timestamptz not null default clock_timestamp(), read_at timestamptz,
 unique(event_id,recipient,audience)
);
create index workroom_app_inbox_feed on app_private.workroom_app_inbox(recipient,audience,created_at desc,id desc);
create table app_private.workroom_app_devices (
 subscription_id uuid primary key references public.push_subscriptions(id), audience text not null check(audience in('ADMIN','MEMBER')),
 user_id uuid not null references auth.users(id), binding_receipt uuid not null,
 admin_session_id uuid references public.admin_sessions(id), check((audience='ADMIN')=(admin_session_id is not null))
);
create table app_private.workroom_app_push (
 id uuid primary key default gen_random_uuid(), notification_id uuid not null references app_private.workroom_app_inbox(id),
 subscription_id uuid not null references public.push_subscriptions(id), binding_receipt uuid not null,
 endpoint_epoch bigint not null, subscription_digest text not null,
 status text not null default 'PENDING' check(status in('PENDING','LEASED','ACCEPTED','EXPIRED','RETRY','FAILED','CANCELLED')),
 attempt integer not null default 0 check(attempt between 0 and 12), available_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null, worker text, token uuid, lease_expires timestamptz,
 unique(notification_id,subscription_id)
);
create index workroom_app_push_pending on app_private.workroom_app_push(available_at,id) where status in('PENDING','RETRY','LEASED');
create table app_private.workroom_app_push_receipts (
 delivery_id uuid not null references app_private.workroom_app_push(id), attempt integer not null, worker text not null, token uuid not null,
 outcome text not null, http_status integer, error_code text, result text not null, recorded_at timestamptz not null default clock_timestamp(),
 primary key(delivery_id,attempt)
);
do $$declare t text;begin
 foreach t in array array['jobs','threads','messages','cursors','events','inbox','devices','push','push_receipts'] loop
  execute format('alter table app_private.workroom_app_%I enable row level security',t);
  execute format('alter table app_private.workroom_app_%I force row level security',t);
  execute format('revoke all on table app_private.workroom_app_%I from public,anon,authenticated,service_role',t);
 end loop;
end$$;
revoke all on sequence app_private.workroom_app_messages_seq_seq from public,anon,authenticated,service_role;
create trigger workroom_app_message_original before update or delete on app_private.workroom_app_messages for each row execute function app_private.workroom_immutable();
create trigger workroom_app_event_original before update or delete on app_private.workroom_app_events for each row execute function app_private.workroom_immutable();
create trigger workroom_app_push_original before update or delete on app_private.workroom_app_push_receipts for each row execute function app_private.workroom_immutable();

-- Same latest-role and ambiguity rule used by assert_economy_policy_admin_context.
create function app_private.workroom_app_operator(p_user uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select count(distinct r.role)=1 and coalesce(bool_and(r.role in('ADMIN','SUPER_ADMIN')),false)
 from public.user_roles r where r.user_id=p_user and r.revoked_at is null and r.granted_at=(
  select max(x.granted_at) from public.user_roles x where x.user_id=p_user and x.revoked_at is null)
$$;

-- Private caller is the canonical source trigger/command; no receiver, copy or URL from the client.
create function app_private.workroom_app_emit(p_kind text,p_source uuid,p_resource uuid,p_member uuid,p_legacy uuid default null)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare eid uuid;assignee uuid;begin
 insert into app_private.workroom_app_events(kind,source_id,resource_id,member_id,legacy_source)
 values(p_kind,p_source,p_resource,p_member,p_legacy) on conflict(kind,source_id) do nothing returning id into eid;
 if eid is null then return;end if;
 if p_kind='SUPPORT_RECEIVED' or p_kind like '%_REQUESTED' then
  if p_kind='SUPPORT_RECEIVED' then select assigned_admin_id into assignee from app_private.workroom_app_threads where id=p_resource;end if;
  if not app_private.workroom_app_operator(assignee) then assignee:=null;end if;
  insert into app_private.workroom_app_inbox(event_id,recipient,audience)
   select distinct eid,r.user_id,'ADMIN' from public.user_roles r join auth.users u on u.id=r.user_id
   where (assignee is null or r.user_id=assignee) and r.revoked_at is null and r.role in('ADMIN','SUPER_ADMIN')
    and app_private.workroom_app_operator(r.user_id) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp());
 else
  insert into app_private.workroom_app_inbox(event_id,recipient,audience) values(eid,p_member,'MEMBER');
 end if;
 insert into app_private.workroom_app_push(notification_id,subscription_id,binding_receipt,endpoint_epoch,subscription_digest,expires_at)
  select i.id,b.subscription_id,b.receipt_id,b.endpoint_epoch,b.subscription_digest,
   i.created_at+case when p_kind='ROUND_COMPLETED' then interval '6 hours' else interval '1 day' end
  from app_private.workroom_app_inbox i join app_private.workroom_app_devices d on d.user_id=i.recipient and d.audience=i.audience
  join app_private.push_subscription_bindings b on b.subscription_id=d.subscription_id and b.user_id=d.user_id and b.receipt_id=d.binding_receipt
  join public.notification_preferences p on p.user_id=i.recipient and p.web_push_enabled
  where i.event_id=eid and app_private.push_binding_send_allowed(b.subscription_id);
end$$;

create function app_private.workroom_app_round_event() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare r app_private.workroom_rounds%rowtype;begin
 if tg_table_name='workroom_rounds' then
  insert into app_private.workroom_app_jobs(round_id,member_id,due_at)
   values(new.id,new.user_id,new.started_at+make_interval(secs=>(new.snapshot->>'duration')::integer));
 else
  select * into strict r from app_private.workroom_rounds where id=new.round_id and user_id=new.user_id
   and closed_at is not null and returned=new.amount;
  update app_private.workroom_app_jobs set settled_at=r.closed_at where round_id=r.id;
  perform app_private.workroom_app_emit('ROUND_COMPLETED',new.id,r.id,r.user_id);
 end if;return new;
end$$;
create trigger workroom_app_round_job after insert on app_private.workroom_rounds for each row execute function app_private.workroom_app_round_event();
create trigger workroom_app_round_closed after insert on app_private.workroom_ledger for each row when(new.kind='SETTLEMENT') execute function app_private.workroom_app_round_event();

create function app_private.workroom_app_cash_event() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare r public.withdrawal_requests%rowtype;e uuid;begin
 if tg_table_schema='public' and tg_table_name='money_source_movements' then
  if not exists(select 1 from app_private.workroom_cash_enrollments where user_id=new.user_id) then return null;end if;
  if app_private.workroom_cash_credit(new) is not true then raise exception 'WORKROOM_CASH_SOURCE_UNVERIFIED';end if;
  select aggregate_id into strict e from public.outbox_events where id=new.source_event_id;
  perform app_private.workroom_app_emit('DEPOSIT_CONFIRMED',new.id,e,new.user_id,new.source_event_id);
 elsif tg_table_schema='public' and tg_table_name in('deposit_requests','usdt_manual_deposits') then
  if not exists(select 1 from app_private.workroom_cash_enrollments where user_id=new.user_id) then return null;end if;
  if tg_table_name='deposit_requests' then
   perform app_private.workroom_app_emit('KRW_DEPOSIT_REQUESTED',new.id,new.id,new.user_id);
  else
   select id into strict e from public.outbox_events where event_type='USDT_MANUAL_DEPOSIT_SUBMITTED.v1' and schema_version=1
    and aggregate_type='usdt_manual_deposit' and aggregate_id=new.id and actor_user_id=new.user_id
    and payload->>'tx_hash'=new.tx_hash and idempotency_key=new.idempotency_key||':event';
   perform app_private.workroom_app_emit('USDT_DEPOSIT_REQUESTED',new.id,new.id,new.user_id,e);
  end if;
 elsif tg_table_schema='app_private' and tg_table_name='workroom_cash_withdrawals' then
  select * into strict r from public.withdrawal_requests where id=new.withdrawal_id and user_id=new.user_id;
  if app_private.workroom_cash_coverage_verified(r) is not true then raise exception 'WORKROOM_CASH_SOURCE_UNVERIFIED';end if;
  select id into strict e from public.outbox_events where event_type='WITHDRAWAL_REQUESTED.v1' and schema_version=1
   and aggregate_type='withdrawal_request' and aggregate_id=r.id and actor_user_id=r.user_id and idempotency_key=r.idempotency_key||':event';
  perform app_private.workroom_app_emit(case r.destination_type when 'KRW_BANK' then 'KRW_WITHDRAWAL_REQUESTED' else 'USDT_WITHDRAWAL_REQUESTED' end,r.id,r.id,r.user_id,e);
 elsif tg_table_schema='app_private' and tg_table_name='workroom_cash_dispositions' then
  select * into strict r from public.withdrawal_requests where id=new.withdrawal_id and user_id=new.user_id;
  if app_private.workroom_cash_coverage_verified(r) is not true then raise exception 'WORKROOM_CASH_SOURCE_UNVERIFIED';end if;
  select id into strict e from public.outbox_events where aggregate_id=r.id and aggregate_type='withdrawal_request'
   and event_type=case new.phase when 'FINALIZE' then 'WITHDRAWAL_COMPLETED.v1' else 'WITHDRAWAL_HOLD_RELEASED.v1' end
   and request_id=(select request_id from public.ledger_transactions where id=new.terminal_ledger_transaction_id);
  perform app_private.workroom_app_emit(case new.phase when 'FINALIZE' then 'WITHDRAWAL_COMPLETED' else 'WITHDRAWAL_RELEASED' end,
   new.terminal_ledger_transaction_id,r.id,r.user_id,e);
 else raise exception 'WORKROOM_INVALID_SOURCE';end if;
 return null;
end$$;
create constraint trigger workroom_app_krw_requested after insert on public.deposit_requests
 deferrable initially deferred for each row when(new.currency='KRW' and new.status='AWAITING_TRANSFER') execute function app_private.workroom_app_cash_event();
create constraint trigger workroom_app_usdt_requested after insert on public.usdt_manual_deposits
 deferrable initially deferred for each row when(new.status='SUBMITTED') execute function app_private.workroom_app_cash_event();
create constraint trigger workroom_app_withdrawal_requested after insert on app_private.workroom_cash_withdrawals
 deferrable initially deferred for each row execute function app_private.workroom_app_cash_event();
create constraint trigger workroom_app_deposit_verified after insert on public.money_source_movements
 deferrable initially deferred for each row when(new.movement_kind='CREDIT' and new.origin_code in('KRW_DEPOSIT','USDT_KRW_DEPOSIT'))
 execute function app_private.workroom_app_cash_event();
create constraint trigger workroom_app_withdrawal_verified after insert on app_private.workroom_cash_dispositions
 deferrable initially deferred for each row execute function app_private.workroom_app_cash_event();


insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('workroom-support-attachments','workroom-support-attachments',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy workroom_support_storage_server_boundary on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'workroom-support-attachments') with check(bucket_id<>'workroom-support-attachments');
create table app_private.workroom_app_attachments (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 audience text not null check(audience in('MEMBER','ADMIN')), media_type text not null check(media_type in('image/jpeg','image/png','image/webp')),
 size_bytes integer not null check(size_bytes between 1 and 5242880), object_id uuid, message_id uuid references app_private.workroom_app_messages(id),
 created_at timestamptz not null default clock_timestamp(), unique(object_id)
);
create index workroom_app_attachment_message on app_private.workroom_app_attachments(message_id);
alter table app_private.workroom_app_attachments enable row level security;
alter table app_private.workroom_app_attachments force row level security;
revoke all on app_private.workroom_app_attachments from public,anon,authenticated,service_role;

create function app_private.workroom_app_thread_dto(t app_private.workroom_app_threads,p_reader uuid,p_audience text,
 p_messages integer default 0,p_before bigint default null) returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('id',t.id,'memberId',t.member_id,'memberLoginId',i.login_id,'memberName',coalesce(i.legal_name,a.name),
  'status',t.status,'assignedAdminId',t.assigned_admin_id,'updatedAt',t.updated_at,
  'unreadCount',(select count(*) from app_private.workroom_app_messages m where m.thread_id=t.id and m.sender_role<>p_audience
   and m.seq>coalesce((select c.seq from app_private.workroom_app_cursors c where c.thread_id=t.id and c.reader=p_reader and c.audience=p_audience),0)),
  'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threadId',m.thread_id,'senderRole',m.sender_role,
   'body',m.body,'createdAt',m.created_at,'attachments',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,
   'mediaType',f.media_type,'sizeBytes',f.size_bytes) order by f.id) from app_private.workroom_app_attachments f where f.message_id=m.id),'[]'::jsonb))
   order by m.seq) from(select * from app_private.workroom_app_messages where thread_id=t.id
    and (p_before is null or seq<p_before) order by seq desc limit p_messages)m),'[]'::jsonb))
 from app_private.workroom_accounts a left join public.user_identity_profiles i on i.user_id=a.user_id where a.user_id=t.member_id
$$;

create function app_private.workroom_app_input(p_input jsonb,p_keys text[],p_required text[] default '{}')
 returns void language plpgsql immutable security invoker set search_path=pg_catalog as $$begin
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>16384
  or (p_input-p_keys)<>'{}'::jsonb or not(p_input ?& p_required)
  or exists(select 1 from jsonb_each(p_input) x where jsonb_typeof(x.value)='null'
   or (x.key in('threadId','cursor','id','messageId','subscriptionId','memberId','roundId','deliveryId','leaseToken') and
       (jsonb_typeof(x.value)<>'string' or x.value#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
   or (x.key in('body','filter','mediaType','workerId','status') and jsonb_typeof(x.value)<>'string')
   or (x.key in('limit','leaseSeconds','attempt','sizeBytes') and (jsonb_typeof(x.value)<>'number' or x.value::text!~'^[0-9]{1,8}$')))
 then raise exception 'WORKROOM_INVALID_INPUT';end if;
end$$;

create function app_private.workroom_app_support_read(p_reader uuid,p_audience text,p_input jsonb) returns jsonb
 language plpgsql stable security invoker set search_path=pg_catalog as $$
declare tid uuid;cursor_id uuid;n integer;mode text;thread app_private.workroom_app_threads%rowtype;
 cutoff timestamptz;before_seq bigint;page_ids uuid[];items jsonb;next_id uuid;begin
 perform app_private.workroom_app_input(p_input,array['threadId','cursor','limit','filter']);
 tid:=(p_input->>'threadId')::uuid;cursor_id:=(p_input->>'cursor')::uuid;n:=coalesce((p_input->>'limit')::int,25);mode:=coalesce(p_input->>'filter','ALL');
 if n not between 1 and 50 or mode not in('ALL','UNANSWERED','MINE','RESOLVED') then raise exception 'WORKROOM_INVALID_INPUT';end if;
 if tid is not null then
  select * into thread from app_private.workroom_app_threads where id=tid and (p_audience='ADMIN' or member_id=p_reader);
  if not found then raise exception 'WORKROOM_THREAD_NOT_FOUND';end if;
  if cursor_id is not null then
   select seq into before_seq from app_private.workroom_app_messages where id=cursor_id and thread_id=tid;
   if not found then raise exception 'WORKROOM_INVALID_CURSOR';end if;
  end if;
  items:=jsonb_build_array(app_private.workroom_app_thread_dto(thread,p_reader,p_audience,n,before_seq));
  select array_agg(m.id order by m.seq desc) into page_ids from(select id,seq from app_private.workroom_app_messages
   where thread_id=tid and (before_seq is null or seq<before_seq) order by seq desc limit n+1)m;
 else
  if cursor_id is not null then
   select updated_at into cutoff from app_private.workroom_app_threads where id=cursor_id and(p_audience='ADMIN' or member_id=p_reader);
   if not found then raise exception 'WORKROOM_INVALID_CURSOR';end if;
  end if;
  select array_agg(q.id order by q.updated_at desc,q.id desc) into page_ids from(
   select t.id,t.updated_at from app_private.workroom_app_threads t where(p_audience='ADMIN' or t.member_id=p_reader)
    and (cursor_id is null or (t.updated_at,t.id)<(cutoff,cursor_id)) and(case mode when 'UNANSWERED' then t.status in('OPEN','ASSIGNED')
    when 'MINE' then t.assigned_admin_id=p_reader when 'RESOLVED' then t.status='RESOLVED' else true end)
   order by t.updated_at desc,t.id desc limit n+1)q;
  select coalesce(jsonb_agg(app_private.workroom_app_thread_dto(t,p_reader,p_audience) order by pos),'[]'::jsonb) into items
   from unnest(page_ids[1:n]) with ordinality k(id,pos) join app_private.workroom_app_threads t on t.id=k.id;
 end if;
 if cardinality(page_ids)>n then next_id:=page_ids[n];end if;
 return jsonb_build_object('items',items,'nextCursor',next_id);
end$$;

-- The unified read projection also includes previous, scheduled/expiry-eligible member notifications.
-- Preserve historical originals. Hide the older projection of a cash source already shown in this inbox.
create function app_private.workroom_app_feed(p_reader uuid,p_audience text)
 returns table(id uuid,kind text,title text,body text,route text,created_at timestamptz,read_at timestamptz)
 language sql stable security invoker set search_path=pg_catalog as $$
 select i.id,e.kind,case e.kind when 'SUPPORT_RECEIVED' then '새 1:1 문의가 도착했어요' when 'SUPPORT_ANSWERED' then '문의에 답변이 도착했어요'
  when 'KRW_DEPOSIT_REQUESTED' then '원화 입금 신청이 도착했어요' when 'USDT_DEPOSIT_REQUESTED' then 'USDT 입금 신청이 도착했어요'
  when 'KRW_WITHDRAWAL_REQUESTED' then '원화 출금 신청이 도착했어요' when 'USDT_WITHDRAWAL_REQUESTED' then 'USDT 출금 신청이 도착했어요'
  when 'ROUND_COMPLETED' then '워크룸 참여가 종료됐어요' when 'DEPOSIT_CONFIRMED' then '입금이 확인됐어요'
  when 'WITHDRAWAL_COMPLETED' then '출금이 완료됐어요' else '출금 요청 상태가 변경됐어요' end,
  case when e.kind like 'SUPPORT_%' then '문의함에서 대화를 확인해 주세요.' when e.kind='ROUND_COMPLETED' then '참여 내역에서 확정된 결과를 확인해 주세요.'
   else '입출금 내역에서 확인해 주세요.' end,
  case e.kind when 'SUPPORT_RECEIVED' then '/support?thread='||e.resource_id when 'SUPPORT_ANSWERED' then '/workroom/support?thread='||e.resource_id
   when 'KRW_DEPOSIT_REQUESTED' then '/deposits/krw/'||e.resource_id when 'USDT_DEPOSIT_REQUESTED' then '/deposits/usdt'
   when 'KRW_WITHDRAWAL_REQUESTED' then '/withdrawals/krw-bank' when 'USDT_WITHDRAWAL_REQUESTED' then '/withdrawals/usdt'
   when 'ROUND_COMPLETED' then '/workroom/history?round='||e.resource_id else '/workroom/cash' end,i.created_at,i.read_at
 from app_private.workroom_app_inbox i join app_private.workroom_app_events e on e.id=i.event_id where i.recipient=p_reader and i.audience=p_audience
 union all
 select n.id,n.category,n.title_ko,n.body_ko,coalesce(n.route,'/notifications'),n.created_at,n.read_at from public.notifications n
 where p_audience='MEMBER' and n.user_id=p_reader and n.scheduled_at<=statement_timestamp()
 and(n.expires_at is null or n.expires_at>statement_timestamp()) and not exists(select 1 from app_private.workroom_app_events e
  where e.legacy_source=n.source_event_id and e.member_id=p_reader and e.kind in('DEPOSIT_CONFIRMED','WITHDRAWAL_COMPLETED','WITHDRAWAL_RELEASED'))
$$;
create index workroom_app_legacy_source on app_private.workroom_app_events(legacy_source) where legacy_source is not null;
create function app_private.workroom_app_inbox_read(p_reader uuid,p_audience text,p_input jsonb,p_mark boolean default false)
 returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare item record;target uuid;n integer;ids uuid[];items jsonb;unread bigint;cutoff timestamptz;begin
 if p_mark then
  perform app_private.workroom_app_input(p_input,array['id'],array['id']);target:=(p_input->>'id')::uuid;
  select * into item from app_private.workroom_app_feed(p_reader,p_audience) f where f.id=target;
  if not found then raise exception 'WORKROOM_NOTIFICATION_NOT_FOUND';end if;
  update app_private.workroom_app_inbox set read_at=coalesce(read_at,clock_timestamp()) where id=target and recipient=p_reader and audience=p_audience;
  if not found and p_audience='MEMBER' then
   update public.notifications set read_at=coalesce(read_at,clock_timestamp()) where id=target and user_id=p_reader;
  end if;
  select * into strict item from app_private.workroom_app_feed(p_reader,p_audience) f where id=target;
  return jsonb_build_object('item',jsonb_build_object('id',item.id,'type',item.kind,'title',item.title,'body',item.body,'route',item.route,
    'createdAt',item.created_at,'readAt',item.read_at));
 end if;
 perform app_private.workroom_app_input(p_input,array['cursor','limit']);
 target:=(p_input->>'cursor')::uuid;n:=coalesce((p_input->>'limit')::int,25);
 if n not between 1 and 50 then raise exception 'WORKROOM_INVALID_INPUT';end if;
 if target is not null then
  select f.created_at into cutoff from app_private.workroom_app_feed(p_reader,p_audience) f where f.id=target;
  if not found then raise exception 'WORKROOM_INVALID_CURSOR';end if;
 end if;
 with feed as materialized (select * from app_private.workroom_app_feed(p_reader,p_audience)),
 page as(select * from feed f where target is null or (f.created_at,f.id)<(cutoff,target) order by created_at desc,id desc limit n+1),
 numbered as(select *,row_number() over(order by created_at desc,id desc) as pos from page)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'type',kind,'title',title,'body',body,'route',route,'createdAt',created_at,'readAt',read_at)
  order by pos) filter(where pos<=n),'[]'::jsonb),array_agg(id order by pos),(select count(*) from feed where read_at is null)
 into items,ids,unread from numbered;
 return jsonb_build_object('items',items,'unreadCount',unread,'nextCursor',case when cardinality(ids)>n then ids[n] end);
end$$;


create function app_private.workroom_app_command(p_reader uuid,p_audience text,p_op text,p_key text,p_input jsonb,p_session uuid)
 returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare t app_private.workroom_app_threads%rowtype;m app_private.workroom_app_messages%rowtype;
 f app_private.workroom_app_attachments%rowtype;b app_private.push_subscription_bindings%rowtype;
 saved app_private.workroom_receipts%rowtype;hash text;scope_name text:='APP_'||p_audience;result jsonb;
 tid uuid;n integer;attachments uuid[];oid_value uuid;path_value text;begin
 if p_op is null or p_op not in('SUPPORT_READ','SUPPORT_SEEN','SUPPORT_SEND','SUPPORT_REPLY','SUPPORT_ASSIGN','SUPPORT_RESOLVE',
  'NOTIFICATIONS_READ','NOTIFICATION_READ','PUSH_BIND_MEMBER','PUSH_BIND_ADMIN','ATTACHMENT_PREPARE','ATTACHMENT_COMMIT','ATTACHMENT_READ')
  or(p_audience='ADMIN' and p_op in('SUPPORT_SEND','PUSH_BIND_MEMBER')) or(p_audience='MEMBER' and p_op in('SUPPORT_REPLY','SUPPORT_ASSIGN','SUPPORT_RESOLVE','PUSH_BIND_ADMIN'))
  then raise exception 'WORKROOM_INVALID_INPUT';end if;
 if p_op='SUPPORT_READ' then return app_private.workroom_app_support_read(p_reader,p_audience,p_input);end if;
 if p_op='NOTIFICATIONS_READ' then return app_private.workroom_app_inbox_read(p_reader,p_audience,p_input);end if;
 if p_op='ATTACHMENT_READ' then
  perform app_private.workroom_app_input(p_input,array['id'],array['id']);
  select a.* into f from app_private.workroom_app_attachments a join app_private.workroom_app_messages msg on msg.id=a.message_id
   join app_private.workroom_app_threads thread on thread.id=msg.thread_id where a.id=(p_input->>'id')::uuid and(p_audience='ADMIN' or thread.member_id=p_reader);
  if not found then raise exception 'WORKROOM_ATTACHMENT_NOT_FOUND';end if;
  path_value:=f.owner_id::text||'/'||f.id::text;
  if not exists(select 1 from storage.objects o where o.id=f.object_id and o.bucket_id='workroom-support-attachments' and o.name=path_value
   and o.metadata->>'mimetype'=f.media_type and o.metadata->>'size'=f.size_bytes::text) then raise exception 'WORKROOM_ATTACHMENT_NOT_FOUND';end if;
  return jsonb_build_object('id',f.id,'path',path_value,'mediaType',f.media_type,'sizeBytes',f.size_bytes);
 end if;
 if p_key is null or p_key!~'^[A-Za-z0-9_-]{8,200}$' or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>16384
  then raise exception 'WORKROOM_INVALID_INPUT';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_op,p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('workroom:app:'||p_audience||':'||p_reader::text,0));
 select * into saved from app_private.workroom_receipts where actor=p_reader and scope=scope_name and request_key=p_key;
 if found then
  if saved.digest<>hash then raise exception 'WORKROOM_REQUEST_CONFLICT';end if;return saved.result;
 end if;
 if p_op='NOTIFICATION_READ' then result:=app_private.workroom_app_inbox_read(p_reader,p_audience,p_input,true);
 elsif p_op like 'PUSH_BIND_%' then
  perform app_private.workroom_app_input(p_input,array['subscriptionId'],array['subscriptionId']);
  perform pg_advisory_xact_lock(hashtextextended('putduk-push-recipient:'||p_reader::text,0));
  select * into b from app_private.push_subscription_bindings where subscription_id=(p_input->>'subscriptionId')::uuid
   and user_id=p_reader and auth_session_id::text=auth.jwt()->>'session_id' and app_private.push_binding_send_allowed(subscription_id);
  if not found then raise exception 'WORKROOM_DEVICE_BINDING_REQUIRED';end if;
  insert into app_private.workroom_app_devices(subscription_id,user_id,audience,binding_receipt,admin_session_id)
   values(b.subscription_id,p_reader,p_audience,b.receipt_id,p_session)
   on conflict(subscription_id) do update set audience=excluded.audience,binding_receipt=excluded.binding_receipt,
    admin_session_id=excluded.admin_session_id where app_private.workroom_app_devices.user_id=excluded.user_id
    and app_private.workroom_app_devices.audience=excluded.audience;
  if not found then raise exception 'WORKROOM_DEVICE_AUDIENCE_CONFLICT';end if;
  result:=jsonb_build_object('bound',true);
 elsif p_op='ATTACHMENT_PREPARE' then
  perform app_private.workroom_app_input(p_input,array['mediaType','sizeBytes'],array['mediaType','sizeBytes']);
  if p_input->>'mediaType' not in('image/jpeg','image/png','image/webp') or (p_input->>'sizeBytes')::int not between 1 and 5242880
   then raise exception 'WORKROOM_INVALID_INPUT';end if;
  insert into app_private.workroom_app_attachments(owner_id,audience,media_type,size_bytes)
   values(p_reader,p_audience,p_input->>'mediaType',(p_input->>'sizeBytes')::int) returning * into f;
  result:=jsonb_build_object('id',f.id,'path',p_reader::text||'/'||f.id::text);
 elsif p_op='ATTACHMENT_COMMIT' then
  perform app_private.workroom_app_input(p_input,array['id'],array['id']);
  select * into f from app_private.workroom_app_attachments where id=(p_input->>'id')::uuid and owner_id=p_reader and audience=p_audience for update;
  if not found then raise exception 'WORKROOM_ATTACHMENT_NOT_FOUND';end if;
  select id into oid_value from storage.objects where bucket_id='workroom-support-attachments' and name=p_reader::text||'/'||f.id::text
   and metadata->>'mimetype'=f.media_type and metadata->>'size'=f.size_bytes::text;
  if oid_value is null or (f.object_id is not null and oid_value<>f.object_id) then raise exception 'WORKROOM_ATTACHMENT_NOT_VERIFIED';end if;
  update app_private.workroom_app_attachments set object_id=oid_value where id=f.id;
  result:=jsonb_build_object('id',f.id);
 else
  if p_op='SUPPORT_SEND' then perform app_private.workroom_app_input(p_input,array['body','threadId','attachmentIds'],array['body']);
  elsif p_op='SUPPORT_REPLY' then perform app_private.workroom_app_input(p_input,array['body','threadId','attachmentIds'],array['body','threadId']);
  elsif p_op='SUPPORT_SEEN' then perform app_private.workroom_app_input(p_input,array['threadId','messageId'],array['threadId','messageId']);
  else perform app_private.workroom_app_input(p_input,array['threadId'],array['threadId']);end if;
  tid:=(p_input->>'threadId')::uuid;
  if tid is null then
   insert into app_private.workroom_app_threads(member_id) values(p_reader) returning * into t;
  else
   select * into t from app_private.workroom_app_threads where id=tid and(p_audience='ADMIN' or member_id=p_reader) for update;
   if not found then raise exception 'WORKROOM_THREAD_NOT_FOUND';end if;
  end if;
  if p_op in('SUPPORT_REPLY','SUPPORT_SEND') then
   if length(btrim(p_input->>'body')) not between 1 and 2000 then raise exception 'WORKROOM_INVALID_INPUT';end if;
   if p_input?'attachmentIds' then
    if jsonb_typeof(p_input->'attachmentIds')<>'array' or jsonb_array_length(p_input->'attachmentIds') not between 1 and 3 then raise exception 'WORKROOM_INVALID_INPUT';end if;
    select array_agg(value::uuid) into attachments from jsonb_array_elements_text(p_input->'attachmentIds');
   end if;
   insert into app_private.workroom_app_messages(thread_id,sender,sender_role,body) values(t.id,p_reader,p_audience,btrim(p_input->>'body')) returning * into m;
   if attachments is not null then
    update app_private.workroom_app_attachments set message_id=m.id where id=any(attachments) and message_id is null and object_id is not null
     and owner_id=p_reader and audience=p_audience;
    get diagnostics n=row_count;if n<>cardinality(attachments) then raise exception 'WORKROOM_ATTACHMENT_NOT_VERIFIED';end if;
   end if;
   update app_private.workroom_app_threads set status=case when p_audience='ADMIN' then 'ANSWERED' when assigned_admin_id is null then 'OPEN' else 'ASSIGNED' end,
    assigned_admin_id=case when p_audience='ADMIN' then coalesce(assigned_admin_id,p_reader) else assigned_admin_id end,updated_at=m.created_at where id=t.id returning * into t;
   perform app_private.workroom_app_emit(case when p_audience='ADMIN' then 'SUPPORT_ANSWERED' else 'SUPPORT_RECEIVED' end,m.id,t.id,t.member_id);
  elsif p_op='SUPPORT_SEEN' then
   select * into m from app_private.workroom_app_messages where id=(p_input->>'messageId')::uuid and thread_id=t.id;
   if not found then raise exception 'WORKROOM_MESSAGE_NOT_FOUND';end if;
   insert into app_private.workroom_app_cursors(thread_id,reader,audience,seq) values(t.id,p_reader,p_audience,m.seq)
    on conflict(thread_id,reader,audience) do update set seq=greatest(app_private.workroom_app_cursors.seq,excluded.seq);
  else
   update app_private.workroom_app_threads set status=case p_op when 'SUPPORT_ASSIGN' then 'ASSIGNED' else 'RESOLVED' end,
    assigned_admin_id=case p_op when 'SUPPORT_ASSIGN' then p_reader else assigned_admin_id end,updated_at=clock_timestamp() where id=t.id returning * into t;
   insert into app_private.workroom_audit(actor,operation,target,input) values(p_reader,p_op,t.id::text,'{}');
  end if;
  result:=jsonb_build_object('thread',app_private.workroom_app_thread_dto(t,p_reader,p_audience,25));
 end if;
 insert into app_private.workroom_receipts(actor,scope,request_key,digest,result) values(p_reader,scope_name,p_key,hash,result);
 return result;
end$$;

create function public.workroom_app_member(p_operation text,p_request_key text,p_input jsonb) returns jsonb
 language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid:=app_private.workroom_assert_member();r app_private.workroom_rounds%rowtype;begin
 if not exists(select 1 from app_private.workroom_accounts where user_id=u) then raise exception 'WORKROOM_OPEN_REQUIRED';end if;
 if p_operation='ROUND_READ' then
  perform app_private.workroom_app_input(p_input,array['roundId'],array['roundId']);
  select * into r from app_private.workroom_rounds where id=(p_input->>'roundId')::uuid and user_id=u and closed_at is not null;
  if not found then raise exception 'WORKROOM_ROUND_NOT_FOUND';end if;
  return jsonb_build_object('round',app_private.workroom_round_json(r));
 end if;
 return app_private.workroom_app_command(u,'MEMBER',p_operation,p_request_key,p_input,null);
end$$;
create function public.workroom_app_admin(p_operation text,p_request_key text,p_input jsonb,p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog as $$begin
 perform app_private.workroom_assert_admin(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 return app_private.workroom_app_command(p_actor,'ADMIN',p_operation,p_request_key,p_input,p_admin_session_id);
end$$;


-- Check actual origin marker, immutable binding generation and live session at both lease and send boundaries.
create function app_private.workroom_app_available(d app_private.workroom_app_push,at_time timestamptz)
 returns timestamptz language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare ctx record;p public.notification_preferences%rowtype;kind text;local_now timestamp;begin
 select pref as preference,e.kind into ctx from public.notification_preferences pref
 join app_private.workroom_app_inbox i on i.recipient=pref.user_id
 join app_private.workroom_app_events e on e.id=i.event_id
 join app_private.workroom_app_devices device on device.user_id=i.recipient and device.audience=i.audience
  and device.subscription_id=d.subscription_id and device.binding_receipt=d.binding_receipt
 join app_private.push_subscription_bindings b on b.subscription_id=device.subscription_id and b.user_id=device.user_id
  and b.receipt_id=d.binding_receipt and b.endpoint_epoch=d.endpoint_epoch and b.subscription_digest=d.subscription_digest
 where i.id=d.notification_id and i.read_at is null and pref.web_push_enabled
  and app_private.push_binding_send_allowed(d.subscription_id) and d.expires_at>at_time
  and(i.audience='MEMBER' or (app_private.workroom_app_operator(i.recipient) and exists(
   select 1 from public.admin_sessions a join auth.sessions s on s.id=b.auth_session_id and s.user_id=a.user_id
   join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id and f.factor_type='totp' and f.status='verified'
   join auth.mfa_amr_claims amr on amr.session_id=s.id and amr.authentication_method='totp'
   where a.id=device.admin_session_id and a.user_id=i.recipient and a.auth_session_id=s.id::text and a.revoked_at is null
    and least(a.idle_expires_at,a.absolute_expires_at)>at_time and s.aal='aal2')));
 if not found then return null;end if;
 p:=ctx.preference;kind:=ctx.kind;
 if (case when kind='ROUND_COMPLETED' then p.mining_enabled when kind like 'SUPPORT_%' then p.service_enabled else p.wallet_enabled end) is not true
  or not exists(select 1 from pg_timezone_names where name=p.timezone) then return null;end if;
 if p.quiet_hours_start is null and p.quiet_hours_end is null then return at_time;end if;
 if p.quiet_hours_start is null or p.quiet_hours_end is null then return null;end if;
 local_now:=at_time at time zone p.timezone;
 if p.quiet_hours_start=p.quiet_hours_end then return at_time+interval '1 day';end if;
 if (p.quiet_hours_start<p.quiet_hours_end and local_now::time>=p.quiet_hours_start and local_now::time<p.quiet_hours_end)
  or(p.quiet_hours_start>p.quiet_hours_end and(local_now::time>=p.quiet_hours_start or local_now::time<p.quiet_hours_end)) then
  return ((local_now::date+p.quiet_hours_end)+case when local_now::time>=p.quiet_hours_end then interval '1 day' else interval '0 days' end) at time zone p.timezone;
 end if;return at_time;
end$$;

create function app_private.workroom_app_transport(op text,args jsonb) returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare d app_private.workroom_app_push%rowtype;receipt app_private.workroom_app_push_receipts%rowtype;s public.push_subscriptions%rowtype;
 at_time timestamptz;ready timestamptz;worker text:=args->>'workerId';token uuid;attempt_value int;http int;outcome text;code text;final text;
 recipient uuid;ttl int;begin
 if worker is null or worker!~'^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$' then raise exception 'PUSH_WORKER_INVALID';end if;
 if op='CLAIM_PUSH' then
  perform app_private.workroom_app_input(args,array['workerId','leaseSeconds'],array['workerId','leaseSeconds']);
  ttl:=(args->>'leaseSeconds')::int;if ttl not between 15 and 300 then raise exception 'WORKROOM_INVALID_INPUT';end if;
  for d in select x.* from app_private.workroom_app_push x where (x.status in('PENDING','RETRY') and x.available_at<=clock_timestamp())
   or(x.status='LEASED' and x.lease_expires<=clock_timestamp()) order by x.available_at,x.id limit 100 for update skip locked loop
   at_time:=clock_timestamp();
   if d.status='LEASED' then
    insert into app_private.workroom_app_push_receipts values(d.id,d.attempt,d.worker,d.token,'UNKNOWN',null,'PUSH_LEASE_EXPIRED','RETRY',at_time);
   end if;
   ready:=app_private.workroom_app_available(d,at_time);
   if ready is null or ready>=d.expires_at or d.attempt>=12 then
    update app_private.workroom_app_push set status=case when d.attempt>=12 then 'FAILED' else 'CANCELLED' end,worker=null,token=null,lease_expires=null where id=d.id;continue;
   elsif ready>at_time then
    update app_private.workroom_app_push set status='RETRY',available_at=ready,worker=null,token=null,lease_expires=null where id=d.id;continue;
   end if;
   select * into strict s from public.push_subscriptions where id=d.subscription_id;
   update app_private.workroom_app_push set status='LEASED',attempt=attempt+1,worker=args->>'workerId',
    token=gen_random_uuid(),lease_expires=at_time+make_interval(secs=>ttl) where id=d.id returning * into d;
   return jsonb_build_array(jsonb_build_object('deliveryId',d.id,'notificationId',d.notification_id,'workerId',worker,
    'leaseToken',d.token,'attempt',d.attempt,'leaseExpiresAt',d.lease_expires,
    'subscription',jsonb_build_object('endpoint',s.endpoint,'p256dh',s.p256dh,'authSecret',s.auth_secret),
    'payload',jsonb_build_object('notificationId',d.notification_id,'route','/notifications','title','퍼뜩','body','새 알림을 확인해 주세요.')));
  end loop;return '[]'::jsonb;
 end if;
 if op='ACK_PUSH' then
  if not(args?&array['status','httpStatus','errorCode']) then raise exception 'PUSH_SETTLEMENT_INVALID';end if;
  perform app_private.workroom_app_input(args-array['httpStatus','errorCode'],array['workerId','deliveryId','leaseToken','attempt','status'],array['workerId','deliveryId','leaseToken','attempt','status']);
  outcome:=args->>'status';code:=args->>'errorCode';http:=(args->>'httpStatus')::int;
  if jsonb_typeof(args->'httpStatus') not in('number','null') or jsonb_typeof(args->'errorCode') not in('string','null')
   or code!~'^[A-Z_]{1,80}$' or http not between 100 and 599 or outcome not in('ACCEPTED','EXPIRED','RETRY','REJECTED','ABORTED','UNKNOWN')
   or(outcome='ACCEPTED' and(http is null or http not in(201,202) or code is not null))
   or(outcome='EXPIRED' and(http is null or http not in(404,410)))
   or(outcome='RETRY' and(http is null or not(http in(408,429) or http>=500)))
   or(outcome='REJECTED' and(http is null or http>=500 or http in(201,202,408,429,404,410)))
   or(outcome in('ABORTED','UNKNOWN') and http is not null) then raise exception 'PUSH_SETTLEMENT_INVALID';end if;
 else
  perform app_private.workroom_app_input(args,array['workerId','deliveryId','leaseToken','attempt'],array['workerId','deliveryId','leaseToken','attempt']);
 end if;
 token:=(args->>'leaseToken')::uuid;attempt_value:=(args->>'attempt')::int;
 select * into d from app_private.workroom_app_push where id=(args->>'deliveryId')::uuid for update;
 if op='ACK_PUSH' then
  select * into receipt from app_private.workroom_app_push_receipts where delivery_id=d.id and attempt=attempt_value;
  if found then
   if row(receipt.worker,receipt.token,receipt.outcome,receipt.http_status,receipt.error_code) is distinct from row(worker,token,outcome,http,code) then raise exception 'PUSH_RECEIPT_CONFLICT';end if;
   return jsonb_build_object('deliveryId',d.id,'status',receipt.result);
  end if;
 end if;
 at_time:=clock_timestamp();
 if d.id is null or d.status<>'LEASED' or d.token is distinct from token or d.worker is distinct from worker
  or d.attempt<>attempt_value or d.lease_expires<=at_time then raise exception 'PUSH_LEASE_STALE';end if;
 select i.recipient into strict recipient from app_private.workroom_app_inbox i where id=d.notification_id;
 if op='ADMIT_PUSH' then
  if pg_try_advisory_xact_lock(hashtextextended('putduk-push-recipient:'||recipient::text,0)) then ready:=app_private.workroom_app_available(d,at_time);end if;
  return jsonb_build_object('deliveryId',d.id,'allowed',coalesce(ready<=at_time,false));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-push-recipient:'||recipient::text,0));
 ready:=app_private.workroom_app_available(d,at_time);
 if outcome='EXPIRED' then
  update public.push_subscriptions sub set revoked_at=at_time where sub.id=d.subscription_id and sub.user_id=recipient and sub.revoked_at is null
   and app_private.push_subscription_digest(sub.id)=d.subscription_digest and exists(select 1 from app_private.push_subscription_bindings b
    where b.subscription_id=sub.id and b.receipt_id=d.binding_receipt and b.endpoint_epoch=d.endpoint_epoch);
 end if;
 final:=case when outcome='ACCEPTED' then 'ACCEPTED' when outcome='EXPIRED' then 'EXPIRED' when ready is null then 'CANCELLED'
  when outcome='REJECTED' or attempt_value>=12 then 'FAILED' else 'RETRY' end;
 insert into app_private.workroom_app_push_receipts values(d.id,d.attempt,worker,token,outcome,http,code,final,at_time);
 update app_private.workroom_app_push set status=final,worker=null,token=null,lease_expires=null,
  available_at=greatest(ready,at_time+make_interval(secs=>least(3600,30*(2^least(attempt_value-1,7))::int))) where id=d.id;
 return jsonb_build_object('deliveryId',d.id,'status',final);
end$$;

create function public.workroom_app_worker(p_operation text,p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j app_private.workroom_app_jobs%rowtype;member uuid;rid uuid;n int;total int:=0;items jsonb;begin
 perform app_private.assert_push_worker_context();
 if p_operation in('CLAIM_PUSH','ADMIT_PUSH','ACK_PUSH') then return app_private.workroom_app_transport(p_operation,p_input);end if;
 if p_operation='DUE' then perform app_private.workroom_app_input(p_input,array['memberId','limit']);
 elsif p_operation='RECOVER' then perform app_private.workroom_app_input(p_input,array['memberId','roundId','limit']);
 else raise exception 'WORKROOM_INVALID_INPUT';end if;
 member:=(p_input->>'memberId')::uuid;rid:=(p_input->>'roundId')::uuid;n:=coalesce((p_input->>'limit')::int,25);
 if n not between 1 and 100 then raise exception 'WORKROOM_INVALID_INPUT';end if;
 if p_operation='DUE' then
  select coalesce(jsonb_agg(jsonb_build_object('memberId',x.member_id,'roundId',x.round_id,'dueAt',x.due_at,'generation',x.round_id)
   order by x.due_at,x.round_id),'[]'::jsonb) into items from(
   select * from app_private.workroom_app_jobs where settled_at is null and(member is null or member_id=member) order by due_at,round_id limit n)x;
  return jsonb_build_object('jobs',items);
 end if;
 -- Lock sequence is identical to the public SYNC/FINISH path. Never take the job row lock first.
 for j in select * from app_private.workroom_app_jobs where settled_at is null and due_at<=clock_timestamp()
  and(member is null or member_id=member) and(rid is null or round_id=rid) order by member_id,round_id limit n loop
  perform pg_advisory_xact_lock(hashtextextended('workroom:member:'||j.member_id::text,0));
  perform 1 from app_private.workroom_accounts where user_id=j.member_id for update;
  perform 1 from app_private.workroom_rounds r where r.id=j.round_id and r.user_id=j.member_id and closed_at is null
   and r.started_at+make_interval(secs=>(r.snapshot->>'duration')::integer)<=clock_timestamp() for update;
  if found then perform app_private.workroom_settle(j.member_id,j.round_id);total:=total+1;end if;
 end loop;
 return jsonb_build_object('settled',total);
end$$;
do $$declare p regprocedure;begin
 for p in select oid::regprocedure from pg_proc where pronamespace='app_private'::regnamespace
 and left(proname,13)='workroom_app_' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',p);end loop;
end$$;
revoke all on function public.workroom_app_member(text,text,jsonb),public.workroom_app_admin(text,text,jsonb,uuid,uuid,text,text),
 public.workroom_app_worker(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.workroom_app_member(text,text,jsonb),public.workroom_app_admin(text,text,jsonb,uuid,uuid,text,text) to authenticated;
grant execute on function public.workroom_app_worker(text,jsonb) to service_role;
commit;
