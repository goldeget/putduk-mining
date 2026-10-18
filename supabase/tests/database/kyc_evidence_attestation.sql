-- Synthetic database receipts only. This does not prove HTTP delivery or human review.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_table_privilege('authenticated','public.kyc_evidence_delivery_receipts','SELECT,INSERT,UPDATE,DELETE'),'delivery receipts are server only');
select ok(not has_table_privilege('service_role','public.kyc_evidence_delivery_receipts','DELETE'),'server cannot erase content acknowledgments');
create temporary table ack_ctx(actor uuid,auth_session uuid,admin_session uuid,case_id uuid,submission uuid,receipt uuid,prepare uuid,ack uuid,review uuid);
insert into ack_ctx values('77aa0000-0000-4000-8000-000000000001','77aa0000-0000-4000-8000-000000000002','77aa0000-0000-4000-8000-000000000003',
 '77aa0000-0000-4000-8000-000000000004','77aa0000-0000-4000-8000-000000000005','77aa0000-0000-4000-8000-000000000006',
 '77aa0000-0000-4000-8000-000000000007','77aa0000-0000-4000-8000-000000000008','77aa0000-0000-4000-8000-000000000009');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
select actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','kyc-ack-r2@example.invalid','',now(),now() from ack_ctx;
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after)
select auth_session,actor,now(),now(),'aal2',clock_timestamp()+interval '2 hours' from ack_ctx;
insert into public.user_roles(user_id,role) select actor,'ADMIN' from ack_ctx;
insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
select admin_session,actor,auth_session::text,'synthetic-fingerprint',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours' from ack_ctx;
insert into public.admin_step_up_grants(admin_session_id,user_id,command_family,token_hash,issued_at,expires_at,consumed_at,consume_request_id)
select admin_session,actor,'KYC_REVIEW',repeat('a',63)||n::text,clock_timestamp(),clock_timestamp()+interval '5 minutes',clock_timestamp(),
 case n when 1 then prepare when 2 then ack else review end from ack_ctx cross join generate_series(1,3) n;
insert into public.kyc_cases(id,user_id) select case_id,actor from ack_ctx;
insert into public.kyc_submissions(id,case_id,user_id,document_kind,protected_storage_path,content_sha256)
select submission,case_id,actor,'IDENTITY_DOCUMENT',actor::text||'/'||case_id::text||'/'||prepare::text,repeat('a',64) from ack_ctx;
grant select on ack_ctx to service_role;
do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
set local role service_role;
insert into public.kyc_evidence_delivery_receipts(id,submission_id,case_id,owner_user_id,reviewer_user_id,auth_session_id,admin_session_id,content_sha256,prepare_request_id)
select receipt,submission,case_id,actor,actor,auth_session,admin_session,repeat('a',64),prepare from ack_ctx;
select is((select count(*) from public.kyc_document_view_audit where submission_id=(select submission from ack_ctx)),0::bigint,'prepared or lost download is never a view');
select throws_ok($q$select public.review_kyc_case(case_id,actor,'IN_REVIEW','synthetic nonnull review',review,submission) from ack_ctx$q$,
 '42501','KYC_CONTENT_ACK_REQUIRED','metadata id alone cannot assert a view');
select throws_ok($q$select public.acknowledge_kyc_evidence(receipt,submission,actor,admin_session,auth_session,repeat('b',64),ack) from ack_ctx$q$,
 '42501','KYC_DELIVERY_BINDING_REQUIRED','changed client byte hash is denied');
select throws_ok($q$select public.acknowledge_kyc_evidence(receipt,submission,actor,'77aa0000-0000-4000-8000-000000000099',auth_session,repeat('a',64),ack) from ack_ctx$q$,
 '42501','KYC_DELIVERY_BINDING_REQUIRED','another admin session cannot acknowledge this receipt');
select throws_ok($q$select public.acknowledge_kyc_evidence(receipt,submission,'77aa0000-0000-4000-8000-000000000099',admin_session,auth_session,repeat('a',64),ack) from ack_ctx$q$,
 '42501','KYC_DELIVERY_BINDING_REQUIRED','another reviewer cannot acknowledge this receipt');
select throws_ok($q$select public.acknowledge_kyc_evidence(receipt,'77aa0000-0000-4000-8000-000000000099',actor,admin_session,auth_session,repeat('a',64),ack) from ack_ctx$q$,
 '42501','KYC_DELIVERY_BINDING_REQUIRED','another submission cannot reuse receipt');
select is(public.acknowledge_kyc_evidence(receipt,submission,actor,admin_session,auth_session,repeat('a',64),ack),receipt,'explicit content acknowledgment commits durable receipt') from ack_ctx;
select is(public.acknowledge_kyc_evidence(receipt,submission,actor,admin_session,auth_session,repeat('a',64),ack),receipt,'identical acknowledgment retry replays') from ack_ctx;
select is((select count(*) from public.kyc_document_view_audit where submission_id=(select submission from ack_ctx)),1::bigint,'ack retry does not duplicate view attestation');
select is(public.review_kyc_case(case_id,actor,'IN_REVIEW','synthetic acknowledged review',review,submission),case_id,'nonnull review can use matching current-session explicit ack') from ack_ctx;
select is((select count(*) from public.kyc_document_view_audit where submission_id=(select submission from ack_ctx)),1::bigint,'review links an existing acknowledgment without asserting a second human view');
select is((select count(*) from public.audit_logs where request_id=(select review from ack_ctx) and action='KYC_REVIEW_EVIDENCE_LINKED'),1::bigint,'review linkage has a distinct audit event');
select throws_ok($q$select app_private.assert_kyc_review_evidence('77aa0000-0000-4000-8000-000000000099',submission,actor,review) from ack_ctx$q$,
 '42501','KYC_CONTENT_ACK_REQUIRED','a different case cannot borrow an acknowledgment');
select is(public.review_kyc_case(case_id,actor,'IN_REVIEW','synthetic legacy null policy',gen_random_uuid(),null),case_id,'legacy null-view review policy remains unchanged') from ack_ctx;
reset role;
-- Clock aging fixture bypasses only this new table's immutable trigger; role/grant checks remain real.
alter table public.kyc_evidence_delivery_receipts disable trigger kyc_delivery_receipt_guard;
update public.kyc_evidence_delivery_receipts set acknowledged_at=null,ack_request_id=null,expires_at=clock_timestamp()-interval '1 second' where id=(select receipt from ack_ctx);
alter table public.kyc_evidence_delivery_receipts enable trigger kyc_delivery_receipt_guard;
set local role service_role;
select throws_ok($q$select public.acknowledge_kyc_evidence(receipt,submission,actor,admin_session,auth_session,repeat('a',64),ack) from ack_ctx$q$,
 '55000','KYC_DELIVERY_EXPIRED','expired prepared receipt cannot create an acknowledgment');
reset role;
delete from auth.sessions where id=(select auth_session from ack_ctx);
set local role service_role;
select throws_ok($q$select public.acknowledge_kyc_evidence(receipt,submission,actor,admin_session,auth_session,repeat('a',64),ack) from ack_ctx$q$,
 '42501','KYC_REVIEW_SESSION_REQUIRED','deleted auth session cannot acknowledge or replay');
reset role;
select * from finish();
rollback;
