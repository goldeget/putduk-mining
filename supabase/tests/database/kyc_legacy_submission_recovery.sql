-- Independent historical-path regression; synthetic metadata rows, NOT Storage bytes.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create temporary table kyc_legacy_ctx(owner uuid,session_id uuid,session2 uuid,case_id uuid);
insert into kyc_legacy_ctx values('7baa0000-0000-4000-8000-000000000001','7baa0000-0000-4000-8000-000000000002','7baa0000-0000-4000-8000-000000000003','7baa0000-0000-4000-8000-000000000004');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
select owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','kyc-legacy-r2@example.invalid','',now(),now() from kyc_legacy_ctx;
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after)
select s,owner,now(),now(),'aal1',now()+interval '2 hours' from kyc_legacy_ctx cross join lateral unnest(array[session_id,session2]) s;
insert into public.kyc_cases(id,user_id,status) select case_id,owner,'APPROVED' from kyc_legacy_ctx;
-- Three exact extensions verified in recovered Cloud inspect/path helpers.
insert into public.kyc_submissions(id,case_id,user_id,document_kind,protected_storage_path,content_sha256)
select ('7baa0000-0000-4000-8000-'||lpad((20+n)::text,12,'0'))::uuid,case_id,owner,'IDENTITY_DOCUMENT',
 owner::text||'/'||case_id::text||'/7baa0000-0000-4000-8000-'||lpad((10+n)::text,12,'0')||ext,repeat('a',64)
from kyc_legacy_ctx cross join (values(1,'.png'),(2,'.jpg'),(3,'.pdf')) paths(n,ext);
grant select on kyc_legacy_ctx to service_role;
do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
set local role service_role;
select is(public.lookup_kyc_submission(owner,case_id,('7BAA0000-0000-4000-8000-'||lpad((10+n)::text,12,'0'))::uuid)->>'id',
 '7baa0000-0000-4000-8000-'||lpad((20+n)::text,12,'0'),'legacy exact extension is recovered with uppercase UUID input: '||ext)
from kyc_legacy_ctx cross join (values(1,'.png'),(2,'.jpg'),(3,'.pdf')) paths(n,ext);
select is(public.resolve_missing_kyc_attempt(owner,case_id,('7baa0000-0000-4000-8000-'||lpad((10+n)::text,12,'0'))::uuid,session_id),false,
 'actual legacy extension prevents absence tombstone: '||ext) from kyc_legacy_ctx cross join (values(1,'.png'),(2,'.jpg'),(3,'.pdf')) paths(n,ext);
select is(public.claim_kyc_operation(owner,'SUBMIT',('7baa0000-0000-4000-8000-'||lpad((10+n)::text,12,'0'))::uuid,session_id,
 jsonb_build_object('case_id',case_id::text,'document_kind','IDENTITY_DOCUMENT','path',owner::text||'/'||case_id::text||'/7baa0000-0000-4000-8000-'||lpad((10+n)::text,12,'0'),
 'content_sha256',repeat('a',64),'mime_type',mime,'size_bytes',10))->>'result_id',
 '7baa0000-0000-4000-8000-'||lpad((20+n)::text,12,'0'),'same-key claim adopts actual old submission rather than uploading new path: '||mime)
from kyc_legacy_ctx cross join (values(1,'image/png'),(2,'image/jpeg'),(3,'application/pdf')) paths(n,mime);
select is(public.submit_kyc_documents(case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/7baa0000-0000-4000-8000-'||lpad((10+n)::text,12,'0'),repeat('a',64),
 ('7baa0000-0000-4000-8000-'||lpad((10+n)::text,12,'0'))::uuid),('7baa0000-0000-4000-8000-'||lpad((20+n)::text,12,'0'))::uuid,
 'late POST RPC replays actual historical submission') from kyc_legacy_ctx cross join generate_series(1,3) n;
select throws_ok($q$select public.claim_kyc_operation(owner,'SUBMIT','7baa0000-0000-4000-8000-000000000011',session_id,
 jsonb_build_object('case_id',case_id::text,'document_kind','IDENTITY_DOCUMENT','path',owner::text||'/'||case_id::text||'/7baa0000-0000-4000-8000-000000000011',
 'content_sha256',repeat('b',64),'mime_type','image/png','size_bytes',10)) from kyc_legacy_ctx$q$,'55000','KYC_IDEMPOTENCY_CONFLICT','legacy same key refuses different original bytes');
select is((select count(*) from public.kyc_submissions where user_id=(select owner from kyc_legacy_ctx)),3::bigint,'legacy replays create zero new submissions');
-- Owner-first rebind must affect only a pending same-payload claim.
select lives_ok($q$select public.claim_kyc_operation(owner,'OPEN','7baa0000-0000-4000-8000-000000000031',session_id,'{}') from kyc_legacy_ctx$q$,'owner-first pending OPEN claim succeeds');
select is(public.claim_kyc_operation(owner,'OPEN','7baa0000-0000-4000-8000-000000000031',session2,'{}')->>'auth_session_id',session2::text,'same payload pending rebind uses verified current session') from kyc_legacy_ctx;
select lives_ok($q$select public.open_kyc_case(owner,'7baa0000-0000-4000-8000-000000000031') from kyc_legacy_ctx$q$,'pending claim completes with preserved open RPC');
select is(public.claim_kyc_operation(owner,'OPEN','7baa0000-0000-4000-8000-000000000031',session_id,'{}')->>'auth_session_id',session2::text,'completed receipt binding remains immutable') from kyc_legacy_ctx;
reset role;
-- Ambiguous exact known variants are evidence to investigate, not deduplicate.
insert into public.kyc_submissions(case_id,user_id,document_kind,protected_storage_path,content_sha256)
select case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/7baa0000-0000-4000-8000-000000000011',repeat('a',64) from kyc_legacy_ctx;
set local role service_role;
select throws_ok($q$select public.lookup_kyc_submission(owner,case_id,'7baa0000-0000-4000-8000-000000000011') from kyc_legacy_ctx$q$,'55000','KYC_LEGACY_SUBMISSION_AMBIGUOUS','lookup cannot choose an ambiguous known variant');
select throws_ok($q$select public.resolve_missing_kyc_attempt(owner,case_id,'7baa0000-0000-4000-8000-000000000011',session_id) from kyc_legacy_ctx$q$,'55000','KYC_LEGACY_SUBMISSION_AMBIGUOUS','absence resolver refuses ambiguous legacy records');
select throws_ok($q$select public.submit_kyc_documents(case_id,owner,'IDENTITY_DOCUMENT',owner::text||'/'||case_id::text||'/7baa0000-0000-4000-8000-000000000011',repeat('a',64),'7baa0000-0000-4000-8000-000000000011') from kyc_legacy_ctx$q$,'55000','KYC_LEGACY_SUBMISSION_AMBIGUOUS','completed receipt does not hide a second historical variant');
reset role;
select * from finish();
rollback;
