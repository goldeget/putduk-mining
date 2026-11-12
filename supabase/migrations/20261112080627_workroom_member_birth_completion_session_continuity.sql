begin;

-- Only the server may complete the one missing digit for the verified member.
-- No direct member UPDATE grant, no invented historical values, no overwrite.
grant update (birth_sex_digit) on public.user_identity_profiles to service_role;
create function public.complete_workroom_birth_digit(p_user_id uuid, p_digit text, p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare v_profile public.user_identity_profiles%rowtype;
begin
 if p_user_id is null or p_request_id is null or p_digit is null or p_digit !~ '^[1-8]$' then
  raise exception using errcode='22023',message='INVALID_BIRTH_DIGIT';
 end if;
 select * into v_profile from public.user_identity_profiles where user_id=p_user_id for update;
 if not found then raise exception using errcode='55000',message='IDENTITY_PROFILE_REQUIRED';end if;
 if v_profile.birth_sex_digit is not null then
  if v_profile.birth_sex_digit=p_digit then return jsonb_build_object('digit',p_digit,'completed',true);end if;
  raise exception using errcode='55000',message='BIRTH_DIGIT_ALREADY_RECORDED';
 end if;
 if not ((p_digit in('1','2','5','6') and extract(year from v_profile.date_of_birth) between 1900 and 1999)
  or (p_digit in('3','4','7','8') and extract(year from v_profile.date_of_birth) between 2000 and 2099)) then
  raise exception using errcode='22023',message='BIRTH_DIGIT_CENTURY_MISMATCH';
 end if;
 update public.user_identity_profiles set birth_sex_digit=p_digit where user_id=p_user_id;
 insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
 values(p_user_id,null,'MEMBER_BIRTH_DIGIT_COMPLETED','USER',p_user_id::text,'회원이 직접 누락된 가입 구분 숫자 입력',p_request_id,jsonb_build_object('source','MEMBER_ACCOUNT','fields',jsonb_build_array('birth_sex_digit')));
 return jsonb_build_object('digit',p_digit,'completed',true);
end$$;
revoke all on function public.complete_workroom_birth_digit(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.complete_workroom_birth_digit(uuid,text,uuid) to service_role;

-- Sensitive action proof must not shorten an existing idle window.
create or replace function public.issue_admin_step_up(
  p_admin_session_id uuid,
  p_user_id uuid,
  p_command_family text,
  p_token text,
  p_ttl_seconds integer default 600
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_session public.admin_sessions%rowtype;
  v_id uuid;
  v_hash text;
begin
  if p_admin_session_id is null
    or p_user_id is null
    or char_length(btrim(coalesce(p_command_family, ''))) < 3
    or char_length(btrim(coalesce(p_token, ''))) < 16
    or coalesce(p_ttl_seconds, 0) not between 60 and 900
  then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_STEP_UP';
  end if;

  select session.* into v_session
  from public.admin_sessions as session
  where session.id = p_admin_session_id
    and session.user_id = p_user_id
  for update;

  if v_session.id is null
    or v_session.revoked_at is not null
    or v_session.idle_expires_at <= statement_timestamp()
    or v_session.absolute_expires_at <= statement_timestamp()
  then
    raise exception using errcode = '55000', message = 'ADMIN_SESSION_EXPIRED';
  end if;

  update public.admin_sessions
  set
    last_seen_at = statement_timestamp(),
    idle_expires_at = least(
      absolute_expires_at,
      greatest(idle_expires_at, statement_timestamp() + interval '30 minutes')
    )
  where id = v_session.id;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  insert into public.admin_step_up_grants (
    admin_session_id, user_id, command_family, token_hash, expires_at
  ) values (
    p_admin_session_id,
    p_user_id,
    btrim(p_command_family),
    v_hash,
    statement_timestamp() + make_interval(secs => p_ttl_seconds)
  ) returning id into v_id;

  insert into public.security_events (
    user_id, event_type, trusted_client_ip, ip_source, device_context, request_id
  ) values (
    p_user_id,
    'ADMIN_STEP_UP_ISSUED',
    null,
    'NONE',
    jsonb_build_object(
      'admin_session_id', p_admin_session_id,
      'command_family', btrim(p_command_family),
      'grant_id', v_id
    ),
    gen_random_uuid()
  );

  return v_id;
end;
$$;

-- Private projection is reached only through the existing JWT/MFA/session-checked command.
create function app_private.workroom_admin_member_history(p_input jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare target_user uuid:=(p_input->>'userId')::uuid;round_page integer:=coalesce((p_input->>'roundPage')::integer,1);point_page integer:=coalesce((p_input->>'pointPage')::integer,1);
begin
 if target_user is null or least(round_page,point_page)<1 or greatest(round_page,point_page)>100000 or exists(select 1 from jsonb_object_keys(p_input) k where k not in('userId','roundPage','pointPage')) then raise exception 'WORKROOM_INVALID_INPUT';end if;
 insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
 values(auth.uid(),null,'MEMBER_WORKROOM_HISTORY_VIEW','USER',target_user::text,'회원 상세에서 체험 포인트 전체 기록 조회',gen_random_uuid(),jsonb_build_object('roundPage',round_page,'pointPage',point_page));
 return jsonb_build_object('userId',target_user,
  'account',(select jsonb_build_object('balance',a.balance,'held',coalesce((select sum(stake) from app_private.workroom_rounds where user_id=target_user and closed_at is null),0)) from app_private.workroom_accounts a where a.user_id=target_user),
  'roundCount',(select count(*) from app_private.workroom_rounds where user_id=target_user),
  'ledgerCount',(select count(*) from app_private.workroom_ledger where user_id=target_user),
  'rounds',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'instrument',r.instrument,'stake',r.stake,'roi',(r.snapshot->>'roi')::numeric,'pattern',r.snapshot->>'pattern','duration',(r.snapshot->>'duration')::integer,'startedAt',floor(extract(epoch from r.started_at)*1000),'closedAt',floor(extract(epoch from r.closed_at)*1000),'returned',r.returned,'profit',r.returned-r.stake) order by r.started_at desc,r.id desc) from (select * from app_private.workroom_rounds where user_id=target_user order by started_at desc,id desc limit 25 offset (round_page-1)*25)r),'[]'::jsonb),
  'ledger',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'amount',l.amount,'balanceAfter',l.balance_after,'kind',l.kind,'note',l.note,'roundId',l.round_id,'createdAt',floor(extract(epoch from l.created_at)*1000)) order by l.created_at desc,l.id desc) from (select * from app_private.workroom_ledger where user_id=target_user order by created_at desc,id desc limit 25 offset (point_page-1)*25)l),'[]'::jsonb));
end$$;
revoke all on function app_private.workroom_admin_member_history(jsonb) from public,anon,authenticated,service_role;

create or replace function public.workroom_admin_command(p_operation text,p_request_key text,p_input jsonb,p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare hash text;receipt app_private.workroom_receipts%rowtype;result jsonb;target text;reason text;direction text;invitation app_private.workroom_invites%rowtype;c app_private.workroom_config%rowtype;target_user uuid;points bigint;new_balance bigint;expiry timestamptz;begin
 perform app_private.workroom_assert_admin(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 if p_operation is null or p_operation not in('READ','MEMBER_HISTORY','INVITE_CREATE','INVITE_STATUS','CONFIG_SAVE','POINT_ADJUST') or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>8192 then raise exception 'WORKROOM_INVALID_INPUT';end if;
 if p_operation='READ' then return app_private.workroom_admin_read(p_input);end if;
 if p_operation='MEMBER_HISTORY' then return app_private.workroom_admin_member_history(p_input);end if;
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
   coalesce(p_input->>'duration','')!~'^[0-9]{1,5}$' or coalesce(p_input->>'expectedVersion','')!~'^[0-9]{1,9}$' or
   (p_input->>'roi')::numeric not between -50 and 50 or (p_input->>'amplitude')::numeric not between 0 and 15 or (p_input->>'duration')::integer not between 30 and 86400 or coalesce(p_input->>'pattern','') not in('wave','slow','balanced') then raise exception 'WORKROOM_INVALID_INPUT';end if;
  select * into c from app_private.workroom_config where instrument=p_input->>'instrument' for update;
  if c.instrument is null then raise exception 'WORKROOM_INVALID_INPUT';end if;
  if c.version<>(p_input->>'expectedVersion')::integer then raise exception 'WORKROOM_VERSION_CONFLICT';end if;
  update app_private.workroom_config set pattern=p_input->>'pattern',roi=(p_input->>'roi')::numeric,duration=(p_input->>'duration')::integer,amplitude=(p_input->>'amplitude')::numeric,version=version+1 where instrument=c.instrument returning * into c;
  target:=c.instrument;result:=to_jsonb(c);
 elsif p_operation='POINT_ADJUST' then
  if (select array_agg(k order by k) from jsonb_object_keys(p_input)k) is distinct from array['amount','direction','reason','userId']::text[] or jsonb_typeof(p_input->'amount') is distinct from 'number' or coalesce(p_input->>'amount','')!~'^[0-9]{1,7}$' or coalesce(p_input->>'direction','') not in('CREDIT','DEBIT') then raise exception 'WORKROOM_INVALID_INPUT';end if;
  points:=(p_input->>'amount')::bigint;target_user:=(p_input->>'userId')::uuid;direction:=p_input->>'direction';
  if points not between 1 and 1000000 then raise exception 'WORKROOM_INVALID_INPUT';end if;
  if direction='DEBIT' then points:=-points;end if;
  update app_private.workroom_accounts set balance=balance+points where user_id=target_user and balance+points between 0 and 9000000000000 returning balance into new_balance;
  if not found then
   if not exists(select 1 from app_private.workroom_accounts where user_id=target_user) then raise exception 'WORKROOM_MEMBER_NOT_FOUND';end if;
   if direction='DEBIT' then raise exception 'WORKROOM_INSUFFICIENT_POINTS';end if;
   raise exception 'WORKROOM_BALANCE_LIMIT';
  end if;
  insert into app_private.workroom_ledger(user_id,amount,balance_after,kind,note) values(target_user,points,new_balance,'ADJUSTMENT',case when direction='CREDIT' then '운영자 지급 · ' else '운영자 차감 · ' end||reason);
  target:=target_user::text;result:=jsonb_build_object('userId',target_user,'direction',direction,'amount',points,'balance',new_balance);
 else
  raise exception 'WORKROOM_INVALID_INPUT';
 end if;
 insert into app_private.workroom_audit(actor,operation,target,input) values(p_actor,p_operation,target,p_input);
 insert into app_private.workroom_receipts(actor,scope,request_key,digest,result) values(p_actor,'ADMIN',p_request_key,hash,result);
 return result;
end$$;

commit;
