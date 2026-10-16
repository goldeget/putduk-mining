-- Synthetic helper/catalog contract tests only. No users, withdrawals, ledger,
-- external sends, notifications, or real financial rows are created.
-- Owner/network trigger guards are inspected here; real role/row/HTTP flows
-- remain separate integration evidence and are NOT proved by this file.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.usdt_full_evidence(
  p_actual text default '1', p_network text default 'TRC20'
) returns jsonb language sql immutable security invoker
set search_path=pg_catalog as $$
  select jsonb_build_object(
    'version',1,'basis','OPERATOR_MANUAL_FULL_PAYOUT',
    'withdrawalId','11111111-1111-4111-8111-111111111111',
    'requestedKrwAmount','1000','actualUsdtAmount',p_actual,
    'network',p_network,'feeKrw','0','fullPayoutConfirmed',true);
$$;
create function pg_temp.usdt_full_call(
  p_evidence jsonb, p_requested bigint default 1000,
  p_fee bigint default 0, p_actual numeric default 1,
  p_network text default 'TRC20',
  p_withdrawal uuid default '11111111-1111-4111-8111-111111111111'
) returns void language sql security invoker set search_path=pg_catalog as $$
  select app_private.assert_usdt_manual_full_payout(
    p_withdrawal,p_requested,p_fee,p_network,p_actual,p_evidence);
$$;

select lives_ok(format('select pg_temp.usdt_full_call(%L::jsonb)',
  pg_temp.usdt_full_evidence()::text),'canonical full manual payout is valid');
select lives_ok(format('select pg_temp.usdt_full_call(%L::jsonb,p_actual=>0.000001)',
  pg_temp.usdt_full_evidence('0.000001')::text),'one micro USDT is positive and precise');
select lives_ok(format('select pg_temp.usdt_full_call(%L::jsonb,p_network=>%L)',
  pg_temp.usdt_full_evidence('1',network)::text,network),
  'canonical network '||network) from unnest(array['TRC20','ERC20','BEP20']) network;
select lives_ok(format('select pg_temp.usdt_full_call(%L::jsonb,p_actual=>1.234567)',
  pg_temp.usdt_full_evidence('1.234567')::text),'six fractional digits are accepted');

select throws_ok('select pg_temp.usdt_full_call(null)','22023',
  'USDT_MANUAL_FULL_PAYOUT_EVIDENCE_REQUIRED','null evidence rejected');
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb)',value::text),
  '22023','USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID','nonobject evidence rejected')
from unnest(array['[]'::jsonb,'null'::jsonb,'true'::jsonb,'"string"'::jsonb,'1'::jsonb]) value;
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb)',
  (pg_temp.usdt_full_evidence()-key)::text),'22023',
  'USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID','required key missing: '||key)
from unnest(array['version','basis','withdrawalId','requestedKrwAmount',
  'actualUsdtAmount','network','feeKrw','fullPayoutConfirmed']) key;
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb)',
  (pg_temp.usdt_full_evidence()||jsonb_build_object(key,'not-authority'))::text),
  '22023','USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID','extra key rejected: '||key)
from unnest(array['exchangeRate','userId','partialPayout','providerQuote']) key;
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb)',
  (pg_temp.usdt_full_evidence()||jsonb_build_object('fullPayoutConfirmed',value))::text),
  '22023','USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID','full confirmation must be boolean true')
from unnest(array['false'::jsonb,'null'::jsonb,'"true"'::jsonb,'1'::jsonb]) value;
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb)',
  (pg_temp.usdt_full_evidence()||jsonb_build_object('feeKrw',value))::text),
  '22023','USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID','evidence fee must be canonical string zero')
from unnest(array['"1"'::jsonb,'0'::jsonb,'"0.0"'::jsonb,'null'::jsonb]) value;
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb,p_fee=>1)',
  pg_temp.usdt_full_evidence()::text),'22023',
  'USDT_MANUAL_FULL_PAYOUT_REQUEST_MISMATCH','request fee cannot be nonzero');
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb,p_fee=>null)',
  pg_temp.usdt_full_evidence()::text),'22023',
  'USDT_MANUAL_FULL_PAYOUT_REQUEST_MISMATCH','request fee cannot be unknown');

select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb)',
  pg_temp.usdt_full_evidence(amount)::text),'22023',
  'USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID','noncanonical USDT evidence: '||amount)
from unnest(array['01','1.0','1.000000','1e0','.1','+1',' 1','0.0000001','1.1234567']) amount;
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb)',
  (pg_temp.usdt_full_evidence()||jsonb_build_object('requestedKrwAmount',amount))::text),
  '22023','USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID','noncanonical KRW evidence: '||amount)
from unnest(array['0','01000','1000.0','1e3','-1000','10000000000000000000']) amount;
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb,p_actual=>%L::numeric)',
  pg_temp.usdt_full_evidence()::text,amount),'22023',
  'USDT_MANUAL_FULL_PAYOUT_AMOUNT_MISMATCH','invalid actual USDT: '||coalesce(amount,'NULL'))
from unnest(array[null::text,'0','-1','NaN','Infinity','-Infinity','1.0000000','1.000001']) amount;
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb,p_requested=>%L::bigint)',
  pg_temp.usdt_full_evidence()::text,amount),'22023',
  'USDT_MANUAL_FULL_PAYOUT_REQUEST_MISMATCH','invalid requested KRW')
from unnest(array[null::bigint,0::bigint,-1::bigint,1001::bigint]) amount;
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb)',
  (pg_temp.usdt_full_evidence()||jsonb_build_object('requestedKrwAmount','9223372036854775808'))::text),
  '22023','USDT_MANUAL_FULL_PAYOUT_REQUEST_MISMATCH','overflow-sized string is never numeric-cast authority');
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb)',
  (pg_temp.usdt_full_evidence()||jsonb_build_object('withdrawalId','22222222-2222-4222-8222-222222222222'))::text),
  '22023','USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID','evidence belongs to another withdrawal ID');
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb,p_network=>%L)',
  pg_temp.usdt_full_evidence()::text,'ERC20'),'22023',
  'USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID','evidence network differs from immutable request network');
select throws_ok(format('select pg_temp.usdt_full_call(%L::jsonb,p_network=>%L)',
  pg_temp.usdt_full_evidence('1','UNKNOWN')::text,'UNKNOWN'),'22023',
  'USDT_MANUAL_FULL_PAYOUT_AMOUNT_MISMATCH','matching but unsupported network is rejected');

select ok(not prosecdef and provolatile='i',
  'pure helper is immutable SECURITY INVOKER')
from pg_proc where oid='app_private.assert_usdt_manual_full_payout(uuid,bigint,bigint,text,numeric,jsonb)'::regprocedure;
select ok(not prosecdef,'trigger function is SECURITY INVOKER')
from pg_proc where oid='app_private.enforce_usdt_manual_full_payout()'::regprocedure;
select ok(proconfig @> array['search_path=pg_catalog'], 'helper has fixed pg_catalog search_path')
from pg_proc where oid='app_private.assert_usdt_manual_full_payout(uuid,bigint,bigint,text,numeric,jsonb)'::regprocedure;
select ok(proconfig @> array['search_path=pg_catalog'], 'trigger has fixed pg_catalog search_path')
from pg_proc where oid='app_private.enforce_usdt_manual_full_payout()'::regprocedure;
select ok(not exists(select 1 from pg_proc p,
  lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid='app_private.assert_usdt_manual_full_payout(uuid,bigint,bigint,text,numeric,jsonb)'::regprocedure
    and a.grantee=0 and a.privilege_type='EXECUTE'),'helper has no PUBLIC execute');
select ok(not has_function_privilege(role,
  'app_private.assert_usdt_manual_full_payout(uuid,bigint,bigint,text,numeric,jsonb)','EXECUTE'),
  'helper denies '||role) from unnest(array['anon','authenticated']) role;
select ok(has_function_privilege('service_role',
  'app_private.assert_usdt_manual_full_payout(uuid,bigint,bigint,text,numeric,jsonb)','EXECUTE'),
  'service role may execute pure validator');
select ok(not exists(select 1 from pg_proc p,
  lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid='app_private.enforce_usdt_manual_full_payout()'::regprocedure
    and a.grantee=0 and a.privilege_type='EXECUTE'),'trigger has no PUBLIC execute');
select ok(not has_function_privilege(role,'app_private.enforce_usdt_manual_full_payout()','EXECUTE'),
  'trigger denies direct execute to '||role) from unnest(array['anon','authenticated','service_role']) role;
select is(count(*)::integer,2,'both guarded table triggers exist')
from pg_trigger where not tgisinternal and tgfoid='app_private.enforce_usdt_manual_full_payout()'::regprocedure
  and (tgname='withdrawal_external_sends_usdt_manual_contract' and tgrelid='public.withdrawal_external_sends'::regclass
    or tgname='withdrawal_requests_usdt_manual_completion' and tgrelid='public.withdrawal_requests'::regclass);
select ok(tgenabled='O' and (tgtype::integer & 3)=3,'send trigger is enabled BEFORE ROW')
from pg_trigger where tgname='withdrawal_external_sends_usdt_manual_contract' and tgrelid='public.withdrawal_external_sends'::regclass;
select ok(tgenabled='O' and (tgtype::integer & 3)=3,'completion trigger is enabled BEFORE ROW')
from pg_trigger where tgname='withdrawal_requests_usdt_manual_completion' and tgrelid='public.withdrawal_requests'::regclass;
select ok(pg_get_functiondef('app_private.enforce_usdt_manual_full_payout()'::regprocedure)
  like '%h.user_id is distinct from r.user_id%',
  'source guard explicitly binds historical destination owner; runtime ownership is still NOT_TESTED');

select * from finish();
rollback;
