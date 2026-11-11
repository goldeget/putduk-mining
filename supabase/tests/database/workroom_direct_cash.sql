begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(1);
do $$begin
 if to_regprocedure('public.read_workroom_cash(uuid)') is null
   or to_regprocedure('public.prepare_workroom_cash_withdrawal(uuid,text,bigint,uuid,integer,text,uuid)') is null
   or to_regprocedure('public.hold_workroom_cash_withdrawal(uuid,text,text,uuid,bigint)') is null then
   raise exception 'WORKROOM_CASH_RPC_MISSING';
 end if;
end$$;
create function pg_temp.cash_must_fail(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise exception 'Expected %, got %',expected,sqlerrm;end;
 raise exception 'Expected failure: %',expected;
end$$;
do $$declare signature text;begin
 foreach signature in array array['public.read_workroom_cash(uuid)',
  'public.prepare_workroom_cash_withdrawal(uuid,text,bigint,uuid,integer,text,uuid)',
  'public.hold_workroom_cash_withdrawal(uuid,text,text,uuid,bigint)']loop
  if has_function_privilege('anon',signature,'EXECUTE')or has_function_privilege('authenticated',signature,'EXECUTE')then
   raise exception 'Cash service function exposed to a browser role';end if;
 end loop;
end$$;

-- Genuine disposable signup trigger consumes invitations; no production identity
-- or bank details are involved. The shared native metadata fixture is owner-only.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
values
 ('11650000-0000-4000-8000-000000000001','authenticated','authenticated','cash-native-owner@putduk.test','',now(),'{}',app_private.workroom_native_signup_metadata('{}'),now(),now(),'','','',''),
 ('11650000-0000-4000-8000-000000000002','authenticated','authenticated','cash-native-other@putduk.test','',now(),'{}',app_private.workroom_native_signup_metadata('{}'),now(),now(),'','','',''),
 ('11650000-0000-4000-8000-000000000003','authenticated','authenticated','cash-native-admin@putduk.test','',now(),'{}',app_private.workroom_native_signup_metadata('{}'),now(),now(),'','','','');
insert into public.user_roles(user_id,role,granted_by)values
 ('11650000-0000-4000-8000-000000000003','ADMIN','11650000-0000-4000-8000-000000000003');
select public.bootstrap_user('11650000-0000-4000-8000-000000000001');
select public.bootstrap_user('11650000-0000-4000-8000-000000000002');
insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,minimum_amount_atomic,fee_atomic,
 destination_config,effective_at,approved_by,allows_welcome_reward)
values('KRW','KRW_BANK',11650001,true,1,0,'{"allowed_bank_codes":["KB"]}',now()-interval '1 hour','11650000-0000-4000-8000-000000000003',false);
insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,display_hint,
 verification_status,verified_at,protection_until)
select id,'KRW_BANK',decode(repeat('ab',32),'hex'),encode(extensions.digest(id::text,'sha256'),'hex'),'KB ••••1234',
 'VERIFIED',now()-interval '2 days',now()-interval '1 day'
from auth.users where id in('11650000-0000-4000-8000-000000000001','11650000-0000-4000-8000-000000000002');

set local role service_role;
do $$declare u uuid:='11650000-0000-4000-8000-000000000001';a uuid:='11650000-0000-4000-8000-000000000003';s jsonb;begin
 s:=public.read_workroom_cash(u);
 if s->'ready' is distinct from 'true'::jsonb or s->>'availableKrw'<>'0'then raise exception 'Empty fresh cash wallet not readable';end if;
 perform public.approve_deposit_request(public.create_deposit_request(u,'KRW',70000,'cash-native-deposit-one'),a,
   70000,'cash-native-approve-one','native approved deposit proof one',gen_random_uuid());
 perform public.approve_deposit_request(public.create_deposit_request(u,'KRW',30000,'cash-native-deposit-two'),a,
   30000,'cash-native-approve-two','native approved deposit proof two',gen_random_uuid());
end$$;
set constraints all immediate;
set constraints all deferred;

do $$declare u uuid:='11650000-0000-4000-8000-000000000001';o uuid:='11650000-0000-4000-8000-000000000002';
 a uuid:='11650000-0000-4000-8000-000000000003';d uuid;other_d uuid;p uuid;j jsonb;k text;r uuid;tx uuid;s jsonb;begin
 select id into d from public.withdrawal_destinations where user_id=u;
 select id into other_d from public.withdrawal_destinations where user_id=o;
 select id into p from public.withdrawal_policies where version=11650001;
 s:=public.read_workroom_cash(u);
 if s->>'availableKrw'<>'100000'or s->>'depositedKrw'<>'100000'or s->>'heldKrw'<>'0'then raise exception 'Only approved actual deposits counted %',s;end if;
 if exists(select 1 from app_private.funding_engine_activations where user_id=u)then raise exception 'Deposit activated legacy engine';end if;
 j:=public.prepare_workroom_cash_withdrawal(u,'KRW_BANK',60000,p,11650001,null,d);k:=j->>'key';
 if j->>'v'<>'2'or j->>'amountKrw'<>'60000'then raise exception 'Wrong prepared cash original';end if;
 if public.prepare_workroom_cash_withdrawal(u,'KRW_BANK',60000,p,11650001,null,d)->>'key'<>k then raise exception 'Prepared replay changed key';end if;
 perform pg_temp.cash_must_fail(format('select public.prepare_workroom_cash_withdrawal(%L,''KRW_BANK'',60001,%L,11650001,null,%L)',u,p,d),'WITHDRAWAL_LOGICAL_PENDING');
 perform pg_temp.cash_must_fail(format('select public.hold_workroom_cash_withdrawal(%L,%L,''KRW_BANK'',%L,60000)',o,k,other_d),'WORKROOM_CASH_LOGICAL_MISMATCH');
 perform pg_temp.cash_must_fail(format('select public.hold_workroom_cash_withdrawal(%L,%L,''KRW_BANK'',%L,60001)',u,k,d),'WORKROOM_CASH_LOGICAL_MISMATCH');
 r:=public.hold_workroom_cash_withdrawal(u,k,'KRW_BANK',d,60000);
 if public.hold_workroom_cash_withdrawal(u,k,'KRW_BANK',d,60000)<>r then raise exception 'Cash HOLD replay changed ID';end if;
 if(select count(*)from app_private.workroom_cash_reservations where withdrawal_id=r)<>2
  or(select sum(amount_atomic)from app_private.workroom_cash_reservations where withdrawal_id=r)<>60000 then raise exception 'Per-credit reservation not exact';end if;
 if not exists(select 1 from app_private.workroom_cash_reservations x join public.money_source_movements m on m.id=x.credit_movement_id
  where x.withdrawal_id=r and x.ordinal=0 and x.amount_atomic=30000 and m.amount_atomic=30000)then
  raise exception 'Cash reservations did not consume newest approved credit first';end if;
 perform pg_temp.cash_must_fail(format('insert into app_private.workroom_cash_reservations(withdrawal_id,user_id,credit_movement_id,hold_ledger_transaction_id,amount_atomic,ordinal,effective_at) select %L,%L,gen_random_uuid(),hold_ledger_transaction_id,1,99,hold_posted_at from public.withdrawal_requests where id=%L',r,u,r),'WORKROOM_CASH_CREDIT_RESERVATION_INVALID');
 perform pg_temp.cash_must_fail(format('insert into app_private.workroom_cash_reservations(withdrawal_id,user_id,credit_movement_id,hold_ledger_transaction_id,amount_atomic,ordinal,effective_at) select %L,%L,x.credit_movement_id,x.hold_ledger_transaction_id,50000,99,x.effective_at from app_private.workroom_cash_reservations x join public.money_source_movements m on m.id=x.credit_movement_id where x.withdrawal_id=%L and m.amount_atomic=70000',r,u,r),'WORKROOM_CASH_CREDIT_RESERVATION_INVALID');
 if(select count(*)from public.wallet_ledger where reference_type='withdrawal_request'and reference_id=r)<>0 then raise exception 'HOLD posted a wallet debit';end if;
 s:=public.read_workroom_cash(u);
 if s->>'availableKrw'<>'40000'or s->>'heldKrw'<>'60000'or s->>'withdrawnKrw'<>'0'then raise exception 'Cash HOLD fold incorrect %',s;end if;
 if(select coverage from public.money_source_summaries where user_id=u)<>'COMPLETE'then raise exception 'Cash hold not covered';end if;
 -- The browser/server role has no UPDATE grant; ACL rejects before the
 -- append-only trigger. Keep that stronger boundary rather than granting UPDATE.
 perform pg_temp.cash_must_fail(format('update app_private.workroom_cash_reservations set amount_atomic=1 where withdrawal_id=%L',r),'permission denied');
 perform pg_temp.cash_must_fail(format('select public.finalize_withdrawal_ledger(%L,%L,''cash-native-premature-finalize'')',r,a),'EXTERNAL_SEND_REQUIRED');
 tx:=public.release_withdrawal_hold(r,a,'native cancellation before external send','cash-native-release-one','CANCELLED');
 if public.release_withdrawal_hold(r,a,'native cancellation before external send','cash-native-release-one','CANCELLED')<>tx then raise exception 'Release duplicated journal';end if;
 if public.hold_workroom_cash_withdrawal(u,k,'KRW_BANK',d,60000)<>r then raise exception 'Terminal HOLD replay lost original';end if;
 s:=public.read_workroom_cash(u);
 if s->>'availableKrw'<>'100000'or s->>'heldKrw'<>'0'or s->>'withdrawnKrw'<>'0'then raise exception 'Release did not restore original cash %',s;end if;
 perform public.resolve_withdrawal_logical_request(u,'CONFIRM',k,r);
 j:=public.prepare_workroom_cash_withdrawal(u,'KRW_BANK',40000,p,11650001,null,d);k:=j->>'key';
 r:=public.hold_workroom_cash_withdrawal(u,k,'KRW_BANK',d,40000);
 perform pg_temp.cash_must_fail(format('select public.record_krw_external_send(%L,''CASH-NATIVE-SHORT'',39999,%L,clock_timestamp(),''cash-native-short-send'')',r,a),'KRW_SEND_AMOUNT_MUST_EQUAL_REQUEST');
 perform public.record_krw_external_send(r,'CASH-NATIVE-40000',40000,a,clock_timestamp(),'cash-native-send-one');
 perform pg_temp.cash_must_fail(format('select public.release_withdrawal_hold(%L,%L,''native invalid post-send release'',''cash-native-forbidden-release'',''CANCELLED'')',r,a),'EXTERNAL_SEND');
 tx:=public.finalize_withdrawal_ledger(r,a,'cash-native-finalize-one');
 if public.finalize_withdrawal_ledger(r,a,'cash-native-finalize-one')<>tx then raise exception 'Finalize duplicated journal';end if;
 s:=public.read_workroom_cash(u);
 if s->>'availableKrw'<>'60000'or s->>'heldKrw'<>'0'or s->>'withdrawnKrw'<>'40000'then raise exception 'Finalize cash fold incorrect %',s;end if;
 if(select count(*)from public.wallet_ledger where reference_type='withdrawal_request'and reference_id=r)<>1 then raise exception 'Finalization wallet debit is not once';end if;
 if(select coverage from public.money_source_summaries where user_id=u)<>'COMPLETE'then raise exception 'Finalized cash source became unresolved';end if;
 if(select recovered_principal_atomic from public.money_source_summaries where user_id=u)<>'40000'then raise exception 'Final cash source recovery total mismatch';end if;
 -- A separate practice-funded account must not borrow another member's deposit.
 j:=public.prepare_workroom_cash_withdrawal(o,'KRW_BANK',1,p,11650001,null,other_d);
 perform pg_temp.cash_must_fail(format('select public.hold_workroom_cash_withdrawal(%L,%L,''KRW_BANK'',%L,1)',o,j->>'key',other_d),'WORKROOM_CASH_INSUFFICIENT');
 if(select count(*)from app_private.workroom_cash_withdrawals where user_id=o)<>0 then raise exception 'Failed cash hold left rows';end if;
end$$;
set constraints all immediate;
set constraints all deferred;
-- Manual TRC20 receipt uses the same unchanged operator confirmation producer,
-- including a subsequent deposit after a completed direct cash withdrawal.
do $$declare u uuid:='11650000-0000-4000-8000-000000000001';a uuid:='11650000-0000-4000-8000-000000000003';d uuid;t uuid;s jsonb;begin
 perform public.set_usdt_deposit_instructions('T'||repeat('1',33),'TRC20',a,'native manual TRC20 destination fixture',gen_random_uuid());
 d:=public.submit_usdt_manual_deposit(u,'TRC20',repeat('a',64),5,'cash-native-usdt-request');
 t:=public.confirm_usdt_manual_deposit(d,5000,a,'native manual TRC20 credit confirmation','cash-native-usdt-confirm');
 if public.confirm_usdt_manual_deposit(d,5000,a,'native manual TRC20 credit confirmation','cash-native-usdt-confirm')<>t then
  raise exception 'Manual USDT confirmation replay changed its receipt';end if;
 s:=public.read_workroom_cash(u);
 if s->>'availableKrw'<>'65000'or s->>'depositedKrw'<>'105000'or s->>'withdrawnKrw'<>'40000'then
  raise exception 'Verified manual USDT deposit not folded correctly after cash withdrawal %',s;end if;
end$$;
set constraints all immediate;
reset role;
do $$begin
 if exists(select 1 from app_private.workroom_accounts where user_id in(
  '11650000-0000-4000-8000-000000000001','11650000-0000-4000-8000-000000000002')and balance<>100000)then
  raise exception 'Cash operations changed noncash practice points';end if;
end$$;
select extensions.pass('WORKROOM direct-deposit cash contracts and lifecycle');
select * from extensions.finish();
rollback;
