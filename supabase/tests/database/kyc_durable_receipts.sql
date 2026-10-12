-- Independent R2 pgTAP coverage. Storage metadata fixtures below are NOT real files.
-- Actual Storage HTTP and two-connection concurrency are separate acceptance gates.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.kyc_operation_receipts'::regclass),'durable receipts force RLS');
select ok(not has_table_privilege('anon','public.kyc_operation_receipts','SELECT,INSERT,UPDATE,DELETE'),'anonymous has no receipt access');
select ok(not has_table_privilege('authenticated','public.kyc_operation_receipts','SELECT,INSERT,UPDATE,DELETE'),'member has no direct receipt access');
select ok(not has_table_privilege('service_role','public.kyc_operation_receipts','DELETE'),'service cannot erase durable receipts');
select ok(not has_column_privilege('service_role','public.kyc_operation_receipts','request_payload','UPDATE'),'service cannot rebind payload');
select ok(not has_table_privilege('authenticated','public.kyc_active_member_sessions','SELECT'),'active session view is server only');
select ok(not has_function_privilege('authenticated','public.open_kyc_case(uuid,uuid)','EXECUTE'),'member cannot choose another open owner');
select ok(not has_function_privilege('authenticated','public.submit_kyc_documents(uuid,uuid,text,text,text,uuid)','EXECUTE'),'member cannot choose another submission owner');
select is((select public from storage.buckets where id='kyc-evidence'),false,'evidence bucket is private');
select is((select file_size_limit from storage.buckets where id='kyc-evidence'),5242880::bigint,'bucket file cap is 5 MiB');

create temporary table kyc_ctx(owner uuid,session_id uuid,case_id uuid,open_key uuid,submit_key uuid,result uuid);
insert into kyc_ctx values('76aa0000-0000-4000-8000-000000000001','76aa0000-0000-4000-8000-000000000002',null,
  '76aa0000-0000-4000-8000-000000000003','76aa0000-0000-4000-8000-000000000004',null);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
select owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','kyc-r2@example.invalid','',now(),now() from kyc_ctx;
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after)
select session_id,owner,clock_timestamp(),clock_timestamp(),'aal1',clock_timestamp()+interval '2 hours' from kyc_ctx;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
values('76aa0000-0000-4000-8000-000000000098','00000000-0000-0000-0000-000000000000','authenticated','authenticated','kyc-foreign-r2@example.invalid','',now(),now());
insert into public.kyc_cases(id,user_id,status)
values('76aa0000-0000-4000-8000-000000000099','76aa0000-0000-4000-8000-000000000098','APPROVED');
grant select,update on kyc_ctx to service_role;
do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
set local role service_role;
insert into public.kyc_operation_receipts(user_id,operation,request_id,auth_session_id,request_payload)
select owner,'OPEN',open_key,session_id,'{}'::jsonb from kyc_ctx;
update kyc_ctx set case_id=public.open_kyc_case(owner,open_key);
select is(public.open_kyc_case(owner,open_key),case_id,'same open key replays one case') from kyc_ctx;
select is(public.open_kyc_case(owner,'76aa0000-0000-4000-8000-000000000005'),case_id,'another open key reuses active owner case') from kyc_ctx;
select is((select count(*) from public.kyc_cases where user_id=(select owner from kyc_ctx)),1::bigint,'one active owner case');
insert into public.kyc_operation_receipts(user_id,operation,request_id,auth_session_id,request_payload)
select owner,'SUBMIT',submit_key,session_id,jsonb_build_object('case_id',case_id::text,'document_kind','IDENTITY_DOCUMENT',
  'path',owner::text||'/'||case_id::text||'/'||submit_key::text,'content_sha256',repeat('a',64),
  'mime_type','application/pdf','size_bytes',10) from kyc_ctx;
select throws_ok($q$select public.submit_kyc_documents(case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/'||submit_key::text,repeat('a',64),submit_key) from kyc_ctx$q$,
 '55000','KYC_UPLOAD_UNCONFIRMED','claim alone cannot confirm a nonexistent object');
reset role;
-- Synthetic object catalog only; no file was uploaded or downloaded by this fixture.
insert into storage.objects(bucket_id,name,metadata)
select 'kyc-evidence',owner::text||'/'||case_id::text||'/'||submit_key::text,
  '{"mimetype":"application/pdf","size":10}'::jsonb from kyc_ctx;
set local role service_role;
update kyc_ctx set result=public.submit_kyc_documents(case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/'||submit_key::text,repeat('a',64),submit_key);
select is(public.submit_kyc_documents(case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/'||submit_key::text,repeat('a',64),submit_key),result,'same submit key replays original submission') from kyc_ctx;
select is((select count(*) from public.kyc_submissions where user_id=(select owner from kyc_ctx)),1::bigint,'replay creates no extra submission');
select is((select count(*) from public.kyc_status_history where case_id=(select case_id from kyc_ctx) and to_status='IN_REVIEW'),1::bigint,'replay creates no extra review transition');
select throws_ok($q$select public.submit_kyc_documents(case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/'||submit_key::text,repeat('b',64),submit_key) from kyc_ctx$q$,
 '55000','KYC_IDEMPOTENCY_CONFLICT','same key cannot accept another bytes hash');
select throws_ok($q$select public.submit_kyc_documents(case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/'||submit_key::text||'.pdf',repeat('a',64),submit_key) from kyc_ctx$q$,
 '22023','INVALID_KYC_DOCUMENT','extension cannot create another object identity');
-- An admitted but not submitted old request must not permanently block re-application.
insert into public.kyc_operation_receipts(user_id,operation,request_id,auth_session_id,request_payload)
select owner,'SUBMIT','76aa0000-0000-4000-8000-000000000007',session_id,jsonb_build_object('case_id',case_id::text,'document_kind','IDENTITY_DOCUMENT',
  'path',owner::text||'/'||case_id::text||'/76aa0000-0000-4000-8000-000000000007','content_sha256',repeat('c',64),
  'mime_type','application/pdf','size_bytes',10) from kyc_ctx;
reset role;
update public.kyc_cases set status='REJECTED',decision_reason='synthetic closure test' where id=(select case_id from kyc_ctx);
-- Historical accepted row with no operation receipt: canonical absence must be false.
insert into public.kyc_submissions(case_id,user_id,document_kind,protected_storage_path,content_sha256)
select case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/76aa0000-0000-4000-8000-000000000011',repeat('e',64) from kyc_ctx;
set local role service_role;
select is(public.submit_kyc_documents(case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/76aa0000-0000-4000-8000-000000000007',repeat('c',64),'76aa0000-0000-4000-8000-000000000007'),null::uuid,'closed case with no accepted submission resolves without claiming receipt success') from kyc_ctx;
select is((select resolution from public.kyc_operation_receipts where request_id='76aa0000-0000-4000-8000-000000000007'),'CASE_CLOSED','old unresolved request is durably closed');
reset role;
update public.kyc_cases set status='PENDING' where id=(select case_id from kyc_ctx);
set local role service_role;
select is(public.submit_kyc_documents(case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/76aa0000-0000-4000-8000-000000000007',repeat('c',64),'76aa0000-0000-4000-8000-000000000007'),null::uuid,'resolved key can never commit even after administrative reopen') from kyc_ctx;
reset role;
update public.kyc_cases set status='REJECTED',decision_reason='synthetic closure test' where id=(select case_id from kyc_ctx);
set local role service_role;
select is(public.resolve_missing_kyc_attempt(owner,case_id,'76aa0000-0000-4000-8000-000000000009',session_id),true,'a closed pre-admission bookmark is durably resolved without file bytes') from kyc_ctx;
select is(public.resolve_missing_kyc_attempt(owner,case_id,submit_key,session_id),false,'an accepted document is never closed as absent') from kyc_ctx;
select is(public.resolve_missing_kyc_attempt(owner,'76aa0000-0000-4000-8000-000000000099','76aa0000-0000-4000-8000-000000000010',session_id),false,'another owner case cannot be bound to a terminal key') from kyc_ctx;
select is(public.resolve_missing_kyc_attempt(owner,case_id,'76aa0000-0000-4000-8000-000000000011',session_id),false,'canonical accepted path without old receipt cannot be declared absent') from kyc_ctx;
select lives_ok($q$insert into public.kyc_operation_receipts(user_id,operation,request_id,auth_session_id,request_payload)
 select owner,'SUBMIT','76aa0000-0000-4000-8000-000000000009',session_id,jsonb_build_object('case_id',case_id::text,'document_kind','IDENTITY_DOCUMENT',
 'path',owner::text||'/'||case_id::text||'/76aa0000-0000-4000-8000-000000000009','content_sha256',repeat('d',64),'mime_type','application/pdf','size_bytes',10)
 from kyc_ctx on conflict(user_id,operation,request_id) do nothing$q$,'late same-key admission cannot overwrite an absence tombstone');
select throws_ok($q$select public.submit_kyc_documents(case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/76aa0000-0000-4000-8000-000000000009',repeat('d',64),'76aa0000-0000-4000-8000-000000000009') from kyc_ctx$q$,
 '55000','KYC_IDEMPOTENCY_CONFLICT','late in-flight payload can never commit after an absence tombstone');
select isnt(public.open_kyc_case(owner,'76aa0000-0000-4000-8000-000000000008'),case_id,'a terminal old request allows a new case') from kyc_ctx;
reset role;
delete from auth.sessions where id=(select session_id from kyc_ctx);
select is((select count(*) from public.kyc_operation_receipts where user_id=(select owner from kyc_ctx)),6::bigint,'logout does not cascade durable receipts');
select is((select count(*) from public.kyc_active_member_sessions where id=(select session_id from kyc_ctx)),0::bigint,'logout removes active HTTP membership');
set local role service_role;
select is(public.open_kyc_case(owner,open_key),case_id,'privileged replay returns original closed case') from kyc_ctx;
select is(public.submit_kyc_documents(case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/'||submit_key::text,repeat('a',64),submit_key),result,'privileged replay returns original completed document') from kyc_ctx;
select throws_ok($q$insert into public.kyc_operation_receipts(user_id,operation,request_id,auth_session_id,request_payload)
 select owner,'OPEN','76aa0000-0000-4000-8000-000000000006',session_id,'{}'::jsonb from kyc_ctx$q$,
 '42501','KYC_SESSION_REQUIRED','expired/deleted session cannot start a pending HTTP operation');
reset role;
select throws_ok($q$delete from public.kyc_operation_receipts where user_id=(select owner from kyc_ctx)$q$,
 '55000','KYC_RECEIPT_IMMUTABLE','even accidental privileged delete fails closed');
select throws_ok($q$update public.kyc_operation_receipts set request_payload='{"forged":true}' where user_id=(select owner from kyc_ctx)$q$,
 '55000','KYC_RECEIPT_IMMUTABLE','accepted payload cannot be rebound');
select * from finish();
rollback;
