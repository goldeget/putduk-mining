begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select ok(
  (
    select bool_and(c.relrowsecurity and c.relforcerowsecurity)
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'ai_conversation_summaries'
  )
    and (
      select count(*) = 1
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'ai_conversation_summaries'
        and c.relkind = 'r'
    ),
  'conversation summary table forces row level security'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_conversation_summaries'
      and policyname = 'ai_conversation_summaries_select_own'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual like '%auth.uid()%'
  )
    and not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'ai_conversation_summaries'
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ),
  'members can select only their own summary and have no mutation policies'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_conversation_summaries'
      and column_name ~* '(amount|balance|reward|ledger|krw|usdt|token|price|fee|atomic)'
  ),
  'conversation summary storage has no money, reward, or token columns'
);

select ok(
  (
    select coalesce(array_agg(trigger.tgname order by trigger.tgname), '{}'::name[])
    from pg_trigger as trigger
    where not trigger.tgisinternal
      and trigger.tgrelid = 'public.ai_conversation_summaries'::regclass
  ) = array['ai_conversation_summaries_set_updated_at']::name[],
  'conversation summary updates only stamp the timestamp'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'app_private')
      and procedure.prosecdef
      and procedure.oid not in (
        'app_private.seal_worker_pause_attempt()'::regprocedure,
        'app_private.consume_local_cash_source(uuid,text)'::regprocedure,
        'app_private.assert_local_cash_credit(public.money_source_movements)'::regprocedure,
        'app_private.verify_local_cash_commit()'::regprocedure,
        'app_private.participate_published_event(uuid,uuid,uuid,uuid,text)'::regprocedure,
        'public.admin_read_ai_conversations(uuid,uuid,uuid,text,jsonb)'::regprocedure,
        'public.admit_openrouter_free_request(uuid,uuid,integer,integer)'::regprocedure,
        'app_private.approve_local_nonmoney_policy(uuid,uuid,uuid,integer,text,text,text,text,uuid,uuid,text,text,text,text,uuid)'::regprocedure,
        'app_private.assert_event_join(uuid)'::regprocedure,
        'app_private.assert_nonmoney_notification(uuid)'::regprocedure,
        'app_private.begin_funding_credit_boundary(uuid,text)'::regprocedure,
        'app_private.capture_funding_global_control_original()'::regprocedure,
        'app_private.capture_funding_withdrawal_clock_admission(uuid,text,uuid)'::regprocedure,
        'app_private.capture_public_signup_identity()'::regprocedure,
        'app_private.carry_forward_funding_capacity(uuid,uuid,uuid)'::regprocedure,
        'app_private.claim_notification_push_deliveries(text,integer,integer)'::regprocedure,
        'app_private.consume_event_join(uuid,text)'::regprocedure,
        'app_private.consume_nonmoney_source(uuid,text)'::regprocedure,
        'app_private.consume_member_profile_audit(uuid,text)'::regprocedure,
        'app_private.consume_liveops_publication(uuid,text)'::regprocedure,
        'app_private.process_liveops_fanout_job(uuid,text)'::regprocedure,
        'app_private.verify_liveops_publication_notification()'::regprocedure,
        'app_private.guard_liveops_notification_projection()'::regprocedure,
        'app_private.emit_funded_mining_missions(uuid)'::regprocedure,
        'app_private.execute_liveops_content(text,text,uuid,uuid,text,jsonb,uuid,uuid,text,text,text,text,uuid)'::regprocedure,
        'app_private.execute_product_catalog_command(text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text,text,text,text)'::regprocedure,
        'app_private.execute_product_catalog_review_read(uuid,uuid,uuid,text,text)'::regprocedure,
        'app_private.execute_trial_settlement(uuid,text)'::regprocedure,
        'app_private.finish_funding_credit_boundary(uuid)'::regprocedure,
        'app_private.finish_principal_runtime_boundary(uuid)'::regprocedure,
        'app_private.guard_event_join_delivery()'::regprocedure,
        'app_private.guard_event_join_envelope()'::regprocedure,
        'app_private.guard_funded_mining_mission_outbox()'::regprocedure,
        'app_private.guard_liveops_sealed_links()'::regprocedure,
        'app_private.guard_nonmoney_envelope()'::regprocedure,
        'app_private.guard_nonmoney_notification_projection()'::regprocedure,
        'app_private.guard_push_delivery_original()'::regprocedure,
        'app_private.guard_trial_completion_source()'::regprocedure,
        'app_private.participate_published_event(uuid,uuid,uuid,uuid)'::regprocedure,
        'app_private.prepare_principal_recovery_intent(uuid,uuid)'::regprocedure,
        'app_private.read_funding_runtime_server_display(uuid)'::regprocedure,
        'app_private.read_liveops_content(text,uuid,uuid,uuid,text,text)'::regprocedure,
        'app_private.read_neutral_funding_job_inputs(uuid,uuid,timestamp with time zone)'::regprocedure,
        'app_private.read_verified_credit_funding_inputs(uuid,uuid,timestamp with time zone)'::regprocedure,
        'app_private.settle_notification_push_delivery(uuid,text,uuid,integer,text,integer,text)'::regprocedure,
        'app_private.validate_event_member_projection()'::regprocedure,
        'app_private.validate_product_catalog_publication_trigger()'::regprocedure,
        'app_private.verify_balanced_ledger_at_commit()'::regprocedure,
        'app_private.verify_credit_boundary_commit()'::regprocedure,
        'app_private.verify_event_join()'::regprocedure,
        'app_private.verify_event_participant_join()'::regprocedure,
        'app_private.verify_funded_mining_mission_commit()'::regprocedure,
        'app_private.verify_funding_global_control_commit()'::regprocedure,
        'app_private.verify_funding_integrity_at_commit()'::regprocedure,
        'app_private.verify_funding_portion_transition()'::regprocedure,
        'app_private.verify_funding_withdrawal_clock_commit()'::regprocedure,
        'app_private.verify_liveops_receipt_commit()'::regprocedure,
        'app_private.verify_member_principal_confirmation_commit()'::regprocedure,
        'app_private.verify_nonmoney_award_commit()'::regprocedure,
        'app_private.verify_nonmoney_notification()'::regprocedure,
        'app_private.verify_nonmoney_policy_commit()'::regprocedure,
        'app_private.verify_principal_boundary_commit()'::regprocedure,
        'app_private.verify_principal_recovery_intent_commit()'::regprocedure,
        'app_private.verify_trial_completion_original_commit()'::regprocedure,
        'public.bootstrap_user(uuid)'::regprocedure,
        'public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text)'::regprocedure,
        'public.is_login_id_available(text)'::regprocedure,
        'public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb)'::regprocedure,
        'public.read_ai_provider_usage(uuid)'::regprocedure,
        'public.reserve_ai_provider_attempt(uuid,uuid,text,text,text,bigint,boolean)'::regprocedure,
        'public.resolve_login_email(text)'::regprocedure,
        'public.settle_ai_provider_attempt(uuid,uuid,uuid,text,text,bigint,bigint,bigint,bigint,bigint,text)'::regprocedure,
        'public.signup_phone_availability(text)'::regprocedure
      )
  )
    and (
      select count(*) = 73
        and coalesce(
          bool_and(
            procedure.proconfig @> array['search_path=pg_catalog']::text[]
          ),
          false
        )
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname in ('public', 'app_private')
        and procedure.prosecdef
    ),
  'application schemas contain only the seventy-three reviewed fixed-search-path SECURITY DEFINER functions'
);

select ok(
  not has_table_privilege('anon', 'public.ai_conversation_summaries', 'SELECT')
    and not has_table_privilege('anon', 'public.ai_conversation_summaries', 'INSERT')
    and not has_table_privilege('anon', 'public.ai_conversation_summaries', 'UPDATE')
    and not has_table_privilege('anon', 'public.ai_conversation_summaries', 'DELETE')
    and not has_table_privilege('public', 'public.ai_conversation_summaries', 'SELECT')
    and not has_table_privilege('public', 'public.ai_conversation_summaries', 'INSERT'),
  'anonymous and public clients cannot read or write conversation summaries'
);

select ok(
  has_table_privilege('authenticated', 'public.ai_conversation_summaries', 'SELECT')
    and not has_table_privilege('authenticated', 'public.ai_conversation_summaries', 'INSERT')
    and not has_table_privilege('authenticated', 'public.ai_conversation_summaries', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.ai_conversation_summaries', 'DELETE'),
  'authenticated members can select summaries and cannot mutate them'
);

select ok(
  has_table_privilege('service_role', 'public.ai_conversation_summaries', 'SELECT')
    and has_table_privilege('service_role', 'public.ai_conversation_summaries', 'INSERT')
    and not has_table_privilege('service_role', 'public.ai_conversation_summaries', 'DELETE')
    and not has_table_privilege('service_role', 'public.ai_conversation_summaries', 'TRUNCATE')
    and not has_table_privilege('service_role', 'public.ai_conversation_summaries', 'MAINTAIN')
    and not has_table_privilege('service_role', 'public.ai_conversation_summaries', 'UPDATE')
    and has_column_privilege(
      'service_role',
      'public.ai_conversation_summaries',
      'summary_text',
      'UPDATE'
    )
    and has_column_privilege(
      'service_role',
      'public.ai_conversation_summaries',
      'updated_at',
      'UPDATE'
    )
    and not has_column_privilege(
      'service_role',
      'public.ai_conversation_summaries',
      'user_id',
      'UPDATE'
    ),
  'service_role can append a summary and edit only the summary text and timestamp'
);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
) values
  (
    'a1500001-0505-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'ai-summary-owner-a@putduk.test',
    '',
    statement_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(),
    statement_timestamp(),
    '',
    '',
    '',
    ''
  ),
  (
    'a1500001-0505-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'ai-summary-owner-b@putduk.test',
    '',
    statement_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(),
    statement_timestamp(),
    '',
    '',
    '',
    ''
  );

set local role service_role;

insert into public.ai_conversations (id, user_id, title_text) values
  (
    'a1500002-0505-4000-8000-000000000001',
    'a1500001-0505-4000-8000-000000000001',
    '입금 안내'
  ),
  (
    'a1500002-0505-4000-8000-000000000002',
    'a1500001-0505-4000-8000-000000000002',
    '출금 안내'
  );

insert into public.ai_conversation_summaries (
  id,
  conversation_id,
  user_id,
  summary_text
) values
  (
    'a1500003-0505-4000-8000-000000000001',
    'a1500002-0505-4000-8000-000000000001',
    'a1500001-0505-4000-8000-000000000001',
    '입금 화면에서 안내를 확인하는 대화다.'
  ),
  (
    'a1500003-0505-4000-8000-000000000002',
    'a1500002-0505-4000-8000-000000000002',
    'a1500001-0505-4000-8000-000000000002',
    '출금 전 본인 확인을 안내한 대화다.'
  );

select is(
  (select count(*)::integer from public.ai_conversation_summaries),
  2,
  'service_role can store one summary for more than one member'
);

insert into public.ai_conversations (id, user_id, title_text) values (
  'a1500002-0505-4000-8000-000000000003',
  'a1500001-0505-4000-8000-000000000001',
  '아직 요약 없는 대화'
);

select throws_ok(
  $mismatch$
    insert into public.ai_conversation_summaries (
      conversation_id,
      user_id,
      summary_text
    ) values (
      'a1500002-0505-4000-8000-000000000003',
      'a1500001-0505-4000-8000-000000000002',
      '다른 회원의 대화 요약'
    )
  $mismatch$,
  '23503',
  'insert or update on table "ai_conversation_summaries" violates foreign key constraint "ai_conversation_summaries_conversation_owner"',
  'a summary cannot be attached to another member conversation'
);

select throws_ok(
  $blank$
    insert into public.ai_conversation_summaries (
      conversation_id,
      user_id,
      summary_text
    ) values (
      'a1500002-0505-4000-8000-000000000002',
      'a1500001-0505-4000-8000-000000000002',
      '   '
    )
  $blank$,
  '23514',
  'new row for relation "ai_conversation_summaries" violates check constraint "ai_conversation_summaries_summary_length"',
  'a blank conversation summary is rejected'
);

select throws_ok(
  $duplicate$
    insert into public.ai_conversation_summaries (
      conversation_id,
      user_id,
      summary_text
    ) values (
      'a1500002-0505-4000-8000-000000000001',
      'a1500001-0505-4000-8000-000000000001',
      '같은 대화의 두번째 요약'
    )
  $duplicate$,
  '23505',
  'duplicate key value violates unique constraint "ai_conversation_summaries_conversation_unique"',
  'a conversation keeps a single stored summary'
);

update public.ai_conversation_summaries
set summary_text = '입금 안내를 다시 요약한 대화다.'
where id = 'a1500003-0505-4000-8000-000000000001';

select is(
  (
    select summary_text
    from public.ai_conversation_summaries
    where id = 'a1500003-0505-4000-8000-000000000001'
  ),
  '입금 안내를 다시 요약한 대화다.',
  'service_role can replace the stored summary text'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  'a1500001-0505-4000-8000-000000000001',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.ai_conversation_summaries),
  1,
  'member A sees only their own conversation summary'
);

select is(
  (
    select count(*)::integer
    from public.ai_conversation_summaries
    where id = 'a1500003-0505-4000-8000-000000000002'
  ),
  0,
  'member A cannot read member B summary by id'
);

select throws_ok(
  $member_insert$
    insert into public.ai_conversation_summaries (
      conversation_id,
      user_id,
      summary_text
    ) values (
      'a1500002-0505-4000-8000-000000000001',
      'a1500001-0505-4000-8000-000000000001',
      '회원이 직접 적은 요약'
    )
  $member_insert$,
  '42501',
  'permission denied for table ai_conversation_summaries',
  'a member cannot insert a conversation summary'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  'a1500001-0505-4000-8000-000000000002',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.ai_conversation_summaries),
  1,
  'member B sees only their own conversation summary'
);

select is(
  (
    select count(*)::integer
    from public.ai_conversation_summaries
    where id = 'a1500003-0505-4000-8000-000000000001'
  ),
  0,
  'member B cannot read member A summary by id'
);

select * from finish();

rollback;
