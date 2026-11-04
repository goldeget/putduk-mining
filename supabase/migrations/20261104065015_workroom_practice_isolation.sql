begin;
-- Cutover is serialized against auth inserts: every preexisting UUID is captured,
-- every later identity must atomically consume an invitation. No identity is changed.
lock table auth.users in share row exclusive mode;
create table app_private.workroom_cohort(user_id uuid primary key references auth.users(id),captured_at timestamptz not null default clock_timestamp());
insert into app_private.workroom_cohort(user_id) select id from auth.users;
create table app_private.workroom_invites(id uuid primary key default gen_random_uuid(),code text not null unique,label text not null default '',max_uses integer not null check(max_uses between 1 and 1000),used integer not null default 0 check(used>=0 and used<=max_uses),enabled boolean not null default true,expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp());
create table app_private.workroom_accounts(user_id uuid primary key references auth.users(id),name text not null check(length(name) between 1 and 40),balance bigint not null check(balance between 0 and 9000000000000),room text not null,referral text,created_at timestamptz not null default clock_timestamp());
create table app_private.workroom_config(instrument text primary key check(instrument in('usd','cny','jpy','nvda','tsla','msft','ndx','skh','samsung','lg')),pattern text not null check(pattern in('wave','slow','balanced')),roi numeric not null check(roi between -50 and 50),duration integer not null check(duration between 30 and 3600),amplitude numeric not null check(amplitude between 0 and 15),version integer not null check(version>0));
insert into app_private.workroom_config select i,'wave',2.4,120,1.2,1 from unnest(array['usd','cny','jpy','nvda','tsla','msft','ndx','skh','samsung','lg'])i;
create table app_private.workroom_rounds(id uuid primary key default gen_random_uuid(),user_id uuid not null references app_private.workroom_accounts(user_id),instrument text not null references app_private.workroom_config(instrument),stake bigint not null check(stake>0),snapshot jsonb not null,started_at timestamptz not null default clock_timestamp(),closed_at timestamptz,returned bigint check(returned>=0),check((closed_at is null and returned is null) or (closed_at is not null and returned is not null)));
create unique index workroom_one_active_round on app_private.workroom_rounds(user_id) where closed_at is null;
create index workroom_round_history on app_private.workroom_rounds(user_id,started_at desc,id);
create table app_private.workroom_ledger(id uuid primary key default gen_random_uuid(),user_id uuid not null references app_private.workroom_accounts(user_id),amount bigint not null,balance_after bigint not null check(balance_after>=0),kind text not null check(kind in('WELCOME','STAKE','SETTLEMENT','GRANT')),note text not null,round_id uuid references app_private.workroom_rounds(id),created_at timestamptz not null default clock_timestamp());
create unique index workroom_welcome_once on app_private.workroom_ledger(user_id) where kind='WELCOME';
create unique index workroom_round_effect_once on app_private.workroom_ledger(round_id,kind) where round_id is not null;
create index workroom_ledger_history on app_private.workroom_ledger(user_id,created_at desc,id);
create table app_private.workroom_receipts(actor uuid not null references auth.users(id),scope text not null,request_key text not null,digest text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor,scope,request_key));
create table app_private.workroom_audit(id uuid primary key default gen_random_uuid(),actor uuid not null references auth.users(id),operation text not null,target text,input jsonb not null,created_at timestamptz not null default clock_timestamp());
create function app_private.workroom_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin raise exception 'WORKROOM_APPEND_ONLY';end$$;
create trigger workroom_ledger_immutable before update or delete on app_private.workroom_ledger for each row execute function app_private.workroom_immutable();
create trigger workroom_cohort_immutable before update or delete on app_private.workroom_cohort for each row execute function app_private.workroom_immutable();
create trigger workroom_receipts_immutable before update or delete on app_private.workroom_receipts for each row execute function app_private.workroom_immutable();
create trigger workroom_audit_immutable before update or delete on app_private.workroom_audit for each row execute function app_private.workroom_immutable();
create function app_private.workroom_round_guard() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_op='DELETE' or old.closed_at is not null or row(new.id,new.user_id,new.instrument,new.stake,new.snapshot,new.started_at) is distinct from row(old.id,old.user_id,old.instrument,old.stake,old.snapshot,old.started_at) or new.closed_at is null or new.returned is null then raise exception 'WORKROOM_ROUND_IMMUTABLE';end if;return new;end$$;
create trigger workroom_round_guard before update or delete on app_private.workroom_rounds for each row execute function app_private.workroom_round_guard();
create function app_private.workroom_initialize(p_user uuid,p_referral text) returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare n text;begin
 select left(coalesce(nullif(btrim(p.display_name),''),nullif(btrim(u.raw_user_meta_data->>'legal_name'),''),'회원'),40) into n from auth.users u left join public.user_profiles p on p.user_id=u.id where u.id=p_user;
 insert into app_private.workroom_accounts(user_id,name,balance,room,referral) values(p_user,n,100000,'WR-'||upper(replace(p_user::text,'-','')),p_referral) on conflict(user_id) do nothing;
 if found then insert into app_private.workroom_ledger(user_id,amount,balance_after,kind,note) values(p_user,100000,100000,'WELCOME','가입 1회 무료 체험 포인트 · 현금 전환 불가');end if;
end$$;
create function app_private.workroom_signup() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare invitation app_private.workroom_invites%rowtype; v_code text;begin
 v_code:=upper(btrim(new.raw_user_meta_data->>'referralCode'));
 if new.raw_user_meta_data->'workroomAcknowledged' is distinct from 'true'::jsonb or v_code is null or length(v_code) not between 8 and 64 then raise exception using errcode='23514',message='WORKROOM_INVITATION_REQUIRED';end if;
 select * into invitation from app_private.workroom_invites i where i.code=v_code for update;
 if invitation.id is null or not invitation.enabled or invitation.expires_at<=clock_timestamp() or invitation.used>=invitation.max_uses then raise exception using errcode='23514',message='WORKROOM_INVITATION_INVALID';end if;
 update app_private.workroom_invites set used=used+1 where id=invitation.id;
 perform app_private.workroom_initialize(new.id,v_code);return new;
end$$;
create trigger zz_workroom_signup after insert on auth.users for each row execute function app_private.workroom_signup();
create function app_private.workroom_assert_member() returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare u uuid:=auth.uid();begin
 if u is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' or not exists(select 1 from auth.users a where a.id=u and a.deleted_at is null and (a.banned_until is null or a.banned_until<=clock_timestamp()) and a.email_confirmed_at is not null) then raise exception using errcode='42501',message='WORKROOM_AUTH_REQUIRED';end if;
 perform s.id from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=u and (s.not_after is null or s.not_after>clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='WORKROOM_AUTH_REQUIRED';end if;return u;
end$$;
create function app_private.workroom_round_json(r app_private.workroom_rounds) returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('id',r.id,'instrument',r.instrument,'stake',r.stake,'pattern',r.snapshot->'pattern','roi',r.snapshot->'roi','duration',r.snapshot->'duration','amplitude',r.snapshot->'amplitude','configVersion',r.snapshot->'version','started',floor(extract(epoch from r.started_at)*1000),'status',case when r.closed_at is null then 'active' else 'completed' end,'returned',r.returned,'profit',r.returned-r.stake,'closedAt',floor(extract(epoch from r.closed_at)*1000));
$$;
create function app_private.workroom_state(p_user uuid) returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('member',(select jsonb_build_object('id',a.user_id,'name',a.name,'balance',a.balance,'room',a.room,'createdAt',floor(extract(epoch from a.created_at)*1000)) from app_private.workroom_accounts a where a.user_id=p_user),
 'active',(select app_private.workroom_round_json(r) from app_private.workroom_rounds r where r.user_id=p_user and r.closed_at is null),
 'history',coalesce((select jsonb_agg(app_private.workroom_round_json(r) order by r.started_at desc,r.id) from (select * from app_private.workroom_rounds where user_id=p_user and closed_at is not null order by started_at desc,id limit 100)r),'[]'::jsonb),
 'ledger',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'amount',l.amount,'balanceAfter',l.balance_after,'kind',l.kind,'note',l.note,'createdAt',floor(extract(epoch from l.created_at)*1000)) order by l.created_at desc,l.id) from (select * from app_private.workroom_ledger where user_id=p_user order by created_at desc,id limit 200)l),'[]'::jsonb),
 'configs',(select jsonb_agg(to_jsonb(c) order by c.instrument) from app_private.workroom_config c),'serverNow',floor(extract(epoch from statement_timestamp())*1000));
$$;
create function app_private.workroom_settle(p_user uuid,p_id uuid) returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare r app_private.workroom_rounds%rowtype; returned_points bigint; new_balance bigint;settled_at timestamptz;progress double precision;curve_value double precision;frequency integer;begin
 select * into r from app_private.workroom_rounds where id=p_id and user_id=p_user for update;
 if r.id is null then raise exception 'WORKROOM_ROUND_NOT_FOUND';end if;
 if r.closed_at is not null then return;end if;
 -- FINISH may close early; the client curve is a display of this frozen rule.
 -- One DB clock determines both the valuation and recorded completion time.
 settled_at:=clock_timestamp();
 progress:=least(1.0,greatest(0.0,extract(epoch from(settled_at-r.started_at))::double precision/(r.snapshot->>'duration')::double precision));
 frequency:=case r.snapshot->>'pattern' when 'slow' then 2 when 'balanced' then 4 else 7 end;
 if progress=0 then curve_value:=100;
 elsif progress=1 then curve_value:=100+(r.snapshot->>'roi')::double precision;
 else curve_value:=100+(r.snapshot->>'roi')::double precision*progress+(r.snapshot->>'amplitude')::double precision*sin(pi()*progress)*(sin(frequency*pi()*progress)+.25*sin(17*pi()*progress));end if;
 -- Values stay positive under configured limits; floor(x+.5) matches JS Math.round.
 returned_points:=floor(r.stake*curve_value/100+.5)::bigint;
 update app_private.workroom_accounts set balance=balance+returned_points where user_id=p_user returning balance into new_balance;
 update app_private.workroom_rounds set returned=returned_points,closed_at=settled_at where id=r.id;
 insert into app_private.workroom_ledger(user_id,amount,balance_after,kind,note,round_id) values(p_user,returned_points,new_balance,'SETTLEMENT','서버 확정 모의 회차 반환 · 현금 전환 불가',r.id);
end$$;
create function public.workroom_read_state() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$begin return app_private.workroom_state(app_private.workroom_assert_member());end$$;
create function public.workroom_member_command(p_operation text,p_request_key text,p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid; hash text; receipt app_private.workroom_receipts%rowtype; result jsonb; a app_private.workroom_accounts%rowtype; c app_private.workroom_config%rowtype; rid uuid; stake_points bigint;begin
 u:=app_private.workroom_assert_member();
 if p_operation is null or p_operation not in('OPEN','START','FINISH','SYNC') or p_request_key is null or p_request_key!~'^[A-Za-z0-9_-]{8,200}$' or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>4096 then raise exception 'WORKROOM_INVALID_INPUT';end if;
 hash:=encode(sha256(convert_to(jsonb_build_object('operation',p_operation,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('workroom:member:'||u::text,0));
 select * into receipt from app_private.workroom_receipts where actor=u and scope='MEMBER' and request_key=p_request_key;
 if found then if receipt.digest<>hash then raise exception 'WORKROOM_REQUEST_CONFLICT';end if;return receipt.result;end if;
 if p_operation='OPEN' then
  if p_input<>'{}'::jsonb then raise exception 'WORKROOM_INVALID_INPUT';end if;
  if not exists(select 1 from app_private.workroom_accounts where user_id=u) then
   if not exists(select 1 from app_private.workroom_cohort where user_id=u) then raise exception 'WORKROOM_INVITATION_REQUIRED';end if;
   perform app_private.workroom_initialize(u,null);
  end if;
 else
  select * into a from app_private.workroom_accounts where user_id=u for update;
  if a.user_id is null then raise exception 'WORKROOM_OPEN_REQUIRED';end if;
  if p_operation='START' then
   if (select array_agg(k order by k) from jsonb_object_keys(p_input)k) is distinct from array['acknowledged','expectedVersion','instrument','stake']::text[] or p_input->'acknowledged' is distinct from 'true'::jsonb or jsonb_typeof(p_input->'expectedVersion') is distinct from 'number' or coalesce(p_input->>'expectedVersion','')!~'^[0-9]{1,10}$' or jsonb_typeof(p_input->'stake') is distinct from 'number' or (p_input->>'stake')!~'^[0-9]{1,13}$' then raise exception 'WORKROOM_INVALID_INPUT';end if;
   if (p_input->>'expectedVersion')::bigint not between 1 and 2147483647 then raise exception 'WORKROOM_INVALID_INPUT';end if;
   stake_points:=(p_input->>'stake')::bigint;
   if stake_points not between 1000 and 1000000000 then raise exception 'WORKROOM_INVALID_INPUT';end if;
   if stake_points>a.balance then raise exception 'WORKROOM_INSUFFICIENT_POINTS';end if;
   if exists(select 1 from app_private.workroom_rounds where user_id=u and closed_at is null) then raise exception 'WORKROOM_ACTIVE_ROUND_EXISTS';end if;
   select * into c from app_private.workroom_config where instrument=p_input->>'instrument' for share;
   if c.instrument is null then raise exception 'WORKROOM_INVALID_INPUT';end if;
   if c.version<>(p_input->>'expectedVersion')::bigint then raise exception 'WORKROOM_VERSION_CONFLICT';end if;
   insert into app_private.workroom_rounds(user_id,instrument,stake,snapshot) values(u,c.instrument,stake_points,to_jsonb(c)) returning id into rid;
   update app_private.workroom_accounts set balance=balance-stake_points where user_id=u returning balance into a.balance;
   insert into app_private.workroom_ledger(user_id,amount,balance_after,kind,note,round_id) values(u,-stake_points,a.balance,'STAKE','무료 모의 회차 참여',rid);
  elsif p_operation='FINISH' then
   if (select array_agg(k) from jsonb_object_keys(p_input)k) is distinct from array['id']::text[] then raise exception 'WORKROOM_INVALID_INPUT';end if;
   perform app_private.workroom_settle(u,(p_input->>'id')::uuid);
  else
   if p_input<>'{}'::jsonb then raise exception 'WORKROOM_INVALID_INPUT';end if;
   select id into rid from app_private.workroom_rounds where user_id=u and closed_at is null and started_at+make_interval(secs=>(snapshot->>'duration')::integer)<=clock_timestamp();
   if rid is not null then perform app_private.workroom_settle(u,rid);end if;
  end if;
 end if;
 result:=app_private.workroom_state(u);
 insert into app_private.workroom_receipts(actor,scope,request_key,digest,result) values(u,'MEMBER',p_request_key,hash,result);
 return result;
end$$;
create function app_private.workroom_assert_admin(p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text) returns void language plpgsql security invoker set search_path=pg_catalog as $$begin
 if auth.uid() is distinct from p_actor or p_actor is null or auth.jwt()->>'session_id' is distinct from p_auth_session_id or auth.jwt()->>'aal' is distinct from 'aal2' or p_verified_aal is distinct from 'aal2' then raise exception using errcode='42501',message='WORKROOM_ADMIN_FORBIDDEN';end if;
 perform app_private.workroom_assert_member();
 perform app_private.assert_economy_policy_admin_context(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 perform s.id from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id join auth.mfa_amr_claims amr on amr.session_id=s.id and amr.authentication_method='totp'
 where s.id::text=p_auth_session_id and s.user_id=p_actor and s.aal::text='aal2' and (s.not_after is null or s.not_after>clock_timestamp()) and f.factor_type::text='totp' and f.status::text='verified' for share of s,f,amr;
 if not found then raise exception using errcode='42501',message='WORKROOM_MFA_REQUIRED';end if;
end$$;
create function app_private.workroom_admin_read(p_input jsonb) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare users_page integer:=coalesce((p_input->>'usersPage')::integer,1);invites_page integer:=coalesce((p_input->>'invitesPage')::integer,1);audit_page integer:=coalesce((p_input->>'auditPage')::integer,1);page_size integer:=coalesce((p_input->>'pageSize')::integer,25);search text:=coalesce(p_input->>'search','');users_total bigint;invites_total bigint;audit_total bigint;users_json jsonb;invites_json jsonb;audit_json jsonb;begin
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in('usersPage','invitesPage','auditPage','pageSize','search')) or least(users_page,invites_page,audit_page)<1 or greatest(users_page,invites_page,audit_page)>100000 or page_size not between 1 and 100 or length(search)>100 then raise exception 'WORKROOM_INVALID_INPUT';end if;
 select count(*) into users_total from app_private.workroom_accounts a join auth.users u on u.id=a.user_id where search='' or strpos(lower(a.name||' '||coalesce(u.email,'')||' '||u.id::text),lower(search))>0;
 select count(*) into invites_total from app_private.workroom_invites;
 select count(*) into audit_total from app_private.workroom_audit;
 select coalesce(jsonb_agg(v order by v->>'createdAt' desc,v->>'id'),'[]'::jsonb) into users_json from(select jsonb_build_object('id',a.user_id,'name',a.name,'email',u.email,'balance',a.balance,'room',a.room,'referral',a.referral,'createdAt',floor(extract(epoch from a.created_at)*1000))v from app_private.workroom_accounts a join auth.users u on u.id=a.user_id where search='' or strpos(lower(a.name||' '||coalesce(u.email,'')||' '||u.id::text),lower(search))>0 order by a.created_at desc,a.user_id limit page_size offset (users_page-1)*page_size)t;
 select coalesce(jsonb_agg(v order by v->>'createdAt' desc,v->>'id'),'[]'::jsonb) into invites_json from(select jsonb_build_object('id',id,'code',code,'label',label,'maxUses',max_uses,'used',used,'enabled',enabled,'expiresAt',floor(extract(epoch from expires_at)*1000),'createdAt',floor(extract(epoch from created_at)*1000))v from app_private.workroom_invites order by created_at desc,id limit page_size offset (invites_page-1)*page_size)t;
 select coalesce(jsonb_agg(v order by v->>'createdAt' desc,v->>'id'),'[]'::jsonb) into audit_json from(select jsonb_build_object('id',id,'actor',actor,'operation',operation,'target',target,'input',input,'createdAt',floor(extract(epoch from created_at)*1000))v from app_private.workroom_audit order by created_at desc,id limit page_size offset (audit_page-1)*page_size)t;
 return jsonb_build_object('users',users_json,'invites',invites_json,'configs',(select jsonb_agg(to_jsonb(c) order by instrument) from app_private.workroom_config c),'audit',audit_json,'pagination',jsonb_build_object('users',jsonb_build_object('page',users_page,'total',users_total),'invites',jsonb_build_object('page',invites_page,'total',invites_total),'audit',jsonb_build_object('page',audit_page,'total',audit_total)));
end$$;
create function public.workroom_admin_command(p_operation text,p_request_key text,p_input jsonb,p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare hash text;receipt app_private.workroom_receipts%rowtype;result jsonb;target text;reason text;invitation app_private.workroom_invites%rowtype;c app_private.workroom_config%rowtype;target_user uuid;points bigint;new_balance bigint;expiry timestamptz;begin
 perform app_private.workroom_assert_admin(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 if p_operation is null or p_operation not in('READ','INVITE_CREATE','INVITE_STATUS','CONFIG_SAVE','GRANT') or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>8192 then raise exception 'WORKROOM_INVALID_INPUT';end if;
 if p_operation='READ' then return app_private.workroom_admin_read(p_input);end if;
 if p_request_key is null or p_request_key!~'^[A-Za-z0-9_-]{8,200}$' then raise exception 'WORKROOM_INVALID_INPUT';end if;
 hash:=encode(sha256(convert_to(jsonb_build_object('operation',p_operation,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('workroom:admin:'||p_actor::text,0));
 select * into receipt from app_private.workroom_receipts where actor=p_actor and scope='ADMIN' and request_key=p_request_key;
 if found then if receipt.digest<>hash then raise exception 'WORKROOM_REQUEST_CONFLICT';end if;return receipt.result;end if;
 reason:=btrim(p_input->>'reason');
 if reason is null or length(reason) not between 1 and 160 then raise exception 'WORKROOM_REASON_REQUIRED';end if;
 if p_operation='INVITE_CREATE' then
  if exists(select 1 from jsonb_object_keys(p_input)k where k not in('maxUses','expiresAt','reason','label')) or jsonb_typeof(p_input->'maxUses') is distinct from 'number' or coalesce(p_input->>'maxUses','')!~'^[0-9]{1,4}$' or (p_input->>'maxUses')::integer not between 1 and 1000 or length(coalesce(p_input->>'label',''))>60 then raise exception 'WORKROOM_INVALID_INPUT';end if;
  expiry:=(p_input->>'expiresAt')::timestamptz;
  if expiry is null or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '365 days' then raise exception 'WORKROOM_INVALID_INPUT';end if;
  insert into app_private.workroom_invites(code,label,max_uses,expires_at) values('WR-'||upper(replace(gen_random_uuid()::text,'-','')),coalesce(p_input->>'label',''),(p_input->>'maxUses')::integer,expiry) returning * into invitation;
  target:=invitation.id::text;
  result:=jsonb_build_object('id',invitation.id,'code',invitation.code,'label',invitation.label,'maxUses',invitation.max_uses,'used',0,'enabled',true,'expiresAt',floor(extract(epoch from invitation.expires_at)*1000),'createdAt',floor(extract(epoch from invitation.created_at)*1000));
 elsif p_operation='INVITE_STATUS' then
  if (select array_agg(k order by k) from jsonb_object_keys(p_input)k) is distinct from array['enabled','id','reason']::text[] or jsonb_typeof(p_input->'enabled') is distinct from 'boolean' then raise exception 'WORKROOM_INVALID_INPUT';end if;
  update app_private.workroom_invites set enabled=(p_input->>'enabled')::boolean where id=(p_input->>'id')::uuid returning * into invitation;
  if invitation.id is null then raise exception 'WORKROOM_INVITE_NOT_FOUND';end if;
  target:=invitation.id::text;result:=jsonb_build_object('id',invitation.id,'enabled',invitation.enabled);
 elsif p_operation='CONFIG_SAVE' then
  if (select array_agg(k order by k) from jsonb_object_keys(p_input)k) is distinct from array['amplitude','duration','expectedVersion','instrument','pattern','reason','roi']::text[] or
   jsonb_typeof(p_input->'roi') is distinct from 'number' or jsonb_typeof(p_input->'amplitude') is distinct from 'number' or jsonb_typeof(p_input->'duration') is distinct from 'number' or jsonb_typeof(p_input->'expectedVersion') is distinct from 'number' or
   coalesce(p_input->>'duration','')!~'^[0-9]{1,4}$' or coalesce(p_input->>'expectedVersion','')!~'^[0-9]{1,9}$' or
   (p_input->>'roi')::numeric not between -50 and 50 or (p_input->>'amplitude')::numeric not between 0 and 15 or (p_input->>'duration')::integer not between 30 and 3600 or coalesce(p_input->>'pattern','') not in('wave','slow','balanced') then raise exception 'WORKROOM_INVALID_INPUT';end if;
  select * into c from app_private.workroom_config where instrument=p_input->>'instrument' for update;
  if c.instrument is null then raise exception 'WORKROOM_INVALID_INPUT';end if;
  if c.version<>(p_input->>'expectedVersion')::integer then raise exception 'WORKROOM_VERSION_CONFLICT';end if;
  update app_private.workroom_config set pattern=p_input->>'pattern',roi=(p_input->>'roi')::numeric,duration=(p_input->>'duration')::integer,amplitude=(p_input->>'amplitude')::numeric,version=version+1 where instrument=c.instrument returning * into c;
  target:=c.instrument;result:=to_jsonb(c);
 else
  if (select array_agg(k order by k) from jsonb_object_keys(p_input)k) is distinct from array['amount','reason','userId']::text[] or jsonb_typeof(p_input->'amount') is distinct from 'number' or coalesce(p_input->>'amount','')!~'^[0-9]{1,7}$' then raise exception 'WORKROOM_INVALID_INPUT';end if;
  points:=(p_input->>'amount')::bigint;target_user:=(p_input->>'userId')::uuid;
  if points not between 1 and 1000000 then raise exception 'WORKROOM_INVALID_INPUT';end if;
  update app_private.workroom_accounts set balance=balance+points where user_id=target_user returning balance into new_balance;
  if not found then raise exception 'WORKROOM_MEMBER_NOT_FOUND';end if;
  insert into app_private.workroom_ledger(user_id,amount,balance_after,kind,note) values(target_user,points,new_balance,'GRANT',reason);
  target:=target_user::text;result:=jsonb_build_object('userId',target_user,'amount',points,'balance',new_balance);
 end if;
 insert into app_private.workroom_audit(actor,operation,target,input) values(p_actor,p_operation,target,p_input);
 insert into app_private.workroom_receipts(actor,scope,request_key,digest,result) values(p_actor,'ADMIN',p_request_key,hash,result);
 return result;
end$$;
-- Only narrowly named existing entrypoints that create new mining participation
-- are retired. Existing journal/history and pending financial processing survive.
do $$begin
 if to_regprocedure('public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text)') is not null then execute 'revoke execute on function public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text) from public,anon,authenticated,service_role';end if;
 if to_regprocedure('public.start_trial(uuid,text)') is not null then execute 'revoke execute on function public.start_trial(uuid,text) from public,anon,authenticated,service_role';end if;
end$$;
-- Retire NEW legacy event enrollment at both exposed and directly granted
-- private overloads. Existing event journals/consumers/pending finance survive.
do $$declare signature text;begin
 foreach signature in array array[
  'public.participate_published_event(uuid,uuid,uuid,uuid)',
  'public.participate_published_event(uuid,uuid,uuid,uuid,text)',
  'app_private.participate_published_event(uuid,uuid,uuid,uuid)',
  'app_private.participate_published_event(uuid,uuid,uuid,uuid,text)'
 ] loop
  if to_regprocedure(signature) is not null then execute format('revoke execute on function %s from public,anon,authenticated,service_role',signature);end if;
 end loop;
end$$;
-- No direct table grants: mutations/read projections run only via checked RPCs.
do $$declare t text;f record;begin
 foreach t in array array['workroom_cohort','workroom_invites','workroom_accounts','workroom_config','workroom_rounds','workroom_ledger','workroom_receipts','workroom_audit'] loop
 execute format('alter table app_private.%I enable row level security',t);
 execute format('alter table app_private.%I force row level security',t);
 execute format('revoke all on table app_private.%I from public,anon,authenticated,service_role',t);
 end loop;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname like 'workroom_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end$$;
revoke all on function public.workroom_read_state() from public,anon,authenticated,service_role;
revoke all on function public.workroom_member_command(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.workroom_admin_command(text,text,jsonb,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.workroom_read_state() to authenticated;
grant execute on function public.workroom_member_command(text,text,jsonb) to authenticated;
grant execute on function public.workroom_admin_command(text,text,jsonb,uuid,uuid,text,text) to authenticated;
comment on function public.workroom_member_command(text,text,jsonb) is 'Free noncash simulation only. Serialized per member, immutable configuration snapshots, stored original idempotency results. No wallet or monetary reward effects.';
commit;
