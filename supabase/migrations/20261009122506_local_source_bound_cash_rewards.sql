begin;
-- Runnable review proposal. Installs no enabled configuration or monetary budget.
-- All activation/funding is synthetic LOCAL_QA; Production has no activation API.
insert into public.ledger_accounts(code,currency,account_class,normal_side,is_controlled_asset)
 values('PUTDUK:REFERRAL_REWARD_EXPENSE:KRW','KRW','EXPENSE','DEBIT',false),
 ('PUTDUK:EVENT_REWARD_EXPENSE:KRW','KRW','EXPENSE','DEBIT',false)on conflict(code)do nothing;
create table app_private.local_cash_configuration(
 singleton boolean primary key check(singleton),project_identity text not null
 check(project_identity='putduk-mining-review-r2-20261009-e-200642'),enabled boolean not null default false);
create table app_private.local_cash_approval_originals(
 audit_id uuid primary key references public.audit_logs(id),step_up_grant_id uuid not null unique,
 source_snapshot jsonb not null,digest text not null,captured_at timestamptz not null,captured_xid text not null);
create table app_private.local_cash_pilot_originals(
 id uuid primary key default gen_random_uuid(),starts_at timestamptz not null,ends_at timestamptz not null,
 referral_funded_ceiling_atomic bigint not null check(referral_funded_ceiling_atomic between 0 and 300000),
 event_funded_ceiling_atomic bigint not null check(event_funded_ceiling_atomic between 0 and 100000),
 approval_audit_id uuid not null unique references public.audit_logs(id),snapshot jsonb not null,digest text not null,
 check(ends_at=starts_at+interval '30 days'),check(referral_funded_ceiling_atomic+event_funded_ceiling_atomic<=400000));
create table app_private.local_cash_policies(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in('REFERRAL','EVENT')),
 pilot_id uuid not null references app_private.local_cash_pilot_originals(id),
 referral_program_id uuid references public.referral_program_versions(id),event_reward_id uuid references public.event_rewards(id),
 content_revision_id uuid references app_private.liveops_content_receipts(id),
 starts_at timestamptz not null,ends_at timestamptz not null check(ends_at>starts_at),
 source_type text not null check(source_type='MINING_SETTLEMENT_COMPLETED.v1'),
 terms_version integer not null check(terms_version>0),terms_ko text not null check(char_length(terms_ko) between 10 and 1000),
 approved_by uuid not null references auth.users(id),step_up_grant_id uuid not null unique,
 approval_audit_id uuid not null unique references public.audit_logs(id),snapshot jsonb not null,digest text not null,
 created_at timestamptz not null,
 check((kind='REFERRAL' and referral_program_id is not null and event_reward_id is null and content_revision_id is null)
 or(kind='EVENT' and referral_program_id is null and event_reward_id is not null and content_revision_id is not null)));
create unique index local_cash_referral_policy_once on app_private.local_cash_policies(referral_program_id) where kind='REFERRAL';
create unique index local_cash_event_policy_once on app_private.local_cash_policies(event_reward_id) where kind='EVENT';
create table app_private.local_cash_budget_tranches(
 id uuid primary key default gen_random_uuid(),policy_id uuid not null references app_private.local_cash_policies(id),
 synthetic_pool_id uuid not null,amount_atomic bigint not null check(amount_atomic>0),
 starts_at timestamptz not null,ends_at timestamptz not null check(ends_at>starts_at),
 approval_audit_id uuid not null unique references public.audit_logs(id),snapshot jsonb not null,digest text not null);
create table app_private.local_referral_attribution_originals(
 referral_id uuid primary key references public.referral_attributions(id),
 signup_event_id uuid not null unique references public.outbox_events(id),approval_audit_id uuid not null unique references public.audit_logs(id),
 snapshot jsonb not null,digest text not null);
create table app_private.local_cash_consents(
 policy_id uuid not null references app_private.local_cash_policies(id),user_id uuid not null references auth.users(id),
 join_original_id uuid not null references app_private.event_join_originals(id),
 accepted_terms_digest text not null,request_id uuid not null unique,accepted_at timestamptz not null,
 snapshot jsonb not null,digest text not null,primary key(policy_id,user_id));
create table app_private.local_cash_pending(
 id uuid primary key default gen_random_uuid(),policy_id uuid not null references app_private.local_cash_policies(id),
 referral_id uuid references public.referral_attributions(id),stage public.referral_stage,
 user_id uuid not null references auth.users(id),beneficiary_user_id uuid not null references auth.users(id),
 source_mission_id uuid not null references app_private.funded_mining_mission_originals(id),
 status text not null check(status in('PENDING_BUDGET','PENDING_CONTROL','PENDING_POLICY','AUTO_HOLD','PAID')),created_at timestamptz not null default clock_timestamp(),
 next_review_at timestamptz,unique(policy_id,user_id,stage),check((referral_id is null)=(stage is null)));
create unique index local_cash_referral_stage_once on app_private.local_cash_pending(referral_id,stage) where referral_id is not null;
create unique index local_cash_event_member_once on app_private.local_cash_pending(policy_id,user_id) where referral_id is null;
create table app_private.local_cash_originals(
 id uuid primary key default gen_random_uuid(),pending_id uuid not null unique references app_private.local_cash_pending(id),
 claim_id uuid not null unique,amount_atomic bigint not null check(amount_atomic>0),
 ledger_transaction_id uuid not null unique references public.ledger_transactions(id) deferrable initially deferred,
 wallet_ledger_id uuid not null unique references public.wallet_ledger(id) deferrable initially deferred,
 source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 effective_at timestamptz not null,risk_snapshot jsonb not null,snapshot jsonb not null,digest text not null);
create table app_private.local_cash_budget_allocations(
 cash_original_id uuid not null references app_private.local_cash_originals(id) deferrable initially deferred,
 tranche_id uuid not null references app_private.local_cash_budget_tranches(id),
 amount_atomic bigint not null check(amount_atomic>0),primary key(cash_original_id,tranche_id));
create table app_private.local_cash_referral_obligations(
 id uuid primary key default gen_random_uuid(),first_cash_original_id uuid not null references app_private.local_cash_originals(id)deferrable initially deferred,
 referral_id uuid not null references public.referral_attributions(id),policy_id uuid not null references app_private.local_cash_policies(id),
 tranche_id uuid not null references app_private.local_cash_budget_tranches(id),amount_atomic bigint not null check(amount_atomic>0),
 committed_at timestamptz not null,unique(referral_id,tranche_id));
alter table app_private.local_cash_budget_allocations add column obligation_id uuid unique references app_private.local_cash_referral_obligations(id);
create table app_private.local_cash_review_originals(
 event_id uuid primary key references public.outbox_events(id) deferrable initially deferred,
 pending_id uuid not null references app_private.local_cash_pending(id),generation integer not null check(generation>0),
 available_at timestamptz not null,snapshot jsonb not null,digest text not null,unique(pending_id,generation));

-- Every original is private, RLS enabled and append-only. Mutable pending rows
-- have no service grant; only the exact closed source consumer owns transitions.
do $$declare n text;begin
 foreach n in array array['local_cash_configuration','local_cash_approval_originals','local_cash_pilot_originals','local_cash_policies','local_cash_budget_tranches',
 'local_referral_attribution_originals','local_cash_consents','local_cash_pending','local_cash_originals',
 'local_cash_budget_allocations','local_cash_referral_obligations','local_cash_review_originals']loop
 execute format('alter table app_private.%I enable row level security',n);
 execute format('alter table app_private.%I force row level security',n);
 execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',n);
 if n<>'local_cash_pending' then execute format('create trigger %I before update or delete on app_private.%I for each row execute function app_private.prevent_row_mutation()',n||'_immutable',n);end if;
 end loop;
end$$;

create function app_private.capture_local_cash_approval(p_audit uuid)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare a public.audit_logs%rowtype;g public.admin_step_up_grants%rowtype;p_action text;p_target text;p_snapshot jsonb;source jsonb;native_xid xid;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='LOCAL_CASH_APPROVAL_OWNER_REQUIRED';end if;
 select audit.* into a from public.audit_logs audit where audit.id=p_audit;
 select xmin into native_xid from public.audit_logs where id=p_audit;
 p_action:=a.action;p_target:=a.target_id;p_snapshot:=a.after_state;
 -- An uncommitted audit visible through MVCC belongs to this transaction,
 -- including its subtransactions; top-level XID equality would reject valid
 -- commands executed inside an exception-safe transactional boundary.
 if pg_xact_status(native_xid::text::xid8)is distinct from 'in progress' or p_action not in('LOCAL_CASH_PILOT_APPROVED','LOCAL_CASH_POLICY_APPROVED','LOCAL_CASH_TRANCHE_APPROVED','LOCAL_REFERRAL_ATTRIBUTION_APPROVED')then
 raise exception using errcode='55000',message='LOCAL_CASH_SAME_TX_NATIVE_APPROVAL_REQUIRED';end if;
 select * into g from public.admin_step_up_grants where id=(p_snapshot->>'step_up_grant_id')::uuid;
 if a.id is null or a.action is distinct from p_action or a.target_type is distinct from 'LOCAL_QA_CASH'
 or a.target_id is distinct from p_target or a.actor_role is null or a.actor_role not in('ADMIN','SUPER_ADMIN')
 or a.after_state is distinct from p_snapshot or a.metadata->>'scope' is distinct from 'LOCAL_QA'
 or a.metadata->'synthetic_funding' is distinct from 'true'::jsonb
 or a.actor_user_id::text is distinct from p_snapshot->>'approved_by'
 or a.request_id::text is distinct from p_snapshot->>'request_id'
 or g.id is null or g.user_id is distinct from a.actor_user_id or g.command_family<>'LIVEOPS_CONTENT'
 or g.consumed_at is null or g.consume_request_id is distinct from a.request_id
 or g.admin_session_id::text is distinct from p_snapshot->>'admin_session_id'
 or g.consumed_at> a.created_at or a.created_at>g.expires_at
 or not exists(select 1 from public.user_roles where user_id=a.actor_user_id and role in('ADMIN','SUPER_ADMIN'))
 or not exists(select 1 from public.admin_sessions s join auth.sessions x on x.id::text=s.auth_session_id
 join auth.mfa_factors f on f.id=x.factor_id where s.id=g.admin_session_id and s.user_id=a.actor_user_id
 and x.user_id=a.actor_user_id and x.aal='aal2' and f.user_id=a.actor_user_id and f.factor_type='totp'and f.status='verified'
 and s.created_at<=g.consumed_at and s.idle_expires_at>g.consumed_at and s.absolute_expires_at>g.consumed_at
 and(s.revoked_at is null or s.revoked_at>g.consumed_at)
 and exists(select 1 from auth.mfa_amr_claims amr where amr.session_id=x.id and amr.authentication_method='totp'and amr.created_at<=g.issued_at))
 then raise exception using errcode='55000',message='LOCAL_CASH_APPROVAL_ORIGINAL_INVALID';end if;
 source:=jsonb_build_object('audit',to_jsonb(a),'grant',to_jsonb(g),'scope','LOCAL_QA','live_admin_checks','AAL2_TOTP_ROLE_SESSION_NATIVE');
 insert into app_private.local_cash_approval_originals(audit_id,step_up_grant_id,source_snapshot,digest,captured_at,captured_xid)
 values(a.id,g.id,source,app_private.funding_engine_digest(source),clock_timestamp(),pg_current_xact_id()::text);
end;$$;

create function app_private.assert_local_cash_approval(p_audit uuid,p_action text,p_target text,p_snapshot jsonb)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare a public.audit_logs%rowtype;o app_private.local_cash_approval_originals%rowtype;
begin
 select * into a from public.audit_logs where id=p_audit;
 select * into o from app_private.local_cash_approval_originals where audit_id=p_audit;
 if a.id is null or o.audit_id is null or o.digest is distinct from app_private.funding_engine_digest(o.source_snapshot)
 or o.source_snapshot->'audit' is distinct from to_jsonb(a)
 or o.source_snapshot->>'live_admin_checks' is distinct from 'AAL2_TOTP_ROLE_SESSION_NATIVE'
 or o.source_snapshot->>'scope' is distinct from 'LOCAL_QA'
 or o.step_up_grant_id::text is distinct from p_snapshot->>'step_up_grant_id'
 or o.source_snapshot->'grant'->>'id' is distinct from o.step_up_grant_id::text
 or a.action is distinct from p_action or a.target_type is distinct from 'LOCAL_QA_CASH'
 or a.target_id is distinct from p_target or a.after_state is distinct from p_snapshot
 then raise exception using errcode='55000',message='LOCAL_CASH_APPROVAL_ORIGINAL_INVALID';end if;
end;$$;

create function app_private.assert_local_cash_policy(p_id uuid,p_live_source boolean default false)returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare p app_private.local_cash_policies%rowtype;r public.referral_program_versions%rowtype;
 er public.event_rewards%rowtype;rule public.event_rules%rowtype;c app_private.liveops_content_receipts%rowtype;e public.events%rowtype;
 pilot app_private.local_cash_pilot_originals%rowtype;
begin
 select * into p from app_private.local_cash_policies where id=p_id;
 select * into pilot from app_private.local_cash_pilot_originals where id=p.pilot_id;
 if p.id is null or p.digest is distinct from app_private.funding_engine_digest(p.snapshot)
 or p.snapshot->'policy' is distinct from to_jsonb(p)-array['snapshot','digest']
 or p.snapshot->>'scope' is distinct from 'LOCAL_QA'
 or p.snapshot->>'risk_model' is distinct from 'NATIVE_SAME_TX_R2_V1'
 or p.snapshot->>'stage_2_delay_hours' is distinct from '24'
 or p.snapshot->>'approved_by' is distinct from p.approved_by::text
 or p.snapshot->>'step_up_grant_id' is distinct from p.step_up_grant_id::text
 or pilot.id is null or pilot.snapshot->'pilot' is distinct from to_jsonb(pilot)-array['snapshot','digest']
 or pilot.digest is distinct from app_private.funding_engine_digest(pilot.snapshot)
 or p.starts_at<pilot.starts_at or p.ends_at>pilot.ends_at
 then raise exception using errcode='55000',message='LOCAL_CASH_POLICY_INVALID';end if;
 perform app_private.assert_local_cash_approval(p.approval_audit_id,'LOCAL_CASH_POLICY_APPROVED',p.id::text,p.snapshot);
 perform app_private.assert_local_cash_approval(pilot.approval_audit_id,'LOCAL_CASH_PILOT_APPROVED',pilot.id::text,pilot.snapshot);
 if p.kind='REFERRAL'then
 select * into r from jsonb_populate_record(null::public.referral_program_versions,p.snapshot->'program');
 if p_live_source and p.snapshot->'program' is distinct from(select to_jsonb(v)from public.referral_program_versions v where id=p.referral_program_id)then
 raise exception using errcode='55000',message='LOCAL_REFERRAL_LIVE_PROGRAM_CHANGED';end if;
 if r.id is distinct from p.referral_program_id or r.stage_1_reward_atomic is distinct from 5000 or r.stage_2_reward_atomic is distinct from 5000
 or r.approved_by is distinct from p.approved_by or p.starts_at<r.effective_at
 or(r.retired_at is not null and p.ends_at>r.retired_at)
 or p.snapshot->'program' is distinct from to_jsonb(r)
 then raise exception using errcode='55000',message='LOCAL_REFERRAL_PROGRAM_INVALID';end if;
 else
 select * into er from jsonb_populate_record(null::public.event_rewards,p.snapshot->'reward');
 select * into rule from jsonb_populate_record(null::public.event_rules,p.snapshot->'rule');
 select * into e from jsonb_populate_record(null::public.events,p.snapshot->'event');
 if p_live_source and(p.snapshot->'reward' is distinct from(select to_jsonb(v)from public.event_rewards v where id=p.event_reward_id)
 or p.snapshot->'rule' is distinct from(select to_jsonb(v)from public.event_rules v where id=er.event_rule_id)
 or p.snapshot->'event' is distinct from(select to_jsonb(v)from public.events v where id=er.event_id))then
 raise exception using errcode='55000',message='LOCAL_CASH_LIVE_EVENT_CHANGED';end if;
 select * into c from app_private.liveops_content_receipts where id=p.content_revision_id;
 if er.id is distinct from p.event_reward_id or er.currency is distinct from 'KRW' or er.maximum_per_user is distinct from 1 or rule.id is null or rule.event_id is distinct from er.event_id
 or e.id is null or (e.status is null or e.status not in('SCHEDULED','LIVE','ENDED')) or c.id is null or c.state<>'PUBLISHED'
 or c.kind<>'EVENT' or c.content_id<>e.id or p.starts_at<e.starts_at or p.ends_at>e.ends_at
 or p.starts_at<rule.effective_from or(rule.effective_to is not null and p.ends_at>rule.effective_to)
 or p.snapshot->'reward' is distinct from to_jsonb(er) or p.snapshot->'rule' is distinct from to_jsonb(rule)
 or p.snapshot->>'content_digest' is distinct from c.digest
 or rule.rule_payload->>'cash_qualification' is distinct from 'ACTUAL_POSITIVE_SETTLEMENT_AFTER_EXPLICIT_CASH_CONSENT'
 then raise exception using errcode='55000',message='LOCAL_CASH_EVENT_TERMS_INVALID';end if;
 perform app_private.assert_liveops_receipt(c.id);
 end if;
end;$$;

create function app_private.assert_local_referral_attribution(p_id uuid)returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare o app_private.local_referral_attribution_originals%rowtype;a public.referral_attributions%rowtype;signup jsonb;
begin
 select * into o from app_private.local_referral_attribution_originals where referral_id=p_id;
 select * into a from public.referral_attributions where id=p_id;
 signup:=app_private.read_member_profile_capture_original(o.signup_event_id);
 if o.referral_id is null or a.id is null or a.referrer_user_id=a.referred_user_id
 or o.digest is distinct from app_private.funding_engine_digest(o.snapshot)
 or o.snapshot->'attribution' is distinct from to_jsonb(a)
 or o.snapshot->>'signup_original_digest' is distinct from app_private.funding_engine_digest(signup)
 or signup->'event'->>'aggregate_id' is distinct from a.referred_user_id::text
 or a.attributed_at<(signup->'event'->>'occurred_at')::timestamptz
 or a.attributed_at>(signup->'event'->>'occurred_at')::timestamptz+interval '5 minutes'
 or a.attributed_at>clock_timestamp()
 or not exists(select 1 from auth.users where id=a.referrer_user_id and created_at<=a.attributed_at)
 then raise exception using errcode='55000',message='LOCAL_REFERRAL_ATTRIBUTION_INVALID';end if;
 perform app_private.assert_local_cash_approval(o.approval_audit_id,'LOCAL_REFERRAL_ATTRIBUTION_APPROVED',a.id::text,o.snapshot);
end;$$;

create function app_private.read_local_cash_risk(p_users uuid[])returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare u uuid;k public.kyc_cases%rowtype;cases jsonb:='[]';flags jsonb;ring boolean;blocked boolean:=false;
begin
 -- Writer acquires sorted canonical member locks first. These table SHARE locks
 -- prevent phantom risk/graph/KYC decisions during the same atomic acceptance.
 lock table public.kyc_cases,public.kyc_status_history,public.risk_flags,public.referral_attributions,public.block_rules in share mode;
 perform 1 from auth.users where id=any(p_users)order by id for share;
 foreach u in array p_users loop
 select * into k from public.kyc_cases where user_id=u order by opened_at desc,id desc limit 1;
 if k.id is null or k.status<>'APPROVED' or k.decided_at is null or k.decided_at>clock_timestamp()
 or k.risk_level not in('LOW','MEDIUM') or not exists(select 1 from public.kyc_status_history h
 where h.case_id=k.id and h.to_status='APPROVED' and h.created_at<=k.decided_at and h.actor_user_id=k.reviewed_by)
 or not exists(select 1 from auth.users where id=u and deleted_at is null and(banned_until is null or banned_until<=clock_timestamp()))
 or exists(select 1 from public.block_rules where user_id=u and scope='ACCOUNT' and starts_at<=clock_timestamp()
 and(ends_at is null or ends_at>clock_timestamp()))then blocked:=true;end if;
 cases:=cases||jsonb_build_array(jsonb_build_object('user_id',u,'case_id',k.id,'status',k.status,'risk_level',k.risk_level,'decided_at',k.decided_at));
 end loop;
 select coalesce(jsonb_agg(to_jsonb(f)order by f.id),'[]')into flags from public.risk_flags f where user_id=any(p_users)
 and resolved_at is null and severity in('HIGH','CRITICAL') and flag_code<>'SHARED_IP';
 with recursive path(u,seen,depth,cycle)as(
 select v,array[v],0,false from unnest(p_users)v
 union all select r.referrer_user_id,p.seen||r.referrer_user_id,p.depth+1,r.referrer_user_id=any(p.seen)
 from path p join public.referral_attributions r on r.referred_user_id=p.u where not p.cycle and p.depth<100)
 select coalesce(bool_or(cycle or depth=100),false)into ring from path;
 return jsonb_build_object('model','NATIVE_SAME_TX_R2_V1','evaluated_at',clock_timestamp(),'kyc',cases,'blocking_flags',flags,
 'ring_or_unresolved_depth',ring,'shared_ip_alone_rejects',false,
 'decision',case when blocked or ring or jsonb_array_length(flags)>0 then 'AUTO_HOLD'else 'CLEAR'end);
end;$$;

create function app_private.assert_local_cash_tranche(p_id uuid)returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare t app_private.local_cash_budget_tranches%rowtype;p app_private.local_cash_policies%rowtype;
begin
 select * into t from app_private.local_cash_budget_tranches where id=p_id;
 select * into p from app_private.local_cash_policies where id=t.policy_id;
 if t.id is null or p.id is null or t.digest is distinct from app_private.funding_engine_digest(t.snapshot)
 or t.snapshot->'tranche' is distinct from to_jsonb(t)-array['snapshot','digest']
 or t.starts_at<p.starts_at
 or t.snapshot->>'funding_kind' is distinct from 'SYNTHETIC_LOCAL_QA_TREASURY'
 then raise exception using errcode='55000',message='LOCAL_CASH_FUNDED_TRANCHE_INVALID';end if;
 perform app_private.assert_local_cash_policy(p.id);
 perform app_private.assert_local_cash_approval(t.approval_audit_id,'LOCAL_CASH_TRANCHE_APPROVED',t.id::text,t.snapshot);
 if (select coalesce(sum(amount_atomic),0)from app_private.local_cash_budget_allocations where tranche_id=t.id)
 +(select coalesce(sum(b.amount_atomic),0)from app_private.local_cash_referral_obligations b where b.tranche_id=t.id
 and not exists(select 1 from app_private.local_cash_budget_allocations al where al.obligation_id=b.id))>t.amount_atomic then
 raise exception using errcode='55000',message='LOCAL_CASH_TRANCHE_OVERSPENT';end if;
end;$$;

create function app_private.local_cash_snapshot(p app_private.local_cash_originals)returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
select jsonb_build_object('cash',to_jsonb(p)-array['snapshot','digest'],'pending',to_jsonb(q)-array['status','next_review_at'],
 'policy_digest',pol.digest,'mission_digest',m.digest,'scope','LOCAL_QA')
from app_private.local_cash_pending q join app_private.local_cash_policies pol on pol.id=q.policy_id
join app_private.funded_mining_mission_originals m on m.id=q.source_mission_id where q.id=p.pending_id;$$;

create function app_private.assert_local_cash_posting(p_id uuid,p_source_required boolean)returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare o app_private.local_cash_originals%rowtype;q app_private.local_cash_pending%rowtype;p app_private.local_cash_policies%rowtype;
 j public.ledger_transactions%rowtype;w public.wallet_ledger%rowtype;e public.outbox_events%rowtype;a public.audit_logs%rowtype;
 r public.referral_program_versions%rowtype;att public.referral_attributions%rowtype;m app_private.funded_mining_mission_originals%rowtype;
 prior app_private.local_cash_originals%rowtype;er public.event_rewards%rowtype;cs app_private.local_cash_consents%rowtype;joined app_private.event_join_originals%rowtype;
 kind text;reference_kind text;amount bigint;expense text;k text;t record;deposit public.money_source_movements%rowtype;
begin
 select * into o from app_private.local_cash_originals where id=p_id;
 select * into q from app_private.local_cash_pending where id=o.pending_id;
 select * into p from app_private.local_cash_policies where id=q.policy_id;
 select * into m from app_private.funded_mining_mission_originals where id=q.source_mission_id;
 if o.id is null or q.id is null or p.id is null or m.id is null or q.status<>'PAID'
 or m.source_type<>'MINING_SETTLEMENT_COMPLETED.v1' or m.user_id<>q.user_id
 or o.effective_at<m.observed_at or o.effective_at<p.starts_at
 or o.snapshot is distinct from app_private.local_cash_snapshot(o) or o.digest is distinct from app_private.funding_engine_digest(o.snapshot)
 or o.risk_snapshot->>'decision' is distinct from 'CLEAR' or o.risk_snapshot->>'model' is distinct from 'NATIVE_SAME_TX_R2_V1'
 or o.risk_snapshot->>'evaluated_at' is null or(o.risk_snapshot->>'evaluated_at')::timestamptz>o.effective_at
 or o.effective_at>clock_timestamp()
 then raise exception using errcode='55000',message='LOCAL_CASH_ORIGINAL_INVALID';end if;
 perform app_private.assert_local_cash_policy(p.id);perform app_private.assert_funded_mining_mission_original(m.id);
 perform app_private.assert_funded_mining_mission_original((select id from app_private.funded_mining_mission_originals
 where activation_id=m.activation_id and source_type='MINING_STARTED.v1'));
 select * into deposit from public.money_source_movements where user_id=q.user_id and movement_kind='CREDIT'
 and source_bucket='PRINCIPAL' and origin_code in('KRW_DEPOSIT','USDT_KRW_DEPOSIT') and effective_at<=m.effective_at order by effective_at,id limit 1;
 if deposit.id is null then raise exception using errcode='55000',message='LOCAL_CASH_VERIFIED_FUNDING_REQUIRED';end if;
 perform app_private.assert_money_source_credit_complete(deposit);
 if p.kind='REFERRAL'then
 select * into r from jsonb_populate_record(null::public.referral_program_versions,p.snapshot->'program');
 select * into att from public.referral_attributions where id=q.referral_id;
 perform app_private.assert_local_referral_attribution(att.id);
 amount:=case q.stage when 'STAGE_1'then r.stage_1_reward_atomic else r.stage_2_reward_atomic end;
 if att.referrer_user_id is distinct from q.beneficiary_user_id or att.referred_user_id is distinct from q.user_id
 or m.effective_at<att.attributed_at or att.attributed_at<p.starts_at or att.attributed_at>=p.ends_at then
 raise exception using errcode='55000',message='LOCAL_CASH_REFERRAL_BENEFICIARY_INVALID';end if;
 if q.stage='STAGE_2'then
 select x.* into prior from app_private.local_cash_originals x join app_private.local_cash_pending y on y.id=x.pending_id
 where y.referral_id=q.referral_id and y.stage='STAGE_1';
 if prior.id is null or prior.id=o.id or prior.effective_at+interval '24 hours'>m.effective_at
 or (select source_mission_id from app_private.local_cash_pending where id=prior.pending_id)=m.id
 or (select policy_id from app_private.local_cash_pending where id=prior.pending_id)<>p.id then
 raise exception using errcode='55000',message='LOCAL_CASH_STAGE_2_ACTIVITY_INVALID';end if;
 end if;
 if q.stage='STAGE_1'and (select coalesce(sum(amount_atomic),0)from app_private.local_cash_referral_obligations where first_cash_original_id=o.id and referral_id=q.referral_id and policy_id=p.id)<>r.stage_2_reward_atomic then
 raise exception using errcode='55000',message='LOCAL_CASH_STAGE_2_NOT_RESERVED';end if;
 if not exists(select 1 from public.referral_reward_claims c join public.referral_qualifications f on f.id=c.qualification_id
 where c.id=o.claim_id and c.beneficiary_user_id=q.beneficiary_user_id and c.amount_atomic=o.amount_atomic and c.status='PAID'
 and c.ledger_transaction_id=o.ledger_transaction_id and c.paid_at=o.effective_at and f.referral_id=q.referral_id and f.stage=q.stage
 and f.program_version_id=p.referral_program_id and f.status='PAID' and f.rule_version=r.version and f.risk_model_version='NATIVE_SAME_TX_R2_V1')then
 raise exception using errcode='55000',message='LOCAL_CASH_REFERRAL_CLAIM_INVALID';end if;
 kind:='REFERRAL_REWARD';reference_kind:='referral_reward_claim';expense:='PUTDUK:REFERRAL_REWARD_EXPENSE:KRW';
 else
 select * into er from jsonb_populate_record(null::public.event_rewards,p.snapshot->'reward');
 select * into cs from app_private.local_cash_consents where policy_id=p.id and user_id=q.user_id;
 if cs.user_id is null or cs.accepted_terms_digest<>p.digest or cs.accepted_at>m.effective_at
 or cs.snapshot is distinct from to_jsonb(cs)-array['snapshot','digest'] or cs.digest is distinct from app_private.funding_engine_digest(cs.snapshot)
 or q.beneficiary_user_id<>q.user_id or m.effective_at<p.starts_at or m.effective_at>=p.ends_at
 then raise exception using errcode='55000',message='LOCAL_CASH_EXPLICIT_CONSENT_REQUIRED';end if;
 select * into joined from app_private.event_join_originals where id=cs.join_original_id;
 if row(joined.user_id,joined.event_id,joined.revision_id)is distinct from row(q.user_id,er.event_id,p.content_revision_id)then
 raise exception using errcode='55000',message='LOCAL_CASH_CONSENT_JOIN_BINDING_INVALID';end if;
 perform app_private.assert_event_join(cs.join_original_id);
 amount:=er.amount_atomic;
 if not exists(select 1 from public.event_reward_claims c where c.id=o.claim_id and c.event_id=er.event_id
 and c.event_rule_id=er.event_rule_id and c.event_reward_id=er.id and c.user_id=q.user_id and c.status='PAID'
 and c.amount_atomic=o.amount_atomic and c.ledger_transaction_id=o.ledger_transaction_id and c.paid_at=o.effective_at)then
 raise exception using errcode='55000',message='LOCAL_CASH_EVENT_CLAIM_INVALID';end if;
 kind:='EVENT_REWARD';reference_kind:='event_reward_claim';expense:='PUTDUK:EVENT_REWARD_EXPENSE:KRW';
 end if;
 if amount is distinct from o.amount_atomic then raise exception using errcode='55000',message='LOCAL_CASH_AMOUNT_NOT_APPROVED';end if;
 select * into j from public.ledger_transactions where id=o.ledger_transaction_id;
 select * into w from public.wallet_ledger where id=o.wallet_ledger_id;
 select * into e from public.outbox_events where id=o.source_event_id;
 select * into a from public.audit_logs where id=o.audit_id;
 k:='local-cash:'||q.id::text;
 if j.id is null or w.id is null or e.id is null or a.id is null or j.category::text<>kind or j.currency<>'KRW'
 or j.member_user_id is distinct from q.beneficiary_user_id or j.reference_type is distinct from reference_kind or j.reference_id is distinct from o.claim_id
 or j.idempotency_key<>k||':ledger' or j.posted_at<>o.effective_at or j.metadata is distinct from jsonb_build_object('cash_original_id',o.id,'digest',o.digest,'scope','LOCAL_QA')
 or w.user_id<>q.beneficiary_user_id or w.direction<>'CREDIT' or w.entry_type::text<>kind or w.amount_atomic<>amount
 or w.reference_type is distinct from reference_kind or w.reference_id is distinct from o.claim_id or w.idempotency_key<>k||':wallet'
 or not exists(select 1 from public.wallet_accounts where id=w.wallet_account_id and user_id=q.beneficiary_user_id and currency='KRW')
 or e.event_type is distinct from kind||'_PAID.v1' or e.schema_version is distinct from 1 or e.aggregate_type is distinct from reference_kind or e.aggregate_id is distinct from o.claim_id
 or e.actor_user_id is distinct from q.beneficiary_user_id or e.request_id is distinct from j.request_id or e.correlation_id is distinct from j.correlation_id
 or e.causation_id is distinct from m.outbox_id or e.occurred_at is distinct from o.effective_at or e.idempotency_key<>k||':event'
 or e.payload is distinct from jsonb_build_object('cash_original_id',o.id,'digest',o.digest,'user_id',q.beneficiary_user_id,
 'claim_id',o.claim_id,'amount_atomic',amount::text,'currency','KRW','ledger_transaction_id',o.ledger_transaction_id,'wallet_ledger_id',o.wallet_ledger_id)
 or a.action is distinct from 'LOCAL_CASH_REWARD_PAID' or a.target_type is distinct from reference_kind or a.target_id is distinct from o.claim_id::text
 or a.actor_user_id is not null or a.actor_role is not null or a.after_state is distinct from o.snapshot or a.request_id<>j.request_id
 or (select count(*)from public.ledger_entries where transaction_id=j.id)<>2
 or not exists(select 1 from public.ledger_entries le join public.ledger_accounts la on la.id=le.account_id
 where le.transaction_id=j.id and le.sequence=0 and le.side='DEBIT' and le.amount_atomic=amount and la.code=expense
 and la.currency='KRW' and la.account_class='EXPENSE' and la.normal_side='DEBIT' and la.owner_user_id is null and not la.is_controlled_asset)
 or not exists(select 1 from public.ledger_entries le join public.ledger_accounts la on la.id=le.account_id
 where le.transaction_id=j.id and le.sequence=1 and le.side='CREDIT' and le.amount_atomic=amount
 and la.code='USER:'||upper(q.beneficiary_user_id::text)||':KRW:LIABILITY' and la.currency='KRW' and la.account_class='LIABILITY'
 and la.normal_side='CREDIT' and la.owner_user_id=q.beneficiary_user_id and not la.is_controlled_asset)
 or (select coalesce(sum(amount_atomic),0)from app_private.local_cash_budget_allocations where cash_original_id=o.id)<>amount
 then raise exception using errcode='55000',message='LOCAL_CASH_JOURNAL_RECEIPT_INVALID';end if;
 for t in select b.*,al.obligation_id,al.amount_atomic as allocated_atomic from app_private.local_cash_budget_allocations al join app_private.local_cash_budget_tranches b on b.id=al.tranche_id where al.cash_original_id=o.id loop
 perform app_private.assert_local_cash_tranche(t.id);
 if t.policy_id<>p.id or(t.obligation_id is null and(o.effective_at<t.starts_at or o.effective_at>=t.ends_at))
 or(t.obligation_id is not null and not exists(select 1 from app_private.local_cash_referral_obligations ob
 where ob.id=t.obligation_id and ob.policy_id=p.id and ob.referral_id=q.referral_id and ob.tranche_id=t.id
 and ob.amount_atomic=t.allocated_atomic and ob.committed_at>=t.starts_at and ob.committed_at<t.ends_at and q.stage='STAGE_2'))
 or(p.kind='REFERRAL'and q.stage='STAGE_2'and t.obligation_id is null)
 or((p.kind='EVENT'or q.stage='STAGE_1')and t.obligation_id is not null)then
 raise exception using errcode='55000',message='LOCAL_CASH_TRANCHE_WINDOW_INVALID';end if;
 end loop;
 if p_source_required and not exists(select 1 from public.money_source_movements mv where mv.user_id=q.beneficiary_user_id
 and mv.movement_kind='CREDIT' and mv.source_bucket='BONUS' and mv.origin_code=kind and mv.amount_atomic=amount
 and mv.ledger_transaction_id=o.ledger_transaction_id and mv.wallet_ledger_id=o.wallet_ledger_id
 and mv.source_event_id=o.source_event_id and mv.effective_at=o.effective_at)then
 raise exception using errcode='55000',message='LOCAL_CASH_BONUS_PROVENANCE_MISSING';end if;
end;$$;

create function app_private.assert_local_cash_credit(p_move public.money_source_movements)returns void
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare o app_private.local_cash_originals%rowtype;q app_private.local_cash_pending%rowtype;p app_private.local_cash_policies%rowtype;
begin
 if current_user<>'postgres' or current_setting('role',true)is distinct from 'service_role' or auth.role()is distinct from 'service_role' then
 raise exception using errcode='42501',message='LOCAL_CASH_NATIVE_SERVICE_REQUIRED';end if;
 select * into o from app_private.local_cash_originals where source_event_id=p_move.source_event_id;
 select * into q from app_private.local_cash_pending where id=o.pending_id;
 select * into p from app_private.local_cash_policies where id=q.policy_id;
 if o.id is null or p_move.movement_kind<>'CREDIT' or p_move.source_bucket<>'BONUS'
 or p_move.origin_code is distinct from(case p.kind when 'REFERRAL'then 'REFERRAL_REWARD'else 'EVENT_REWARD'end)
 or row(p_move.user_id,p_move.amount_atomic,p_move.ledger_transaction_id,p_move.wallet_ledger_id,p_move.effective_at)
 is distinct from row(q.beneficiary_user_id,o.amount_atomic,o.ledger_transaction_id,o.wallet_ledger_id,o.effective_at)
 then raise exception using errcode='55000',message='LOCAL_CASH_SOURCE_NOT_CONNECTED';end if;
 perform app_private.assert_local_cash_posting(o.id,false);
end;$$;

create function app_private.verify_local_cash_commit()returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_table_name='local_cash_budget_allocations'then perform app_private.assert_local_cash_posting(new.cash_original_id,true);return null;
 elsif tg_table_name='local_cash_referral_obligations'then perform app_private.assert_local_cash_posting(new.first_cash_original_id,true);return null;
 elsif tg_table_name='local_cash_policies'then perform app_private.assert_local_cash_policy(new.id,true);return null;
 elsif tg_table_name='local_referral_attribution_originals'then perform app_private.assert_local_referral_attribution(new.referral_id);return null;
 end if;
 if tg_table_name='local_cash_budget_tranches'then
 if current_setting('transaction_isolation')<>'read committed'then raise exception using errcode='25000',message='LOCAL_CASH_READ_COMMITTED_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-local-cash-pilot:'||(select pilot_id from app_private.local_cash_policies where id=new.policy_id),0));
 perform app_private.assert_local_cash_tranche(new.id);
 if exists(select 1 from app_private.local_cash_pilot_originals pilot where pilot.id=(select pilot_id from app_private.local_cash_policies where id=new.policy_id)
 and ((select coalesce(sum(t.amount_atomic),0)from app_private.local_cash_budget_tranches t join app_private.local_cash_policies p on p.id=t.policy_id where p.pilot_id=pilot.id and p.kind='REFERRAL')>pilot.referral_funded_ceiling_atomic
 or(select coalesce(sum(t.amount_atomic),0)from app_private.local_cash_budget_tranches t join app_private.local_cash_policies p on p.id=t.policy_id where p.pilot_id=pilot.id and p.kind='EVENT')>pilot.event_funded_ceiling_atomic))then
 raise exception using errcode='55000',message='LOCAL_CASH_GLOBAL_PILOT_FUNDED_CEILING';end if;return null;
 end if;
 if tg_table_name='outbox_events'then
 if tg_op='INSERT'then
 if new.event_type in('REFERRAL_REWARD_PAID.v1','EVENT_REWARD_PAID.v1')and not exists(select 1 from app_private.local_cash_originals where source_event_id=new.id)then
 raise exception using errcode='55000',message='LOCAL_CASH_PAID_ORIGINAL_REQUIRED';end if;
 if new.event_type='LOCAL_CASH_REVIEW.v1'and not exists(select 1 from app_private.local_cash_review_originals r
 where r.event_id=new.id and new.aggregate_id=r.pending_id and new.schema_version=1 and new.aggregate_type='local_cash_pending'
 and new.payload=jsonb_build_object('review_original_id',r.event_id,'digest',r.digest)and new.available_at=r.available_at)then
 raise exception using errcode='55000',message='LOCAL_CASH_REVIEW_ORIGINAL_INVALID';end if;
 return new;
 end if;
 if old.event_type in('REFERRAL_REWARD_PAID.v1','EVENT_REWARD_PAID.v1','LOCAL_CASH_REVIEW.v1')
 and(tg_op='DELETE'or to_jsonb(new)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']
 is distinct from to_jsonb(old)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at'])then
 raise exception using errcode='55000',message='LOCAL_CASH_SOURCE_ENVELOPE_IMMUTABLE';end if;
 if tg_op='UPDATE'and new.event_type in('REFERRAL_REWARD_PAID.v1','EVENT_REWARD_PAID.v1','LOCAL_CASH_REVIEW.v1')and new.event_type is distinct from old.event_type then
 raise exception using errcode='55000',message='LOCAL_CASH_SOURCE_NAMESPACE_RESERVED';end if;
 if tg_op='DELETE'then return old;end if;return new;
 elsif tg_table_name='referral_attributions'then
 if exists(select 1 from app_private.local_referral_attribution_originals where referral_id=old.id)then
 raise exception using errcode='55000',message='LOCAL_REFERRAL_ATTRIBUTION_IMMUTABLE';end if;
 if tg_op='DELETE'then return old;end if;return new;
 elsif tg_table_name in('referral_reward_claims','event_reward_claims')then
 if old.status='PAID'and exists(select 1 from app_private.local_cash_originals where claim_id=old.id)then
 raise exception using errcode='55000',message='LOCAL_CASH_PAID_CLAIM_IMMUTABLE';end if;
 if tg_op='DELETE'then return old;end if;return new;
 end if;
 if current_user<>'postgres' or current_setting('role',true)is distinct from 'service_role' or auth.role()is distinct from 'service_role' then
 raise exception using errcode='42501',message='LOCAL_CASH_NATIVE_SERVICE_REQUIRED';end if;
 perform app_private.assert_local_cash_posting(new.id,true);return null;
end;$$;
create constraint trigger local_cash_complete after insert on app_private.local_cash_originals deferrable initially deferred
 for each row execute function app_private.verify_local_cash_commit();
create constraint trigger local_cash_funded_pilot_ceiling after insert on app_private.local_cash_budget_tranches deferrable initially deferred
 for each row execute function app_private.verify_local_cash_commit();
create trigger local_cash_outbox_original_guard before insert or update or delete on public.outbox_events
 for each row execute function app_private.verify_local_cash_commit();
create trigger local_cash_referral_claim_guard before update or delete on public.referral_reward_claims
 for each row execute function app_private.verify_local_cash_commit();
create trigger local_cash_event_claim_guard before update or delete on public.event_reward_claims
 for each row execute function app_private.verify_local_cash_commit();
create constraint trigger local_cash_allocation_complete after insert on app_private.local_cash_budget_allocations deferrable initially deferred
 for each row execute function app_private.verify_local_cash_commit();
create constraint trigger local_cash_obligation_complete after insert on app_private.local_cash_referral_obligations deferrable initially deferred
 for each row execute function app_private.verify_local_cash_commit();
create constraint trigger local_cash_policy_complete after insert on app_private.local_cash_policies deferrable initially deferred
 for each row execute function app_private.verify_local_cash_commit();
create constraint trigger local_cash_attribution_complete after insert on app_private.local_referral_attribution_originals deferrable initially deferred
 for each row execute function app_private.verify_local_cash_commit();
create trigger local_cash_referral_attribution_guard before update or delete on public.referral_attributions
 for each row execute function app_private.verify_local_cash_commit();

create function app_private.schedule_local_cash_review(p_pending uuid)returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare r app_private.local_cash_review_originals%rowtype;q app_private.local_cash_pending%rowtype;m app_private.funded_mining_mission_originals%rowtype;
begin
 select * into q from app_private.local_cash_pending where id=p_pending;
 if q.status='PAID' or exists(select 1 from app_private.local_cash_review_originals x join public.outbox_events e on e.id=x.event_id
 where x.pending_id=q.id and e.status in('PENDING','PROCESSING'))then return;end if;
 select * into m from app_private.funded_mining_mission_originals where id=q.source_mission_id;
 r.event_id:=gen_random_uuid();r.pending_id:=q.id;r.generation:=(select coalesce(max(generation),0)+1 from app_private.local_cash_review_originals where pending_id=q.id);
 r.available_at:=clock_timestamp()+interval '1 minute';
 r.snapshot:=to_jsonb(r)-array['snapshot','digest'];r.digest:=app_private.funding_engine_digest(r.snapshot);
 insert into app_private.local_cash_review_originals select r.*;
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,
 causation_id,idempotency_key,available_at)
 values(r.event_id,'LOCAL_CASH_REVIEW.v1',1,'local_cash_pending',q.id,q.user_id,
 jsonb_build_object('review_original_id',r.event_id,'digest',r.digest),r.event_id,r.event_id,m.outbox_id,
 'local-cash-review:'||q.id||':'||r.generation,r.available_at);
 update app_private.local_cash_pending set next_review_at=r.available_at where id=q.id;
end;$$;

create function app_private.post_local_cash_pending(p_id uuid)returns boolean
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare q app_private.local_cash_pending%rowtype;p app_private.local_cash_policies%rowtype;m app_private.funded_mining_mission_originals%rowtype;
 o app_private.local_cash_originals%rowtype;r public.referral_program_versions%rowtype;er public.event_rewards%rowtype;
 risk jsonb;users uuid[];wallet uuid;qual uuid;kind text;refkind text;expense text;k text;left_amount bigint;available bigint;t record;rid uuid;
 reserve_amount bigint:=0;take_amount bigint;ob app_private.local_cash_referral_obligations%rowtype;
begin
 select * into q from app_private.local_cash_pending where id=p_id for update;
 select * into p from app_private.local_cash_policies where id=q.policy_id;
 select * into m from app_private.funded_mining_mission_originals where id=q.source_mission_id;
 select * into o from app_private.local_cash_originals where pending_id=q.id;
 if o.id is not null then perform app_private.assert_local_cash_posting(o.id,true);return false;end if;
 perform app_private.assert_local_cash_policy(p.id);perform app_private.assert_funded_mining_mission_original(m.id);
 if p.kind='EVENT'then
 -- Current cancellation blocks new money; sealed historical terms remain valid
 -- for already-paid BONUS provenance. Row SHARE serializes canonical CANCEL.
 select rw.* into er from jsonb_populate_record(null::public.event_rewards,p.snapshot->'reward')rw;
 perform 1 from public.events where id=er.event_id and status in('SCHEDULED','LIVE','ENDED')for share;
 if not found or exists(select 1 from app_private.liveops_content_receipts lr where lr.content_id=er.event_id and lr.kind='EVENT'and lr.state='CANCELLED')then
 update app_private.local_cash_pending set status='PENDING_POLICY'where id=q.id;return false;end if;
 end if;
 -- End of recruitment/qualification does not confiscate an already qualified
 -- pending liability. A new separately approved funded tranche can pay it later.
 if clock_timestamp()<p.starts_at then
 update app_private.local_cash_pending set status='PENDING_POLICY'where id=q.id;return false;end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:SETTLEMENT',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:'||case p.kind when 'REFERRAL'then 'REFERRAL_PAYOUT'else 'EVENT_PAYOUT'end,0));
 if exists(select 1 from public.safe_mode_controls where component in('GLOBAL','SETTLEMENT',case p.kind when 'REFERRAL'then 'REFERRAL_PAYOUT'else 'EVENT_PAYOUT'end)and is_paused and starts_at<=clock_timestamp())then
 update app_private.local_cash_pending set status='PENDING_CONTROL'where id=q.id;return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-local-cash-budget:'||p.id,0));
 if p.kind='REFERRAL'then
 perform app_private.assert_local_referral_attribution(q.referral_id);
 select array[referrer_user_id,referred_user_id]into users from public.referral_attributions where id=q.referral_id;
 select * into r from jsonb_populate_record(null::public.referral_program_versions,p.snapshot->'program');
 o.amount_atomic:=case q.stage when 'STAGE_1'then r.stage_1_reward_atomic else r.stage_2_reward_atomic end;
 if q.stage='STAGE_1'then reserve_amount:=r.stage_2_reward_atomic;end if;
 kind:='REFERRAL_REWARD';refkind:='referral_reward_claim';expense:='PUTDUK:REFERRAL_REWARD_EXPENSE:KRW';
 else
 users:=array[q.user_id];select * into er from jsonb_populate_record(null::public.event_rewards,p.snapshot->'reward');
 o.amount_atomic:=er.amount_atomic;kind:='EVENT_REWARD';refkind:='event_reward_claim';expense:='PUTDUK:EVENT_REWARD_EXPENSE:KRW';
 end if;
 risk:=app_private.read_local_cash_risk(users);
 if risk->>'decision'<>'CLEAR'then
 update app_private.local_cash_pending set status='AUTO_HOLD'where id=q.id;return false;end if;
 available:=0;
 if p.kind='REFERRAL'and q.stage='STAGE_2'then
 select coalesce(sum(b.amount_atomic),0)into available from app_private.local_cash_referral_obligations b where b.referral_id=q.referral_id and b.policy_id=p.id
 and not exists(select 1 from app_private.local_cash_budget_allocations al where al.obligation_id=b.id);
 else
 for t in select * from app_private.local_cash_budget_tranches where policy_id=p.id and starts_at<=clock_timestamp()and ends_at>clock_timestamp()order by ends_at,id loop
 perform app_private.assert_local_cash_tranche(t.id);
 available:=available+(t.amount_atomic-(select coalesce(sum(amount_atomic),0)from app_private.local_cash_budget_allocations where tranche_id=t.id)
 -(select coalesce(sum(b.amount_atomic),0)from app_private.local_cash_referral_obligations b where b.tranche_id=t.id and not exists(select 1 from app_private.local_cash_budget_allocations al where al.obligation_id=b.id)));
 end loop;
 end if;
 if available<o.amount_atomic+reserve_amount then update app_private.local_cash_pending set status='PENDING_BUDGET'where id=q.id;return false;end if;
 o.id:=gen_random_uuid();o.pending_id:=q.id;o.claim_id:=gen_random_uuid();o.ledger_transaction_id:=gen_random_uuid();o.wallet_ledger_id:=gen_random_uuid();
 o.source_event_id:=gen_random_uuid();o.audit_id:=gen_random_uuid();o.effective_at:=clock_timestamp();o.risk_snapshot:=risk;
 update app_private.local_cash_pending set status='PAID',next_review_at=null where id=q.id;
 o.snapshot:=app_private.local_cash_snapshot(o);o.digest:=app_private.funding_engine_digest(o.snapshot);
 insert into app_private.local_cash_originals select o.*;
 left_amount:=o.amount_atomic;
 if p.kind='REFERRAL'and q.stage='STAGE_2'then
 for ob in select * from app_private.local_cash_referral_obligations b where b.referral_id=q.referral_id and b.policy_id=p.id
 and not exists(select 1 from app_private.local_cash_budget_allocations al where al.obligation_id=b.id)order by b.id loop
 insert into app_private.local_cash_budget_allocations(cash_original_id,tranche_id,amount_atomic,obligation_id)values(o.id,ob.tranche_id,ob.amount_atomic,ob.id);
 left_amount:=left_amount-ob.amount_atomic;end loop;
 else
 for t in select * from app_private.local_cash_budget_tranches where policy_id=p.id and starts_at<=o.effective_at and ends_at>o.effective_at order by ends_at,id loop
 available:=t.amount_atomic-(select coalesce(sum(amount_atomic),0)from app_private.local_cash_budget_allocations where tranche_id=t.id)
 -(select coalesce(sum(b.amount_atomic),0)from app_private.local_cash_referral_obligations b where b.tranche_id=t.id and not exists(select 1 from app_private.local_cash_budget_allocations al where al.obligation_id=b.id));
 take_amount:=least(available,left_amount);
 if take_amount>0 then insert into app_private.local_cash_budget_allocations(cash_original_id,tranche_id,amount_atomic)values(o.id,t.id,take_amount);left_amount:=left_amount-take_amount;available:=available-take_amount;end if;
 take_amount:=least(available,reserve_amount);
 if take_amount>0 then insert into app_private.local_cash_referral_obligations(first_cash_original_id,referral_id,policy_id,tranche_id,amount_atomic,committed_at)
 values(o.id,q.referral_id,p.id,t.id,take_amount,o.effective_at);reserve_amount:=reserve_amount-take_amount;end if;
 exit when left_amount=0 and reserve_amount=0;end loop;
 end if;
 if left_amount<>0 or reserve_amount<>0 then raise exception using errcode='40001',message='LOCAL_CASH_BUDGET_RESERVATION_CONFLICT';end if;
 insert into public.ledger_accounts(code,currency,account_class,normal_side,owner_user_id)
 values('USER:'||upper(q.beneficiary_user_id::text)||':KRW:LIABILITY','KRW','LIABILITY','CREDIT',q.beneficiary_user_id)on conflict(code)do nothing;
 k:='local-cash:'||q.id;rid:=gen_random_uuid();
 select id into wallet from public.wallet_accounts where user_id=q.beneficiary_user_id and currency='KRW' and closed_at is null for update;
 if wallet is null then raise exception using errcode='55000',message='LOCAL_CASH_OPEN_WALLET_REQUIRED';end if;
 if p.kind='REFERRAL'then
 insert into public.referral_qualifications(referral_id,stage,program_version_id,status,rule_version,risk_model_version,evidence,decision_reason,decided_at)
 values(q.referral_id,q.stage,r.id,'PAID',r.version,'NATIVE_SAME_TX_R2_V1',o.snapshot,'NATIVE_APPROVED_LOCAL_CASH',o.effective_at)
 on conflict(referral_id,stage)do update set status='PAID',evidence=excluded.evidence,decision_reason=excluded.decision_reason,decided_at=excluded.decided_at
 where referral_qualifications.program_version_id=excluded.program_version_id returning id into qual;
 if qual is null then raise exception using errcode='55000',message='LOCAL_CASH_QUALIFICATION_PROGRAM_CONFLICT';end if;
 insert into public.referral_reward_claims(id,qualification_id,beneficiary_user_id,amount_atomic,status,idempotency_key)
 values(o.claim_id,qual,q.beneficiary_user_id,o.amount_atomic,'PENDING',k);
 else
 insert into public.event_reward_claims(id,event_id,event_rule_id,event_reward_id,user_id,status,amount_atomic,qualification_snapshot,idempotency_key)
 values(o.claim_id,er.event_id,er.event_rule_id,er.id,q.user_id,'PENDING',o.amount_atomic,o.snapshot,k);
 end if;
 insert into public.ledger_transactions(id,category,currency,idempotency_key,reference_type,reference_id,member_user_id,request_id,correlation_id,
 description,metadata,posted_at)values(o.ledger_transaction_id,kind::public.ledger_transaction_category,'KRW',k||':ledger',refkind,o.claim_id,
 q.beneficiary_user_id,rid,rid,'Synthetic isolated approved cash reward',jsonb_build_object('cash_original_id',o.id,'digest',o.digest,'scope','LOCAL_QA'),o.effective_at);
 insert into public.ledger_entries(transaction_id,account_id,sequence,side,amount_atomic)values
 (o.ledger_transaction_id,(select id from public.ledger_accounts where code=expense),0,'DEBIT',o.amount_atomic),
 (o.ledger_transaction_id,(select id from public.ledger_accounts where code='USER:'||upper(q.beneficiary_user_id::text)||':KRW:LIABILITY'),1,'CREDIT',o.amount_atomic);
 insert into public.wallet_ledger(id,wallet_account_id,user_id,direction,entry_type,amount_atomic,idempotency_key,reference_type,reference_id)
 values(o.wallet_ledger_id,wallet,q.beneficiary_user_id,'CREDIT',kind::public.ledger_entry_type,o.amount_atomic,k||':wallet',refkind,o.claim_id);
 insert into public.audit_logs(id,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(o.audit_id,'LOCAL_CASH_REWARD_PAID',refkind,o.claim_id::text,'Synthetic LOCAL_QA source-bound reward only',rid,o.snapshot,
 jsonb_build_object('scope','LOCAL_QA','original_digest',o.digest),o.effective_at);
 if p.kind='REFERRAL'then update public.referral_reward_claims set status='PAID',ledger_transaction_id=o.ledger_transaction_id,paid_at=o.effective_at where id=o.claim_id;
 else update public.event_reward_claims set status='PAID',ledger_transaction_id=o.ledger_transaction_id,paid_at=o.effective_at where id=o.claim_id;end if;
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,causation_id,idempotency_key,occurred_at)
 values(o.source_event_id,kind||'_PAID.v1',1,refkind,o.claim_id,q.beneficiary_user_id,
 jsonb_build_object('cash_original_id',o.id,'digest',o.digest,'user_id',q.beneficiary_user_id,'claim_id',o.claim_id,
 'amount_atomic',o.amount_atomic::text,'currency','KRW','ledger_transaction_id',o.ledger_transaction_id,'wallet_ledger_id',o.wallet_ledger_id),
 rid,rid,m.outbox_id,k||':event',o.effective_at);
 insert into public.money_source_movements(user_id,source_bucket,movement_kind,origin_code,amount_atomic,ledger_transaction_id,wallet_ledger_id,source_event_id,effective_at)
 values(q.beneficiary_user_id,'BONUS','CREDIT',kind,o.amount_atomic,o.ledger_transaction_id,o.wallet_ledger_id,o.source_event_id,o.effective_at);
 perform app_private.assert_local_cash_posting(o.id,true);return true;
end;$$;

create function app_private.consume_local_cash_source(p_event uuid,p_worker text)returns void
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare ev public.outbox_events%rowtype;m app_private.funded_mining_mission_originals%rowtype;a public.referral_attributions%rowtype;
 p app_private.local_cash_policies%rowtype;prior app_private.local_cash_originals%rowtype;q app_private.local_cash_pending%rowtype;
 review app_private.local_cash_review_originals%rowtype;u uuid;v_stage public.referral_stage;enabled boolean;cs app_private.local_cash_consents%rowtype;locked_users uuid[];
begin
 if current_user<>'postgres' or current_setting('role',true)is distinct from 'service_role' or auth.role()is distinct from 'service_role'
 or nullif(btrim(p_worker),'')is null then raise exception using errcode='42501',message='LOCAL_CASH_CLOSED_SERVICE_REQUIRED';end if;
 if current_setting('transaction_isolation')<>'read committed'then raise exception using errcode='25000',message='LOCAL_CASH_READ_COMMITTED_REQUIRED';end if;
 select * into ev from public.outbox_events where id=p_event;
 if ev.event_type in('REFERRAL_REWARD_PAID.v1','EVENT_REWARD_PAID.v1')then
 perform app_private.assert_local_cash_posting((select id from app_private.local_cash_originals where source_event_id=ev.id),true);
 elsif ev.event_type='LOCAL_CASH_REVIEW.v1'then
 select * into review from app_private.local_cash_review_originals where event_id=ev.id;
 if review.event_id is null or review.snapshot is distinct from to_jsonb(review)-array['snapshot','digest']
 or review.digest is distinct from app_private.funding_engine_digest(review.snapshot)
 or ev.schema_version<>1 or ev.aggregate_type<>'local_cash_pending' or ev.aggregate_id<>review.pending_id
 or ev.payload is distinct from jsonb_build_object('review_original_id',review.event_id,'digest',review.digest)
 or ev.causation_id is distinct from(select mm.outbox_id from app_private.local_cash_pending qq join app_private.funded_mining_mission_originals mm on mm.id=qq.source_mission_id where qq.id=review.pending_id)
 or ev.request_id is distinct from review.event_id or ev.correlation_id is distinct from review.event_id
 or ev.idempotency_key is distinct from 'local-cash-review:'||review.pending_id||':'||review.generation
 then raise exception using errcode='55000',message='LOCAL_CASH_REVIEW_ORIGINAL_INVALID';end if;
 select mm.* into m from app_private.local_cash_pending pq join app_private.funded_mining_mission_originals mm on mm.id=pq.source_mission_id where pq.id=review.pending_id;
 elsif ev.event_type='MINING_SETTLEMENT_COMPLETED.v1' then select * into m from app_private.funded_mining_mission_originals where outbox_id=ev.id;
 else raise exception using errcode='55000',message='LOCAL_CASH_SOURCE_UNSUPPORTED';end if;
 -- All involved financial members are sorted and locked BEFORE the source lease row.
 select coalesce(array_agg(distinct x order by x),'{}'::uuid[])into locked_users from unnest(array[m.user_id]||(select coalesce(array_agg(referrer_user_id),'{}'::uuid[])from public.referral_attributions where referred_user_id=m.user_id))x where x is not null;
 foreach u in array locked_users loop
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||u,0));end loop;
 lock table public.referral_attributions in share mode;
 if exists(select 1 from public.referral_attributions where referred_user_id=m.user_id and not(referrer_user_id=any(locked_users)))then
 raise exception using errcode='40001',message='LOCAL_CASH_ATTRIBUTION_CHANGED_RETRY';end if;
 select * into ev from public.outbox_events where id=p_event for update;
 if ev.status is distinct from 'PROCESSING' or ev.lease_owner is distinct from p_worker or ev.lease_expires_at is null or ev.lease_expires_at<=clock_timestamp()then
 raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';end if;
 select coalesce((select c.enabled from app_private.local_cash_configuration c where c.singleton and
 c.project_identity='putduk-mining-review-r2-20261009-e-200642'),false)into enabled;
 if m.id is not null then perform app_private.assert_funded_mining_mission_original(m.id);end if;
 if enabled and ev.event_type='MINING_SETTLEMENT_COMPLETED.v1'then
 for a in select * from public.referral_attributions where referred_user_id=m.user_id loop
 perform app_private.assert_local_referral_attribution(a.id);
 select x.* into prior from app_private.local_cash_originals x join app_private.local_cash_pending y on y.id=x.pending_id where y.referral_id=a.id and y.stage='STAGE_1';
 if prior.id is null then
 select * into p from app_private.local_cash_policies where kind='REFERRAL' and starts_at<=a.attributed_at and ends_at>a.attributed_at order by starts_at desc,id desc limit 1;
 v_stage:='STAGE_1';
 else
 select pol.* into p from app_private.local_cash_policies pol join app_private.local_cash_pending pq on pq.policy_id=pol.id where pq.id=prior.pending_id;
 if m.effective_at<prior.effective_at+interval '24 hours' or m.id=(select source_mission_id from app_private.local_cash_pending where id=prior.pending_id)then continue;end if;
 v_stage:='STAGE_2';end if;
 if p.id is null then continue;end if;
 insert into app_private.local_cash_pending(policy_id,referral_id,stage,user_id,beneficiary_user_id,source_mission_id,status)
 values(p.id,a.id,v_stage,m.user_id,a.referrer_user_id,m.id,'PENDING_BUDGET')on conflict do nothing;
 end loop;
 for cs in select * from app_private.local_cash_consents where user_id=m.user_id and accepted_at<=m.effective_at loop
 select * into p from app_private.local_cash_policies where id=cs.policy_id;
 if m.effective_at<p.starts_at or m.effective_at>=p.ends_at then continue;end if;
 insert into app_private.local_cash_pending(policy_id,user_id,beneficiary_user_id,source_mission_id,status)
 values(p.id,m.user_id,m.user_id,m.id,'PENDING_BUDGET')on conflict do nothing;
 end loop;
 end if;
 if enabled and m.id is not null then
 for q in select * from app_private.local_cash_pending where source_mission_id=m.id and status<>'PAID'order by id loop
 perform app_private.post_local_cash_pending(q.id);end loop;end if;
 if ev.event_type in('REFERRAL_REWARD_PAID.v1','EVENT_REWARD_PAID.v1')then
 perform app_private.persist_domain_original_notification(ev.id);end if;
 if ev.event_type='MINING_SETTLEMENT_COMPLETED.v1'then perform app_private.consume_nonmoney_source(ev.id,p_worker);end if;
 update public.outbox_events set status='PROCESSED',processed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error_code=null
 where id=ev.id and status='PROCESSING' and lease_owner=p_worker and lease_expires_at>clock_timestamp();
 if not found then raise exception using errcode='55000',message='LOCAL_CASH_SOURCE_FENCE_LOST';end if;
 if m.id is not null then for q in select * from app_private.local_cash_pending where source_mission_id=m.id and status<>'PAID'order by id loop
 perform app_private.schedule_local_cash_review(q.id);end loop;end if;
end;$$;

-- Explicit five-argument CASH consent overload. Legacy four-argument NONE join
-- is unchanged. Digest acknowledgement cannot be inferred from an old join.
create function app_private.participate_published_event(p_event_id uuid,p_revision_id uuid,p_idempotency_key uuid,p_request_id uuid,p_cash_terms_digest text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare actor uuid;p app_private.local_cash_policies%rowtype;er public.event_rewards%rowtype;j app_private.event_join_originals%rowtype;
 c app_private.local_cash_consents%rowtype;result jsonb;
begin
 if current_user<>'postgres' or current_setting('role',true)is distinct from 'authenticated' or auth.role()is distinct from 'authenticated' or auth.uid()is null then
 raise exception using errcode='42501',message='LOCAL_CASH_MEMBER_REQUIRED';end if;
 actor:=auth.uid();
 if not exists(select 1 from app_private.local_cash_configuration where singleton and enabled and project_identity='putduk-mining-review-r2-20261009-e-200642')then
 raise exception using errcode='42501',message='LOCAL_CASH_DISABLED';end if;
 select cp.* into p from app_private.local_cash_policies cp join public.event_rewards rw on rw.id=cp.event_reward_id
 where rw.event_id=p_event_id and cp.content_revision_id=p_revision_id and cp.kind='EVENT' and cp.digest=p_cash_terms_digest
 and cp.starts_at<=clock_timestamp()and cp.ends_at>clock_timestamp();
 if p.id is null then raise exception using errcode='22023',message='LOCAL_CASH_EXPLICIT_TERMS_MISMATCH';end if;
 perform app_private.assert_local_cash_policy(p.id);
 result:=app_private.participate_published_event(p_event_id,p_revision_id,p_idempotency_key,p_request_id);
 select * into j from app_private.event_join_originals where event_id=p_event_id and user_id=actor;
 perform app_private.assert_event_join(j.id);
 c.policy_id:=p.id;c.user_id:=actor;c.join_original_id:=j.id;c.accepted_terms_digest:=p_cash_terms_digest;c.request_id:=p_request_id;c.accepted_at:=clock_timestamp();
 c.snapshot:=to_jsonb(c)-array['snapshot','digest'];c.digest:=app_private.funding_engine_digest(c.snapshot);
 insert into app_private.local_cash_consents select c.* on conflict(policy_id,user_id)do nothing;
 select * into c from app_private.local_cash_consents where policy_id=p.id and user_id=actor;
 if c.accepted_terms_digest<>p_cash_terms_digest then raise exception using errcode='55000',message='LOCAL_CASH_CONSENT_REPLAY_CONFLICT';end if;
 return result||jsonb_build_object('cashTermsDigest',p.digest,'cashTermsVersion',p.terms_version,'cashConsentRecorded',true,'scope','LOCAL_QA');
end;$$;
create function public.participate_published_event(p_event_id uuid,p_revision_id uuid,p_idempotency_key uuid,p_request_id uuid,p_cash_terms_digest text)
returns jsonb language sql volatile security invoker set search_path=pg_catalog
begin atomic select app_private.participate_published_event(p_event_id,p_revision_id,p_idempotency_key,p_request_id,p_cash_terms_digest);end;

do $$declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and (p.proname like '%local_cash%'or p.proname='assert_local_referral_attribution'
 or(p.proname='participate_published_event'and p.pronargs=5))loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
 end loop;
end$$;
revoke all on function public.participate_published_event(uuid,uuid,uuid,uuid,text)from public,anon,authenticated,service_role;
grant execute on function app_private.consume_local_cash_source(uuid,text),app_private.assert_local_cash_credit(public.money_source_movements)to service_role;
grant execute on function public.participate_published_event(uuid,uuid,uuid,uuid,text),app_private.participate_published_event(uuid,uuid,uuid,uuid,text)to authenticated;
create view public.member_cash_event_terms with(security_barrier=true)as
select(p.snapshot->'reward'->>'event_id')::uuid as event_id,p.content_revision_id,p.terms_version,p.terms_ko,p.digest as cash_terms_digest,
 p.snapshot->'reward'->>'amount_atomic' as reward_krw,p.starts_at,p.ends_at
from app_private.local_cash_policies p join public.events ce on ce.id=(p.snapshot->'reward'->>'event_id')::uuid
where ce.status in('SCHEDULED','LIVE','ENDED')and p.kind='EVENT'and auth.uid()is not null and p.starts_at<=statement_timestamp()and p.ends_at>statement_timestamp()
and exists(select 1 from app_private.local_cash_configuration where singleton and enabled and project_identity='putduk-mining-review-r2-20261009-e-200642');
revoke all on public.member_cash_event_terms from public,anon,authenticated,service_role;
grant select on public.member_cash_event_terms to authenticated;
alter function app_private.consume_local_cash_source(uuid,text)owner to postgres;
alter function app_private.verify_local_cash_commit()owner to postgres;
alter function app_private.assert_local_cash_credit(public.money_source_movements)owner to postgres;
alter function app_private.participate_published_event(uuid,uuid,uuid,uuid,text)owner to postgres;
alter function public.participate_published_event(uuid,uuid,uuid,uuid,text)owner to postgres;
alter view public.member_cash_event_terms owner to postgres;

create or replace function app_private.assert_money_source_credit(
  p_move public.money_source_movements
) returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_event public.outbox_events%rowtype;
  v_journal public.ledger_transactions%rowtype;
  v_wallet public.wallet_ledger%rowtype;
  v_owner uuid;
  v_amount bigint;
  v_wallet_id uuid;
  v_journal_id uuid;
  v_category text;
  v_origin text;
  v_bucket text;
  v_amount_key text;
  v_requested_amount bigint;
  v_command_key text;
  v_conversion_key text;
begin
  if p_move.origin_code in ('REFERRAL_REWARD','EVENT_REWARD') then
    perform app_private.assert_local_cash_credit(p_move);
    return;
  end if;
  if p_move.movement_kind <> 'CREDIT' then
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_COMMAND_NOT_CONNECTED';
  end if;
  select * into v_event from public.outbox_events where id = p_move.source_event_id;
  select * into v_journal from public.ledger_transactions where id = p_move.ledger_transaction_id;
  select * into v_wallet from public.wallet_ledger where id = p_move.wallet_ledger_id;
  if v_event.schema_version is distinct from 1 or v_journal.id is null
    or v_wallet.id is null or v_journal.currency <> 'KRW'
    or v_journal.created_at < (select introduced_at from app_private.money_source_epochs where version = 1)
  then
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_RECEIPT_UNVERIFIED';
  end if;
  if v_event.event_type = 'DEPOSIT_CONFIRMED.v1' and v_event.aggregate_type = 'deposit_request' then
    select user_id, approved_amount_atomic, ledger_transaction_id, wallet_ledger_id, amount_atomic
    into v_owner, v_amount, v_journal_id, v_wallet_id, v_requested_amount
    from public.deposit_requests where id = v_event.aggregate_id and status = 'APPROVED'
      and reviewed_by = v_event.actor_user_id and currency = 'KRW';
    v_category := 'DEPOSIT'; v_origin := 'KRW_DEPOSIT'; v_bucket := 'PRINCIPAL';
    v_amount_key := 'approved_amount_atomic';
  elsif v_event.event_type = 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1'
    and v_event.aggregate_type = 'usdt_manual_deposit' then
    select user_id, credited_krw, ledger_transaction_id, wallet_ledger_id
    into v_owner, v_amount, v_journal_id, v_wallet_id
    from public.usdt_manual_deposits where id = v_event.aggregate_id and status = 'CONFIRMED'
      and confirmed_by = v_event.actor_user_id and network_snapshot = 'TRC20';
    v_category := 'DEPOSIT'; v_origin := 'USDT_KRW_DEPOSIT'; v_bucket := 'PRINCIPAL';
    v_amount_key := 'credited_krw';
  elsif v_event.event_type = 'TRIAL_REWARD_CONVERTED.v1'
    and v_event.aggregate_type = 'trial_reward_conversion' then
    select user_id, converted_amount_atomic, ledger_transaction_id, wallet_ledger_id, idempotency_key
    into v_owner, v_amount, v_journal_id, v_wallet_id, v_conversion_key
    from public.trial_reward_conversions where id = v_event.aggregate_id and status = 'CONVERTED'
      and converted_amount_atomic between 1 and 5000 and user_id = v_event.actor_user_id;
    v_category := 'TRIAL_REWARD_CONVERSION'; v_origin := 'WELCOME_REWARD'; v_bucket := 'BONUS';
    v_amount_key := 'amount_atomic';
  elsif v_event.event_type = 'MINING_REWARD_CREDITED.v1'
    and v_event.aggregate_type = 'mining_reward_credit' then
    select credit.user_id, credit.amount_atomic, credit.ledger_transaction_id, credit.wallet_ledger_id
    into v_owner, v_amount, v_journal_id, v_wallet_id
    from public.mining_reward_credits as credit
    where credit.id = v_event.aggregate_id
      and credit.source_event_id = p_move.source_event_id
      and credit.effective_at = p_move.effective_at;
    v_category := 'MINING_REWARD'; v_origin := 'MINING_REWARD'; v_bucket := 'MINING_REWARD';
    v_amount_key := 'amount_atomic';
  else
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_COMMAND_NOT_CONNECTED';
  end if;
  v_command_key := left(v_journal.idempotency_key, length(v_journal.idempotency_key) - 7);
  if v_owner is null or v_amount is null or v_amount <= 0
    or p_move.user_id is distinct from v_owner or p_move.amount_atomic is distinct from v_amount
    or p_move.origin_code is distinct from v_origin or p_move.source_bucket is distinct from v_bucket
    or p_move.ledger_transaction_id is distinct from v_journal_id
    or p_move.wallet_ledger_id is distinct from v_wallet_id
    or p_move.effective_at is distinct from v_journal.posted_at
    or v_journal.member_user_id is distinct from v_owner
    or (v_category = 'DEPOSIT' and v_journal.created_by is distinct from v_event.actor_user_id)
    or v_journal.category::text is distinct from v_category
    or v_journal.reference_type is distinct from v_event.aggregate_type
    or v_journal.reference_id is distinct from v_event.aggregate_id
    or v_journal.request_id is distinct from v_event.request_id
    or v_journal.correlation_id is distinct from v_event.correlation_id
    or v_wallet.user_id is distinct from v_owner or v_wallet.direction <> 'CREDIT'
    or v_wallet.entry_type::text is distinct from v_category
    or v_wallet.amount_atomic is distinct from v_amount
    or v_wallet.reference_type is distinct from v_event.aggregate_type
    or v_wallet.reference_id is distinct from v_event.aggregate_id
    or (v_category = 'DEPOSIT' and v_wallet.created_by is distinct from v_event.actor_user_id)
    or right(v_journal.idempotency_key, 7) is distinct from ':ledger'
    or char_length(btrim(v_command_key)) not between 8 and 200
    or v_wallet.idempotency_key is distinct from (case
      when v_origin = 'KRW_DEPOSIT' then v_command_key else v_command_key || ':wallet' end)
    or v_event.idempotency_key is distinct from v_command_key || (case
      when v_origin = 'KRW_DEPOSIT' then ':deposit-event' else ':event' end)
    or (v_origin = 'WELCOME_REWARD' and v_conversion_key is distinct from v_command_key)
    or v_event.payload->>'user_id' is distinct from v_owner::text
    or v_event.payload->>v_amount_key is distinct from v_amount::text
    or v_event.payload->>'ledger_transaction_id' is distinct from v_journal_id::text
    or (v_origin in ('KRW_DEPOSIT', 'WELCOME_REWARD', 'MINING_REWARD')
      and v_event.payload->>'currency' is distinct from 'KRW')
    or (v_origin = 'KRW_DEPOSIT' and (
      v_event.payload->>'wallet_ledger_id' is distinct from v_wallet_id::text
      or v_event.payload->>'requested_amount_atomic' is distinct from v_requested_amount::text))
    or (v_origin = 'MINING_REWARD' and (
      v_event.payload->>'wallet_ledger_id' is distinct from v_wallet_id::text))
    or (v_origin = 'WELCOME_REWARD'
      and v_event.payload->'funding_required' is distinct from 'false'::jsonb)
    or not exists (select 1 from public.wallet_accounts as a
      where a.id = v_wallet.wallet_account_id and a.user_id = v_owner and a.currency = 'KRW')
    or (select count(*) from public.ledger_entries where transaction_id = v_journal_id) <> 2
    or not exists (select 1 from public.ledger_entries as e
      join public.ledger_accounts as a on a.id = e.account_id
      where e.transaction_id = v_journal_id and e.sequence = 1 and e.side = 'CREDIT'
        and e.amount_atomic = v_amount and a.owner_user_id = v_owner
        and a.code = 'USER:' || upper(v_owner::text) || ':KRW:LIABILITY'
        and a.account_class = 'LIABILITY' and a.currency = 'KRW'
        and a.normal_side = 'CREDIT' and not a.is_controlled_asset)
    or not exists (select 1 from public.ledger_entries as e
      join public.ledger_accounts as a on a.id = e.account_id
      where e.transaction_id = v_journal_id and e.sequence = 0 and e.side = 'DEBIT'
        and e.amount_atomic = v_amount and a.currency = 'KRW'
        and a.code = (case
          when v_category = 'DEPOSIT' then 'PUTDUK:OPERATING_CASH:KRW'
          when v_category = 'MINING_REWARD' then 'PUTDUK:MINING_REWARD_EXPENSE:KRW'
          else 'PUTDUK:WELCOME_REWARD_EXPENSE:KRW' end)
        and a.normal_side = 'DEBIT' and a.is_controlled_asset = (v_category = 'DEPOSIT')
        and a.owner_user_id is null and a.account_class = (case
          when v_category = 'DEPOSIT' then 'ASSET'::public.ledger_account_class
          else 'EXPENSE'::public.ledger_account_class end))
  then
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_RECEIPT_UNVERIFIED';
  end if;
end;
$$;
create or replace function app_private.read_domain_notification_original(p_source uuid)returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;m public.money_source_movements%rowtype;t public.ledger_transactions%rowtype;
 original jsonb;cash app_private.local_cash_originals%rowtype;pending app_private.local_cash_pending%rowtype;
begin
 perform app_private.assert_push_worker_context();
 select * into e from public.outbox_events where id=p_source;
 if e.event_type in('REFERRAL_REWARD_PAID.v1','EVENT_REWARD_PAID.v1')then
  select * into cash from app_private.local_cash_originals where source_event_id=e.id;
  perform app_private.assert_local_cash_posting(cash.id,true);
  select * into pending from app_private.local_cash_pending where id=cash.pending_id;
  return jsonb_build_object('member_id',pending.beneficiary_user_id,'effective_at',cash.effective_at,
   'source_event_id',e.id,'source_type',e.event_type,'source_digest',cash.digest,'original',cash.snapshot);
 end if;
 if e.event_type is distinct from 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1' then
  return app_private.read_nonmoney_mission_original(p_source);
 end if;
 if e.schema_version<>1 or e.aggregate_type<>'usdt_manual_deposit'
  or(select count(*)from public.money_source_movements where source_event_id=e.id
   and movement_kind='CREDIT'and origin_code='USDT_KRW_DEPOSIT')<>1 then
  raise exception using errcode='55000',message='DOMAIN_USDT_SOURCE_ORIGINAL_REQUIRED';end if;
 select * into m from public.money_source_movements where source_event_id=e.id and movement_kind='CREDIT'and origin_code='USDT_KRW_DEPOSIT';
 -- Existing immutable domain/credit/journal/wallet/audit/completed-idempotency validator.
 perform app_private.assert_money_source_credit_complete(m);
 select * into t from public.ledger_transactions where id=m.ledger_transaction_id;
 if m.user_id is null or m.effective_at is null or m.effective_at>clock_timestamp()
  or m.effective_at is distinct from t.posted_at then
  raise exception using errcode='55000',message='DOMAIN_USDT_SOURCE_OWNER_CLOCK_INVALID';end if;
 original:=jsonb_build_object('credit_movement_id',m.id,'ledger_transaction_id',t.id,'wallet_ledger_id',m.wallet_ledger_id,
  'domain_id',e.aggregate_id,'domain_kind',e.aggregate_type,'member_id',m.user_id,'effective_at',m.effective_at,
  'credit_movement',to_jsonb(m),'ledger_original',to_jsonb(t),'source_event_id',e.id,'source_type',e.event_type,
  'schema_version',e.schema_version,'source_envelope',to_jsonb(e)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']);
 return jsonb_build_object('member_id',m.user_id,'effective_at',m.effective_at,'source_event_id',e.id,
  'source_type',e.event_type,'source_digest',app_private.funding_engine_digest(original),'original',original);
end;$$;

create or replace function app_private.domain_notification_copy(p_type text)returns jsonb
language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
 return case p_type
 when 'REFERRAL_REWARD_PAID.v1'then jsonb_build_object('category','wallet','title','추천 보상이 지급됐어요','body','지갑에서 지급 내역을 확인해 주세요.','route','/wallet')
 when 'EVENT_REWARD_PAID.v1'then jsonb_build_object('category','wallet','title','행사 보상이 지급됐어요','body','지갑에서 지급 내역을 확인해 주세요.','route','/wallet')
 when 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1' then jsonb_build_object('category','wallet','title','수동 입금이 확인됐어요','body','지갑에서 입금 내역을 확인해 주세요.','route','/wallet')
 when 'DEPOSIT_CONFIRMED.v1' then jsonb_build_object('category','wallet','title','입금이 확인됐어요','body','지갑에서 입금 내역을 확인해 주세요.','route','/wallet')
 when 'WITHDRAWAL_COMPLETED.v1' then jsonb_build_object('category','wallet','title','출금이 완료됐어요','body','지갑에서 출금 내역을 확인해 주세요.','route','/wallet')
 when 'TRIAL_REWARD_CONVERTED.v1' then jsonb_build_object('category','wallet','title','체험 보상이 전환됐어요','body','지갑에서 전환 내역을 확인해 주세요.','route','/wallet')
 when 'MINING_STARTED.v1' then jsonb_build_object('category','mining','title','채굴이 시작됐어요','body','채굴 화면에서 내 진행 상태를 확인해 주세요.','route','/mining')
 when 'MINING_SETTLEMENT_COMPLETED.v1' then jsonb_build_object('category','mining','title','채굴 결과가 반영됐어요','body','채굴 화면에서 결과를 확인해 주세요.','route','/mining')
 when 'TRIAL_COMPLETED.v1' then jsonb_build_object('category','trial','title','체험이 끝났어요','body','체험 화면에서 결과를 확인해 주세요.','route','/start')
 else null end;
end;$$;

create or replace function public.complete_outbox_event(
  p_event_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_event public.outbox_events%rowtype;
  v_audit public.audit_logs%rowtype;
  v_key app_private.idempotency_keys%rowtype;
  v_delivery public.event_consumer_deliveries%rowtype;
begin
  if exists(select 1 from public.outbox_events where id=p_event_id and event_type in ('MINING_SETTLEMENT_COMPLETED.v1','LOCAL_CASH_REVIEW.v1','REFERRAL_REWARD_PAID.v1','EVENT_REWARD_PAID.v1')) then
    perform app_private.consume_local_cash_source(p_event_id,p_worker_id);
    return;
  end if;
  if exists(select 1 from public.outbox_events where id=p_event_id and event_type='LIVEOPS_CONTENT_CHANGED.v1')then
    perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.liveops-content',0));
  end if;
  select event.* into v_event from public.outbox_events as event
  where event.id = p_event_id for update;
  if v_event.id is null or v_event.status <> 'PROCESSING'
    or v_event.lease_owner is distinct from p_worker_id
    or v_event.lease_expires_at is null
    or v_event.lease_expires_at < clock_timestamp() then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;

  if v_event.event_type = 'SAFE_MODE_CHANGED.v1' then
    select audit.* into v_audit from public.audit_logs as audit
    where audit.id::text = v_event.payload->>'audit_id';
    select logical_key.* into v_key from app_private.idempotency_keys as logical_key
    where logical_key.scope = 'safe_mode.control' and logical_key.actor_id is null
      and logical_key.idempotency_key = v_audit.metadata->>'idempotency_key';
    if v_event.schema_version <> 1 or v_event.aggregate_type <> 'safe_mode_control'
      or v_event.payload - array['audit_id', 'component', 'is_paused', 'review_at', 'request_hash'] <> '{}'::jsonb
      or v_audit.id is null or v_key.id is null
      or v_audit.target_type is distinct from 'SAFE_MODE'
      or v_audit.action not in ('SAFE_MODE_ENABLED', 'SAFE_MODE_DISABLED')
      or v_audit.metadata->'command_version' is distinct from '1'::jsonb
      or v_audit.actor_user_id is distinct from v_event.actor_user_id
      or v_audit.request_id is distinct from v_event.request_id
      or v_event.correlation_id is distinct from v_audit.request_id
      or v_audit.after_state->>'id' is distinct from v_event.aggregate_id::text
      or v_audit.after_state->>'component' is distinct from v_audit.target_id
      or v_event.payload->>'component' is distinct from v_audit.target_id
      or v_event.payload->'is_paused' is distinct from v_audit.after_state->'is_paused'
      or v_event.payload->'is_paused' is distinct from to_jsonb(v_audit.action = 'SAFE_MODE_ENABLED')
      or v_event.payload->'review_at' is distinct from v_audit.after_state->'review_at'
      or v_event.payload->>'request_hash' is distinct from v_audit.metadata->>'request_hash'
      or v_event.idempotency_key is distinct from 'safe-mode:' || v_key.idempotency_key
      or v_key.status <> 'COMPLETED' or v_key.completed_at is null
      or v_key.response_status is distinct from 200
      or v_key.request_hash is distinct from v_event.payload->>'request_hash'
      or v_key.response_payload->>'audit_id' is distinct from v_audit.id::text
      or v_key.response_payload->>'control_id' is distinct from v_event.aggregate_id::text
      or not exists (select 1 from public.safe_mode_controls as control
        where control.id = v_event.aggregate_id and control.component = v_audit.target_id)
      or (select count(*) from public.outbox_events as original
        where original.event_type = 'SAFE_MODE_CHANGED.v1'
          and original.payload->>'audit_id' = v_audit.id::text) <> 1 then
      raise exception using errcode = '55000', message = 'SAFE_MODE_EVENT_RECEIPT_MISMATCH';
    end if;
    insert into public.event_consumer_deliveries (
      event_id, consumer_name, status, attempt_count, processed_at
    ) values (
      v_event.id, 'operator_safe_mode_audit.v1', 'SUCCEEDED', 1, statement_timestamp()
    ) on conflict (event_id, consumer_name) do nothing;
    select delivery.* into v_delivery from public.event_consumer_deliveries as delivery
    where delivery.event_id = v_event.id and delivery.consumer_name = 'operator_safe_mode_audit.v1';
    if v_delivery.status is distinct from 'SUCCEEDED' or v_delivery.processed_at is null
      or v_delivery.attempt_count <> 1 or v_delivery.lease_owner is not null
      or v_delivery.lease_expires_at is not null or v_delivery.last_error_code is not null then
      raise exception using errcode = '55000', message = 'SAFE_MODE_DELIVERY_RECEIPT_MISMATCH';
    end if;
  elsif v_event.event_type = 'MEMBER_PROFILE_CAPTURED.v1' then
    perform app_private.consume_member_profile_audit(v_event.id,p_worker_id);
    return;
  elsif v_event.event_type = 'LIVEOPS_CONTENT_CHANGED.v1' then
    perform app_private.consume_liveops_publication(v_event.id,p_worker_id);
  elsif v_event.event_type = 'EVENT_PARTICIPATION_JOINED.v1' then
    perform app_private.consume_event_join(v_event.id,p_worker_id);
  elsif v_event.event_type in('USDT_MANUAL_DEPOSIT_CONFIRMED.v1','DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1','MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1','TRIAL_COMPLETED.v1') then
    perform app_private.consume_nonmoney_source(v_event.id,p_worker_id);
   else raise exception using errcode='55000',message='OUTBOX_HANDLER_UNSUPPORTED';
   end if;

  update public.outbox_events set status = 'PROCESSED',
    processed_at = statement_timestamp(), lease_owner = null,
    lease_expires_at = null, last_error_code = null where id = v_event.id
    and status = 'PROCESSING' and lease_owner = p_worker_id
    and lease_expires_at >= clock_timestamp();
  if not found then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;
end;
$$;
commit;
