begin;
-- Source: kyc_durable_receipts.sql.draft SHA256 ba90563eadf67eb7125cdd21e515039b1e1c28ec49b1e89d9620343ae1bacdf0

create table public.kyc_operation_receipts (
  user_id uuid not null references auth.users(id) on delete restrict,
  operation text not null check (operation in ('OPEN','SUBMIT')),
  request_id uuid not null,
  auth_session_id uuid,
  request_payload jsonb not null,
  payload_sha256 text not null default '',
  result_id uuid,
  resolution text check(resolution is null or resolution='CASE_CLOSED'),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  primary key(user_id,operation,request_id),
  check(jsonb_typeof(request_payload)='object'),
  check(payload_sha256 ~ '^[a-f0-9]{64}$'),
  check((result_id is null and resolution is null and completed_at is null)
    or(result_id is not null and resolution is null and completed_at is not null)
    or(result_id is null and resolution='CASE_CLOSED' and completed_at is not null))
);
alter table public.kyc_operation_receipts enable row level security;
alter table public.kyc_operation_receipts force row level security;
revoke all on public.kyc_operation_receipts from public,anon,authenticated,service_role;
grant select on public.kyc_operation_receipts to service_role;
grant insert(user_id,operation,request_id,auth_session_id,request_payload,result_id,resolution,completed_at)
  on public.kyc_operation_receipts to service_role;
grant update(auth_session_id,result_id,resolution,completed_at) on public.kyc_operation_receipts to service_role;
-- A duplicated historical object identity must be reviewed, never deleted to pass.
create unique index kyc_submissions_owner_path_unique on public.kyc_submissions(user_id,protected_storage_path);

-- Historical Cloud evidence.ts generated only lower-case .png/.jpg/.pdf paths.
-- New paths are extensionless. Match exactly these four bounded identities;
-- never use a suffix wildcard or silently pick one ambiguous historical row.
create function app_private.find_kyc_submission(p_user_id uuid,p_case_id uuid,p_request_id uuid)
returns public.kyc_submissions language plpgsql security invoker set search_path=pg_catalog as $$
declare v_ids uuid[];v_base text;v_submission public.kyc_submissions%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('kyc-owner:'||p_user_id::text,0));
 v_base:=p_user_id::text||'/'||p_case_id::text||'/'||p_request_id::text;
 select array_agg(id order by id) into v_ids from public.kyc_submissions where user_id=p_user_id and case_id=p_case_id
   and lower(protected_storage_path)=any(array[v_base,v_base||'.png',v_base||'.jpg',v_base||'.pdf']);
 if cardinality(v_ids)>1 then raise exception using errcode='55000',message='KYC_LEGACY_SUBMISSION_AMBIGUOUS'; end if;
 -- service_role has SELECT/INSERT only on submissions; owner advisory serializes
 -- bounded identity decisions without granting UPDATE just for a tuple lock.
 if cardinality(v_ids)=1 then select * into v_submission from public.kyc_submissions where id=v_ids[1]; end if;
 return v_submission;
end; $$;
revoke all on function app_private.find_kyc_submission(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.find_kyc_submission(uuid,uuid,uuid) to service_role;
create function public.lookup_kyc_submission(p_user_id uuid,p_case_id uuid,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare v_submission public.kyc_submissions%rowtype;
begin
 v_submission:=app_private.find_kyc_submission(p_user_id,p_case_id,p_request_id);
 if v_submission.id is null then return null; end if;
 return jsonb_build_object('id',v_submission.id,'case_id',v_submission.case_id);
end; $$;
revoke all on function public.lookup_kyc_submission(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.lookup_kyc_submission(uuid,uuid,uuid) to service_role;

-- Session UUID is a server verified binding, not a browser supplied field.
-- No FK cascade/restrict: deleting an Auth session must neither erase the receipt
-- nor block logout. Strict live membership is checked on pending admission/commit.
grant usage on schema auth to service_role;
grant select(id,user_id,not_after) on auth.sessions to service_role;
grant select(id,deleted_at,banned_until) on auth.users to service_role;
create view public.kyc_active_member_sessions with(security_invoker=true) as
select s.id,s.user_id from auth.sessions s join auth.users u on u.id=s.user_id
where u.deleted_at is null and (s.not_after is null or s.not_after>clock_timestamp())
  and (u.banned_until is null or u.banned_until<=clock_timestamp());
revoke all on public.kyc_active_member_sessions from public,anon,authenticated,service_role;
grant select on public.kyc_active_member_sessions to service_role;
create function app_private.assert_kyc_active_session(p_user_id uuid,p_session_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  if p_session_id is null or not exists (
    select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=p_session_id and s.user_id=p_user_id and u.deleted_at is null
      and (s.not_after is null or s.not_after>clock_timestamp())
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
  ) then raise exception using errcode='42501',message='KYC_SESSION_REQUIRED'; end if;
end;
$$;

create function app_private.guard_kyc_operation_receipt()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
declare v_payload jsonb; v_case uuid; v_kind text; v_path text; v_hash text; v_size bigint; v_mime text;v_accepted public.kyc_submissions%rowtype;
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='KYC_RECEIPT_IMMUTABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kyc-owner:'||new.user_id::text,0));
  if tg_op='UPDATE' then
    if row(new.user_id,new.operation,new.request_id,new.request_payload,new.payload_sha256,new.created_at)
      is distinct from row(old.user_id,old.operation,old.request_id,old.request_payload,old.payload_sha256,old.created_at)
      or old.result_id is not null or old.resolution is not null then
      raise exception using errcode='55000',message='KYC_RECEIPT_IMMUTABLE';
    end if;
  else
    new.payload_sha256:=encode(extensions.digest(new.request_payload::text,'sha256'),'hex');
    if new.created_at is distinct from statement_timestamp() then
      raise exception using errcode='22023',message='INVALID_KYC_RECEIPT';
    end if;
  end if;
  if new.operation='OPEN' then
    if new.request_payload<>'{}'::jsonb then raise exception using errcode='22023',message='INVALID_KYC_RECEIPT'; end if;
  elsif new.operation='SUBMIT' then
    v_payload:=new.request_payload;
    if new.resolution='CASE_CLOSED' and (select count(*) from jsonb_object_keys(v_payload))=1 then
      begin v_case:=(v_payload->>'case_id')::uuid;
      exception when others then raise exception using errcode='22023',message='INVALID_KYC_RECEIPT'; end;
      if v_case is null or not exists(select 1 from public.kyc_cases where id=v_case and user_id=new.user_id) then
        raise exception using errcode='22023',message='INVALID_KYC_RECEIPT';
      end if;
    else
    begin
      v_case:=(v_payload->>'case_id')::uuid;
      v_kind:=v_payload->>'document_kind'; v_path:=v_payload->>'path'; v_hash:=v_payload->>'content_sha256';
      v_size:=(v_payload->>'size_bytes')::bigint; v_mime:=v_payload->>'mime_type';
    exception when others then raise exception using errcode='22023',message='INVALID_KYC_RECEIPT'; end;
    if v_case is null or not exists(select 1 from public.kyc_cases where id=v_case and user_id=new.user_id)
      or v_kind is distinct from 'IDENTITY_DOCUMENT'
      or v_path is distinct from new.user_id::text||'/'||v_case::text||'/'||new.request_id::text
      or coalesce(v_hash,'')!~'^[a-f0-9]{64}$' or coalesce(v_size,0) not between 1 and 5242880
      or v_mime is null or v_mime not in ('image/jpeg','image/png','application/pdf')
      or (select count(*) from jsonb_object_keys(v_payload))<>6 then
      raise exception using errcode='22023',message='INVALID_KYC_RECEIPT';
    end if;
    end if;
  else raise exception using errcode='22023',message='INVALID_KYC_RECEIPT'; end if;
  -- Completed legacy OPEN calls remain service-only. New HTTP calls always
  -- create a live-session pending admission before the unchanged domain RPC.
  if new.operation='SUBMIT' or new.result_id is null or tg_op='UPDATE' then
    perform app_private.assert_kyc_active_session(new.user_id,new.auth_session_id);
  end if;
  if new.resolution='CASE_CLOSED' then
    if new.operation<>'SUBMIT' or new.result_id is not null then raise exception using errcode='22023',message='INVALID_KYC_RECEIPT'; end if;
    perform 1 from public.kyc_cases where id=(new.request_payload->>'case_id')::uuid and user_id=new.user_id
      and status in ('APPROVED','REJECTED') for update;
    if not found then raise exception using errcode='55000',message='KYC_CLOSED_RESOLUTION_UNCONFIRMED'; end if;
    v_accepted:=app_private.find_kyc_submission(new.user_id,v_case,new.request_id);
    if v_accepted.id is not null then
      raise exception using errcode='55000',message='KYC_CLOSED_RESOLUTION_UNCONFIRMED';
    end if;
    new.completed_at:=statement_timestamp();
  elsif new.result_id is not null then
    if new.operation='SUBMIT' then v_accepted:=app_private.find_kyc_submission(new.user_id,v_case,new.request_id); end if;
    if (new.operation='OPEN' and not exists(select 1 from public.kyc_cases where id=new.result_id and user_id=new.user_id))
      or (new.operation='SUBMIT' and (v_accepted.id is distinct from new.result_id
        or v_accepted.content_sha256 is distinct from new.request_payload->>'content_sha256'
        or v_accepted.document_kind is distinct from new.request_payload->>'document_kind')) then
      raise exception using errcode='22023',message='INVALID_KYC_RECEIPT_RESULT';
    end if;
    new.completed_at:=statement_timestamp();
  elsif new.completed_at is not null then raise exception using errcode='22023',message='INVALID_KYC_RECEIPT'; end if;
  return new;
end;
$$;
create trigger kyc_operation_receipts_guard before insert or update or delete
on public.kyc_operation_receipts for each row execute function app_private.guard_kyc_operation_receipt();
revoke all on function app_private.assert_kyc_active_session(uuid,uuid),app_private.guard_kyc_operation_receipt()
  from public,anon,authenticated,service_role;
grant execute on function app_private.assert_kyc_active_session(uuid,uuid),app_private.guard_kyc_operation_receipt() to service_role;

-- Every product claim/rebind takes the same owner -> receipt lock order as
-- open/submit/resolve. A direct REST UPDATE would lock the tuple before its row
-- trigger obtains owner advisory lock, introducing a lock-order inversion.
create function public.claim_kyc_operation(p_user_id uuid,p_operation text,p_request_id uuid,p_auth_session_id uuid,p_request_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare v_receipt public.kyc_operation_receipts%rowtype;v_accepted public.kyc_submissions%rowtype;v_case uuid;
begin
 if p_user_id is null or p_request_id is null or p_operation not in('OPEN','SUBMIT') or p_operation is null
   or p_request_payload is null or jsonb_typeof(p_request_payload)<>'object'
 then raise exception using errcode='22023',message='INVALID_KYC_RECEIPT'; end if;
 perform pg_advisory_xact_lock(hashtextextended('kyc-owner:'||p_user_id::text,0));
 perform app_private.assert_kyc_active_session(p_user_id,p_auth_session_id);
 select * into v_receipt from public.kyc_operation_receipts
 where user_id=p_user_id and operation=p_operation and request_id=p_request_id for update;
 if p_operation='SUBMIT' then
   begin v_case:=(p_request_payload->>'case_id')::uuid;
   exception when others then raise exception using errcode='22023',message='INVALID_KYC_RECEIPT'; end;
   v_accepted:=app_private.find_kyc_submission(p_user_id,v_case,p_request_id);
   if v_accepted.id is not null and (v_accepted.content_sha256 is distinct from p_request_payload->>'content_sha256'
     or v_accepted.document_kind is distinct from p_request_payload->>'document_kind' or v_receipt.resolution='CASE_CLOSED'
     or v_receipt.result_id is not null and v_receipt.result_id is distinct from v_accepted.id)
   then raise exception using errcode='55000',message='KYC_IDEMPOTENCY_CONFLICT'; end if;
 end if;
 if v_receipt.user_id is null then
   insert into public.kyc_operation_receipts(user_id,operation,request_id,auth_session_id,request_payload,result_id,completed_at)
   values(p_user_id,p_operation,p_request_id,p_auth_session_id,p_request_payload,v_accepted.id,
     case when v_accepted.id is not null then statement_timestamp() end) returning * into v_receipt;
 elsif v_receipt.request_payload is distinct from p_request_payload then
   raise exception using errcode='55000',message='KYC_IDEMPOTENCY_CONFLICT';
 elsif v_receipt.result_id is null and v_receipt.resolution is null and v_accepted.id is not null then
   update public.kyc_operation_receipts set auth_session_id=p_auth_session_id,result_id=v_accepted.id,completed_at=statement_timestamp()
   where user_id=p_user_id and operation=p_operation and request_id=p_request_id returning * into v_receipt;
 elsif v_receipt.result_id is null and v_receipt.resolution is null and v_receipt.auth_session_id is distinct from p_auth_session_id then
   update public.kyc_operation_receipts set auth_session_id=p_auth_session_id
   where user_id=p_user_id and operation=p_operation and request_id=p_request_id returning * into v_receipt;
 end if;
 return to_jsonb(v_receipt);
end; $$;
revoke all on function public.claim_kyc_operation(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_kyc_operation(uuid,text,uuid,uuid,jsonb) to service_role;

do $$ begin
  if exists(select 1 from storage.buckets where id='kyc-evidence' and
    (public is distinct from false or file_size_limit is distinct from 5242880::bigint
      or allowed_mime_types is null or not(allowed_mime_types @> array['image/jpeg','image/png','application/pdf'])
      or cardinality(allowed_mime_types)<>3)) then
    raise exception 'KYC_EXISTING_BUCKET_REVIEW_REQUIRED';
  end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('kyc-evidence','kyc-evidence',false,5242880,array['image/jpeg','image/png','application/pdf']) on conflict(id) do nothing;
-- Restrictive policy protects KYC even if another bucket has a broad permissive policy.
create policy kyc_evidence_server_boundary on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'kyc-evidence') with check(bucket_id<>'kyc-evidence');
grant select on storage.buckets,storage.objects to service_role;

create or replace function public.open_kyc_case(p_user_id uuid,p_request_id uuid)
returns uuid language plpgsql security invoker set search_path=pg_catalog
as $$
declare v_case uuid; v_receipt public.kyc_operation_receipts%rowtype;
begin
  if p_user_id is null or p_request_id is null then raise exception using errcode='22023',message='INVALID_KYC_OPEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kyc-owner:'||p_user_id::text,0));
  select * into v_receipt from public.kyc_operation_receipts where user_id=p_user_id and operation='OPEN' and request_id=p_request_id for update;
  if v_receipt.result_id is not null then return v_receipt.result_id; end if;
  if v_receipt.user_id is not null then perform app_private.assert_kyc_active_session(p_user_id,v_receipt.auth_session_id); end if;
  select id into v_case from public.kyc_cases where user_id=p_user_id
    and status in ('PENDING','IN_REVIEW','ON_HOLD','REQUIRES_RESUBMISSION') for update;
  if v_case is null then
    insert into public.kyc_cases(user_id,status) values(p_user_id,'PENDING') returning id into v_case;
    insert into public.kyc_status_history(case_id,from_status,to_status,actor_user_id,reason,request_id)
    values(v_case,null,'PENDING',p_user_id,'KYC case opened',p_request_id);
  end if;
  if v_receipt.user_id is null then
    insert into public.kyc_operation_receipts(user_id,operation,request_id,request_payload,result_id,completed_at)
    values(p_user_id,'OPEN',p_request_id,'{}',v_case,statement_timestamp());
  else
    update public.kyc_operation_receipts set result_id=v_case,completed_at=statement_timestamp()
    where user_id=p_user_id and operation='OPEN' and request_id=p_request_id;
  end if;
  return v_case;
end;
$$;

create or replace function public.submit_kyc_documents(p_case_id uuid,p_user_id uuid,p_document_kind text,
  p_protected_storage_path text,p_content_sha256 text,p_request_id uuid)
returns uuid language plpgsql security invoker set search_path=pg_catalog
as $$
declare v_case public.kyc_cases%rowtype; v_receipt public.kyc_operation_receipts%rowtype;
  v_submission uuid; v_existing public.kyc_submissions%rowtype;
begin
  if p_case_id is null or p_user_id is null or p_request_id is null
    or btrim(coalesce(p_document_kind,''))<>'IDENTITY_DOCUMENT'
    or coalesce(p_content_sha256,'')!~'^[A-Fa-f0-9]{64}$'
    or p_protected_storage_path is distinct from p_user_id::text||'/'||p_case_id::text||'/'||p_request_id::text then
    raise exception using errcode='22023',message='INVALID_KYC_DOCUMENT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kyc-owner:'||p_user_id::text,0));
  select * into v_receipt from public.kyc_operation_receipts where user_id=p_user_id and operation='SUBMIT' and request_id=p_request_id for update;
  if v_receipt.user_id is null then raise exception using errcode='55000',message='KYC_UPLOAD_CLAIM_REQUIRED'; end if;
  if v_receipt.request_payload->>'case_id' is distinct from p_case_id::text
    or v_receipt.request_payload->>'document_kind' is distinct from btrim(p_document_kind)
    or v_receipt.request_payload->>'path' is distinct from p_protected_storage_path
    or v_receipt.request_payload->>'content_sha256' is distinct from lower(p_content_sha256) then
    raise exception using errcode='55000',message='KYC_IDEMPOTENCY_CONFLICT';
  end if;
  v_existing:=app_private.find_kyc_submission(p_user_id,p_case_id,p_request_id);
  if v_receipt.result_id is not null then
    if v_existing.id is distinct from v_receipt.result_id or v_existing.content_sha256 is distinct from lower(p_content_sha256)
      or v_existing.document_kind is distinct from btrim(p_document_kind) then raise exception using errcode='55000',message='KYC_IDEMPOTENCY_CONFLICT'; end if;
    return v_receipt.result_id;
  end if;
  if v_receipt.resolution='CASE_CLOSED' then
    if v_existing.id is not null then raise exception using errcode='55000',message='KYC_IDEMPOTENCY_CONFLICT'; end if;
    return null;
  end if;
  perform app_private.assert_kyc_active_session(p_user_id,v_receipt.auth_session_id);
  select * into v_case from public.kyc_cases where id=p_case_id and user_id=p_user_id for update;
  if v_case.id is null then raise exception using errcode='55000',message='KYC_CASE_NOT_FOUND'; end if;
  if v_existing.id is not null then
    if v_existing.case_id<>p_case_id or v_existing.document_kind<>btrim(p_document_kind)
      or v_existing.content_sha256<>lower(p_content_sha256) then
      raise exception using errcode='55000',message='KYC_IDEMPOTENCY_CONFLICT';
    end if;
    update public.kyc_operation_receipts set result_id=v_existing.id,completed_at=statement_timestamp()
      where user_id=p_user_id and operation='SUBMIT' and request_id=p_request_id;
    return v_existing.id;
  end if;
  if v_case.status not in ('PENDING','REQUIRES_RESUBMISSION','ON_HOLD','IN_REVIEW') then
    update public.kyc_operation_receipts set resolution='CASE_CLOSED',completed_at=statement_timestamp()
      where user_id=p_user_id and operation='SUBMIT' and request_id=p_request_id;
    return null;
  end if;
  if not exists(select 1 from storage.objects where bucket_id='kyc-evidence' and name=p_protected_storage_path
    and metadata->>'mimetype'=v_receipt.request_payload->>'mime_type'
    and metadata->>'size'=v_receipt.request_payload->>'size_bytes') then
    raise exception using errcode='55000',message='KYC_UPLOAD_UNCONFIRMED';
  end if;
  insert into public.kyc_submissions(case_id,user_id,document_kind,protected_storage_path,content_sha256)
  values(p_case_id,p_user_id,btrim(p_document_kind),p_protected_storage_path,lower(p_content_sha256)) returning id into v_submission;
  if v_case.status in ('PENDING','REQUIRES_RESUBMISSION') then
    update public.kyc_cases set status='IN_REVIEW' where id=p_case_id;
    insert into public.kyc_status_history(case_id,from_status,to_status,actor_user_id,reason,request_id)
    values(p_case_id,v_case.status,'IN_REVIEW',p_user_id,'Documents submitted',p_request_id);
  end if;
  update public.kyc_operation_receipts set result_id=v_submission,completed_at=statement_timestamp()
    where user_id=p_user_id and operation='SUBMIT' and request_id=p_request_id;
  return v_submission;
end;
$$;
revoke all on function public.open_kyc_case(uuid,uuid),public.submit_kyc_documents(uuid,uuid,text,text,text,uuid)
from public,anon,authenticated;
grant execute on function public.open_kyc_case(uuid,uuid),public.submit_kyc_documents(uuid,uuid,text,text,text,uuid) to service_role;
-- A pre-dispatch browser bookmark may precede admission. Close that exact key
-- only after proving a closed owner case and no actual accepted canonical path.
create function public.resolve_missing_kyc_attempt(p_user_id uuid,p_case_id uuid,p_request_id uuid,p_auth_session_id uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare v_receipt public.kyc_operation_receipts%rowtype;v_accepted public.kyc_submissions%rowtype;
begin
 if p_user_id is null or p_case_id is null or p_request_id is null then raise exception using errcode='22023',message='INVALID_KYC_RECEIPT'; end if;
 perform pg_advisory_xact_lock(hashtextextended('kyc-owner:'||p_user_id::text,0));
 perform app_private.assert_kyc_active_session(p_user_id,p_auth_session_id);
 v_accepted:=app_private.find_kyc_submission(p_user_id,p_case_id,p_request_id);
 select * into v_receipt from public.kyc_operation_receipts where user_id=p_user_id and operation='SUBMIT' and request_id=p_request_id for update;
 if v_receipt.user_id is not null then
   if v_receipt.request_payload->>'case_id' is distinct from p_case_id::text then raise exception using errcode='55000',message='KYC_IDEMPOTENCY_CONFLICT'; end if;
   if v_receipt.resolution='CASE_CLOSED' and v_accepted.id is not null then raise exception using errcode='55000',message='KYC_IDEMPOTENCY_CONFLICT'; end if;
   return coalesce(v_receipt.resolution='CASE_CLOSED',false);
 end if;
 perform 1 from public.kyc_cases where id=p_case_id and user_id=p_user_id and status in('APPROVED','REJECTED') for update;
 if not found or v_accepted.id is not null then return false; end if;
 insert into public.kyc_operation_receipts(user_id,operation,request_id,auth_session_id,request_payload,resolution,completed_at)
 values(p_user_id,'SUBMIT',p_request_id,p_auth_session_id,jsonb_build_object('case_id',p_case_id::text),'CASE_CLOSED',statement_timestamp());
 return true;
end; $$;
revoke all on function public.resolve_missing_kyc_attempt(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.resolve_missing_kyc_attempt(uuid,uuid,uuid,uuid) to service_role;

-- Source: kyc_evidence_attestation.sql.draft SHA256 078c56fe7e001cc476f0ffde59eba498805f2c3084bc6cdb15ea60dc7471c147
grant select(aal) on auth.sessions to service_role;
create table public.kyc_evidence_delivery_receipts (
 id uuid primary key default gen_random_uuid(),
 submission_id uuid not null references public.kyc_submissions(id),
 case_id uuid not null references public.kyc_cases(id),
 owner_user_id uuid not null,
 reviewer_user_id uuid not null,
 auth_session_id uuid not null,
 admin_session_id uuid not null,
 content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
 prepare_request_id uuid not null unique,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '5 minutes',
 acknowledged_at timestamptz,
 ack_request_id uuid unique,
 constraint kyc_delivery_ack_pair check((acknowledged_at is null)=(ack_request_id is null))
);
alter table public.kyc_evidence_delivery_receipts enable row level security;
alter table public.kyc_evidence_delivery_receipts force row level security;
revoke all on public.kyc_evidence_delivery_receipts from public,anon,authenticated,service_role;
grant select on public.kyc_evidence_delivery_receipts to service_role;
grant insert(id,submission_id,case_id,owner_user_id,reviewer_user_id,auth_session_id,admin_session_id,content_sha256,prepare_request_id)
on public.kyc_evidence_delivery_receipts to service_role;
grant update(acknowledged_at,ack_request_id) on public.kyc_evidence_delivery_receipts to service_role;
create index kyc_delivery_review_lookup on public.kyc_evidence_delivery_receipts(reviewer_user_id,submission_id,admin_session_id) where acknowledged_at is not null;

create function app_private.assert_kyc_reviewer_session(p_actor uuid,p_admin_session uuid,p_auth_session uuid,p_step_request uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if not exists(select 1 from public.admin_sessions s
   join auth.sessions a on a.id=p_auth_session and a.user_id=p_actor
   join auth.users u on u.id=p_actor
   where s.id=p_admin_session and s.user_id=p_actor and s.auth_session_id=p_auth_session::text
     and s.revoked_at is null and s.idle_expires_at>clock_timestamp() and s.absolute_expires_at>clock_timestamp()
     and a.aal='aal2' and (a.not_after is null or a.not_after>clock_timestamp())
     and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()))
   or not exists(select 1 from public.user_roles r where r.user_id=p_actor
     and r.role in('SUPER_ADMIN','ADMIN','SUPPORT_ADMIN') and r.revoked_at is null)
 then raise exception using errcode='42501',message='KYC_REVIEW_SESSION_REQUIRED'; end if;
 if p_step_request is not null and not exists(select 1 from public.admin_step_up_grants g
   where g.user_id=p_actor and g.admin_session_id=p_admin_session and g.command_family='KYC_REVIEW'
     and g.consume_request_id=p_step_request and g.consumed_at is not null
     and g.consumed_at>clock_timestamp()-interval '5 minutes')
 then raise exception using errcode='42501',message='KYC_REVIEW_STEP_UP_REQUIRED'; end if;
end; $$;
revoke all on function app_private.assert_kyc_reviewer_session(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.assert_kyc_reviewer_session(uuid,uuid,uuid,uuid) to service_role;

create function app_private.guard_kyc_delivery_receipt()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception using errcode='55000',message='KYC_DELIVERY_IMMUTABLE'; end if;
 if tg_op='INSERT' then
   if new.acknowledged_at is not null or new.ack_request_id is not null
     or new.created_at>clock_timestamp() or new.created_at<clock_timestamp()-interval '1 minute'
     or new.expires_at<=clock_timestamp() or new.expires_at>clock_timestamp()+interval '5 minutes'
     or not exists(select 1 from public.kyc_submissions s where s.id=new.submission_id and s.case_id=new.case_id
       and s.user_id=new.owner_user_id and s.content_sha256=new.content_sha256)
   then raise exception using errcode='55000',message='KYC_DELIVERY_INVALID'; end if;
   perform app_private.assert_kyc_reviewer_session(new.reviewer_user_id,new.admin_session_id,new.auth_session_id,new.prepare_request_id);
   return new;
 end if;
 if (to_jsonb(new)-'acknowledged_at'-'ack_request_id') is distinct from (to_jsonb(old)-'acknowledged_at'-'ack_request_id')
   or old.acknowledged_at is not null or new.ack_request_id is null or new.acknowledged_at is null
   or old.expires_at<=clock_timestamp()
 then raise exception using errcode='55000',message='KYC_DELIVERY_IMMUTABLE'; end if;
 perform app_private.assert_kyc_reviewer_session(new.reviewer_user_id,new.admin_session_id,new.auth_session_id,new.ack_request_id);
 new.acknowledged_at:=clock_timestamp();
 -- Atomic explicit attestation only; download preparation never writes this table.
 insert into public.kyc_document_view_audit(submission_id,case_id,viewer_user_id,request_id)
 values(new.submission_id,new.case_id,new.reviewer_user_id,new.ack_request_id);
 return new;
end; $$;
revoke all on function app_private.guard_kyc_delivery_receipt() from public,anon,authenticated;
grant execute on function app_private.guard_kyc_delivery_receipt() to service_role;
create trigger kyc_delivery_receipt_guard before insert or update or delete on public.kyc_evidence_delivery_receipts
for each row execute function app_private.guard_kyc_delivery_receipt();

create function public.acknowledge_kyc_evidence(p_receipt_id uuid,p_submission_id uuid,p_actor uuid,p_admin_session_id uuid,p_auth_session_id uuid,p_content_sha256 text,p_request_id uuid)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare v_receipt public.kyc_evidence_delivery_receipts%rowtype;
begin
 select * into v_receipt from public.kyc_evidence_delivery_receipts where id=p_receipt_id for update;
 if v_receipt.id is null or v_receipt.reviewer_user_id is distinct from p_actor
   or v_receipt.submission_id is distinct from p_submission_id
   or v_receipt.admin_session_id is distinct from p_admin_session_id or v_receipt.auth_session_id is distinct from p_auth_session_id
   or v_receipt.content_sha256 is distinct from p_content_sha256
   or not exists(select 1 from public.kyc_submissions s where s.id=v_receipt.submission_id and s.case_id=v_receipt.case_id
     and s.user_id=v_receipt.owner_user_id and s.content_sha256=v_receipt.content_sha256)
 then raise exception using errcode='42501',message='KYC_DELIVERY_BINDING_REQUIRED'; end if;
 perform app_private.assert_kyc_reviewer_session(p_actor,p_admin_session_id,p_auth_session_id,p_request_id);
 if v_receipt.acknowledged_at is not null then return v_receipt.id; end if;
 if v_receipt.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='KYC_DELIVERY_EXPIRED'; end if;
 update public.kyc_evidence_delivery_receipts set acknowledged_at=clock_timestamp(),ack_request_id=p_request_id where id=p_receipt_id;
 return p_receipt_id;
end; $$;
revoke all on function public.acknowledge_kyc_evidence(uuid,uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.acknowledge_kyc_evidence(uuid,uuid,uuid,uuid,uuid,text,uuid) to service_role;
create function app_private.assert_kyc_review_evidence(p_case uuid,p_submission uuid,p_actor uuid,p_request uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare v_receipt public.kyc_evidence_delivery_receipts%rowtype;
begin
 select r.* into v_receipt from public.kyc_evidence_delivery_receipts r
 join public.admin_step_up_grants g on g.admin_session_id=r.admin_session_id and g.user_id=r.reviewer_user_id
   and g.command_family='KYC_REVIEW' and g.consume_request_id=p_request and g.consumed_at is not null
 where r.case_id=p_case and r.submission_id=p_submission and r.reviewer_user_id=p_actor
   and r.acknowledged_at is not null and r.expires_at>clock_timestamp()
   and exists(select 1 from public.kyc_submissions s where s.id=r.submission_id and s.case_id=r.case_id
     and s.user_id=r.owner_user_id and s.content_sha256=r.content_sha256)
 order by r.acknowledged_at desc limit 1;
 if v_receipt.id is null then raise exception using errcode='42501',message='KYC_CONTENT_ACK_REQUIRED'; end if;
 perform app_private.assert_kyc_reviewer_session(p_actor,v_receipt.admin_session_id,v_receipt.auth_session_id,p_request);
 insert into public.audit_logs(actor_user_id,action,target_type,target_id,reason,request_id,metadata)
 values(p_actor,'KYC_REVIEW_EVIDENCE_LINKED','KYC_CASE',p_case::text,'Previously acknowledged evidence bound to review',p_request,
   jsonb_build_object('delivery_receipt_id',v_receipt.id,'submission_id',p_submission,'content_ack_request_id',v_receipt.ack_request_id));
end; $$;
revoke all on function app_private.assert_kyc_review_evidence(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.assert_kyc_review_evidence(uuid,uuid,uuid,uuid) to service_role;

-- Source: kyc_review_guard.sql.draft SHA256 df29a6592aeaf2d98d6ed8891332f7b2211974789980f6a86b345ee3368033ab
create or replace function public.review_kyc_case(
  p_case_id uuid,
  p_actor uuid,
  p_to_status public.kyc_status,
  p_reason text,
  p_request_id uuid,
  p_view_submission_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_case public.kyc_cases%rowtype;
begin
  if p_case_id is null
    or p_actor is null
    or p_to_status is null
    or char_length(btrim(coalesce(p_reason, ''))) < 4
    or p_request_id is null
  then
    raise exception using errcode = '22023', message = 'INVALID_KYC_REVIEW';
  end if;

  if not exists (
    select 1 from public.user_roles as role
    where role.user_id = p_actor
      and role.role in ('SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN')
      and role.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  select kyc.* into v_case
  from public.kyc_cases as kyc
  where kyc.id = p_case_id
  for update;

  if v_case.id is null then
    raise exception using errcode = '55000', message = 'KYC_CASE_NOT_FOUND';
  end if;

  if p_view_submission_id is not null then
    perform app_private.assert_kyc_review_evidence(p_case_id,p_view_submission_id,p_actor,p_request_id);
    if not exists (
      select 1 from public.kyc_submissions as submission
      where submission.id = p_view_submission_id
        and submission.case_id = p_case_id
    ) then
      raise exception using errcode = '55000', message = 'KYC_DOCUMENT_NOT_FOUND';
    end if;

    -- The guard links a prior explicit acknowledgment; review does not assert a new view.
  end if;

  if p_to_status not in (
    'PENDING', 'IN_REVIEW', 'APPROVED', 'ON_HOLD', 'REJECTED', 'REQUIRES_RESUBMISSION'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_KYC_STATUS';
  end if;

  update public.kyc_cases
  set
    status = p_to_status,
    reviewed_by = p_actor,
    decided_at = case
      when p_to_status in ('APPROVED', 'REJECTED') then statement_timestamp()
      else decided_at
    end,
    decision_reason = p_reason
  where id = p_case_id;

  insert into public.kyc_status_history (
    case_id, from_status, to_status, actor_user_id, reason, request_id
  ) values (
    p_case_id, v_case.status, p_to_status, p_actor, p_reason, p_request_id
  );

  insert into public.audit_logs (
    actor_user_id, action, target_type, target_id, reason, request_id,
    before_state, after_state
  ) values (
    p_actor,
    'kyc_case.review',
    'kyc_case',
    p_case_id::text,
    p_reason,
    p_request_id,
    jsonb_build_object('status', v_case.status),
    jsonb_build_object('status', p_to_status)
  );

  return p_case_id;
end;
$$;

revoke all on function public.review_kyc_case(
  uuid, uuid, public.kyc_status, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.review_kyc_case(
  uuid, uuid, public.kyc_status, text, uuid, uuid
) to service_role;

commit;
