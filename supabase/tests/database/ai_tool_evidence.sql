begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select ok(
  (
    select bool_and(c.relrowsecurity and c.relforcerowsecurity)
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('ai_tool_calls', 'ai_answer_sources', 'ai_feedback')
  )
    and (
      select count(*) = 3
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('ai_tool_calls', 'ai_answer_sources', 'ai_feedback')
        and c.relkind = 'r'
    ),
  'tool, source, and feedback tables force row level security'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_tool_calls'
      and policyname = 'ai_tool_calls_select_own'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual like '%auth.uid()%'
  )
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'ai_answer_sources'
        and policyname = 'ai_answer_sources_select_own'
        and cmd = 'SELECT'
        and roles = array['authenticated']::name[]
        and qual like '%auth.uid()%'
    )
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'ai_feedback'
        and policyname = 'ai_feedback_select_own'
        and cmd = 'SELECT'
        and roles = array['authenticated']::name[]
        and qual like '%auth.uid()%'
    )
    and not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename in ('ai_tool_calls', 'ai_answer_sources', 'ai_feedback')
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ),
  'members can select only their own rows and have no mutation policies'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('ai_tool_calls', 'ai_answer_sources', 'ai_feedback')
      and column_name ~* '(amount|balance|reward|ledger|krw|usdt|token|price|fee|atomic)'
  ),
  'tool evidence storage has no money, reward, or token columns'
);

select ok(
  (
    select coalesce(array_agg(trigger.tgname order by trigger.tgname), '{}'::name[])
    from pg_trigger as trigger
    where not trigger.tgisinternal
      and trigger.tgrelid in (
        'public.ai_tool_calls'::regclass,
        'public.ai_answer_sources'::regclass,
        'public.ai_feedback'::regclass
      )
  ) = array[
    'ai_answer_sources_prevent_update_delete',
    'ai_feedback_prevent_update_delete',
    'ai_tool_calls_prevent_update_delete'
  ]::name[],
  'tool evidence rows stay append-only'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'app_private')
      and procedure.prosecdef
      and procedure.oid not in (
        'public.bootstrap_user(uuid)'::regprocedure,
        'public.is_login_id_available(text)'::regprocedure,
        'public.resolve_login_email(text)'::regprocedure,
        'app_private.capture_public_signup_identity()'::regprocedure,
        'public.signup_phone_availability(text)'::regprocedure,
        'public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text)'::regprocedure,
        'app_private.execute_product_catalog_command(text,uuid,uuid,text,timestamptz,uuid,uuid,text,text,text,text,text)'::regprocedure,
        'app_private.execute_product_catalog_review_read(uuid,uuid,uuid,text,text)'::regprocedure,
        'app_private.validate_product_catalog_publication_trigger()'::regprocedure,
        'app_private.verify_funding_integrity_at_commit()'::regprocedure,
        'app_private.verify_balanced_ledger_at_commit()'::regprocedure,
        'app_private.verify_funding_portion_transition()'::regprocedure,
        'app_private.read_funding_runtime_server_display(uuid)'::regprocedure,
        'app_private.read_neutral_funding_job_inputs(uuid,uuid,timestamp with time zone)'::regprocedure,
        'app_private.read_verified_credit_funding_inputs(uuid,uuid,timestamp with time zone)'::regprocedure,
        'app_private.begin_funding_credit_boundary(uuid,text)'::regprocedure,
        'app_private.finish_funding_credit_boundary(uuid)'::regprocedure,
        'app_private.carry_forward_funding_capacity(uuid,uuid,uuid)'::regprocedure,
        'app_private.verify_credit_boundary_commit()'::regprocedure
      )
  )
    and (
      select count(*) = 19
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
  'tool evidence storage does not add a security definer function'
);

select ok(
  not exists (
    select 1
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'ai_message_redactions',
        'ai_topics',
        'ai_topic_clusters',
        'ai_knowledge_gaps',
        'ai_knowledge_documents',
        'ai_knowledge_chunks',
        'ai_knowledge_versions',
        'ai_learning_candidates',
        'ai_eval_cases',
        'ai_eval_runs',
        'ai_eval_results',
        'ai_provider_requests',
        'ai_usage_daily',
        'ai_admin_access_logs',
        'ai_escalations'
      )
  ),
  'redaction, RAG, eval, provider, and learning tables stay absent'
);

select ok(
  not has_table_privilege('anon', 'public.ai_tool_calls', 'SELECT')
    and not has_table_privilege('anon', 'public.ai_tool_calls', 'INSERT')
    and not has_table_privilege('anon', 'public.ai_answer_sources', 'SELECT')
    and not has_table_privilege('anon', 'public.ai_feedback', 'INSERT')
    and not has_table_privilege('public', 'public.ai_tool_calls', 'SELECT')
    and not has_table_privilege('public', 'public.ai_answer_sources', 'INSERT')
    and not has_table_privilege('public', 'public.ai_feedback', 'SELECT'),
  'anonymous and public clients cannot read or write tool evidence'
);

select ok(
  has_table_privilege('authenticated', 'public.ai_tool_calls', 'SELECT')
    and has_table_privilege('authenticated', 'public.ai_answer_sources', 'SELECT')
    and has_table_privilege('authenticated', 'public.ai_feedback', 'SELECT')
    and not has_table_privilege('authenticated', 'public.ai_tool_calls', 'INSERT')
    and not has_table_privilege('authenticated', 'public.ai_tool_calls', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.ai_tool_calls', 'DELETE')
    and not has_table_privilege('authenticated', 'public.ai_answer_sources', 'INSERT')
    and not has_table_privilege('authenticated', 'public.ai_answer_sources', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.ai_answer_sources', 'DELETE')
    and not has_table_privilege('authenticated', 'public.ai_feedback', 'INSERT')
    and not has_table_privilege('authenticated', 'public.ai_feedback', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.ai_feedback', 'DELETE'),
  'authenticated members can select tool evidence and cannot mutate it'
);

select ok(
  has_table_privilege('service_role', 'public.ai_tool_calls', 'SELECT')
    and has_table_privilege('service_role', 'public.ai_tool_calls', 'INSERT')
    and has_table_privilege('service_role', 'public.ai_answer_sources', 'SELECT')
    and has_table_privilege('service_role', 'public.ai_answer_sources', 'INSERT')
    and has_table_privilege('service_role', 'public.ai_feedback', 'SELECT')
    and has_table_privilege('service_role', 'public.ai_feedback', 'INSERT')
    and not has_table_privilege('service_role', 'public.ai_tool_calls', 'UPDATE')
    and not has_table_privilege('service_role', 'public.ai_tool_calls', 'DELETE')
    and not has_table_privilege('service_role', 'public.ai_tool_calls', 'TRUNCATE')
    and not has_table_privilege('service_role', 'public.ai_tool_calls', 'MAINTAIN')
    and not has_table_privilege('service_role', 'public.ai_answer_sources', 'UPDATE')
    and not has_table_privilege('service_role', 'public.ai_answer_sources', 'DELETE')
    and not has_table_privilege('service_role', 'public.ai_feedback', 'UPDATE')
    and not has_table_privilege('service_role', 'public.ai_feedback', 'DELETE'),
  'service_role can append tool evidence and cannot update or delete it'
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
    'a1e00001-0505-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'ai-tool-owner-a@putduk.test',
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
    'a1e00001-0505-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'ai-tool-owner-b@putduk.test',
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
    'a1e00002-0505-4000-8000-000000000001',
    'a1e00001-0505-4000-8000-000000000001',
    '입금 안내'
  ),
  (
    'a1e00002-0505-4000-8000-000000000002',
    'a1e00001-0505-4000-8000-000000000001',
    '다른 대화'
  ),
  (
    'a1e00002-0505-4000-8000-000000000003',
    'a1e00001-0505-4000-8000-000000000002',
    '출금 안내'
  );

insert into public.ai_messages (
  id,
  conversation_id,
  user_id,
  author_role,
  body_text,
  position
) values
  (
    'a1e00003-0505-4000-8000-000000000001',
    'a1e00002-0505-4000-8000-000000000001',
    'a1e00001-0505-4000-8000-000000000001',
    'MEMBER',
    '입금은 어디에서 확인하나요',
    1
  ),
  (
    'a1e00003-0505-4000-8000-000000000002',
    'a1e00002-0505-4000-8000-000000000001',
    'a1e00001-0505-4000-8000-000000000001',
    'ASSISTANT',
    '입금 화면에서 안내를 확인할 수 있어요.',
    2
  ),
  (
    'a1e00003-0505-4000-8000-000000000003',
    'a1e00002-0505-4000-8000-000000000003',
    'a1e00001-0505-4000-8000-000000000002',
    'ASSISTANT',
    '출금 전에 본인 확인이 필요해요.',
    1
  );

insert into public.ai_tool_calls (
  id,
  conversation_id,
  message_id,
  user_id,
  author_role,
  tool_name,
  tool_revision,
  outcome,
  latency_ms,
  position
) values
  (
    'a1e00004-0505-4000-8000-000000000001',
    'a1e00002-0505-4000-8000-000000000001',
    'a1e00003-0505-4000-8000-000000000002',
    'a1e00001-0505-4000-8000-000000000001',
    'ASSISTANT',
    'wallet.summary',
    'tool-rev-1',
    'SUCCEEDED',
    40,
    1
  ),
  (
    'a1e00004-0505-4000-8000-000000000002',
    'a1e00002-0505-4000-8000-000000000003',
    'a1e00003-0505-4000-8000-000000000003',
    'a1e00001-0505-4000-8000-000000000002',
    'ASSISTANT',
    'withdrawal.latest_status',
    null,
    'FAILED',
    null,
    1
  );

insert into public.ai_answer_sources (
  id,
  conversation_id,
  message_id,
  user_id,
  author_role,
  source_key,
  knowledge_version,
  economy_policy_version,
  position
) values (
  'a1e00005-0505-4000-8000-000000000001',
  'a1e00002-0505-4000-8000-000000000001',
  'a1e00003-0505-4000-8000-000000000002',
  'a1e00001-0505-4000-8000-000000000001',
  'ASSISTANT',
  'help.deposit',
  'knowledge-1',
  'economy-1',
  1
);

insert into public.ai_feedback (
  id,
  conversation_id,
  message_id,
  user_id,
  author_role,
  rating,
  reason_code
) values
  (
    'a1e00006-0505-4000-8000-000000000001',
    'a1e00002-0505-4000-8000-000000000001',
    'a1e00003-0505-4000-8000-000000000002',
    'a1e00001-0505-4000-8000-000000000001',
    'ASSISTANT',
    'UP',
    null
  ),
  (
    'a1e00006-0505-4000-8000-000000000002',
    'a1e00002-0505-4000-8000-000000000003',
    'a1e00003-0505-4000-8000-000000000003',
    'a1e00001-0505-4000-8000-000000000002',
    'ASSISTANT',
    'DOWN',
    'INCORRECT'
  );

select is(
  (select count(*)::integer from public.ai_tool_calls),
  2,
  'service_role can store tool calls for more than one member'
);

select throws_ok(
  $mismatch$
    insert into public.ai_tool_calls (
      conversation_id,
      message_id,
      user_id,
      author_role,
      tool_name,
      outcome,
      position
    ) values (
      'a1e00002-0505-4000-8000-000000000001',
      'a1e00003-0505-4000-8000-000000000002',
      'a1e00001-0505-4000-8000-000000000002',
      'ASSISTANT',
      'wallet.summary',
      'SUCCEEDED',
      2
    )
  $mismatch$,
  '23503',
  'insert or update on table "ai_tool_calls" violates foreign key constraint "ai_tool_calls_message_owner"',
  'a tool call cannot be attached to another member answer'
);

select throws_ok(
  $other_conversation$
    insert into public.ai_answer_sources (
      conversation_id,
      message_id,
      user_id,
      author_role,
      source_key,
      position
    ) values (
      'a1e00002-0505-4000-8000-000000000002',
      'a1e00003-0505-4000-8000-000000000002',
      'a1e00001-0505-4000-8000-000000000001',
      'ASSISTANT',
      'help.deposit',
      2
    )
  $other_conversation$,
  '23503',
  'insert or update on table "ai_answer_sources" violates foreign key constraint "ai_answer_sources_message_owner"',
  'a source cannot move to another conversation'
);

select throws_ok(
  $member_message$
    insert into public.ai_feedback (
      conversation_id,
      message_id,
      user_id,
      author_role,
      rating
    ) values (
      'a1e00002-0505-4000-8000-000000000001',
      'a1e00003-0505-4000-8000-000000000001',
      'a1e00001-0505-4000-8000-000000000001',
      'ASSISTANT',
      'UP'
    )
  $member_message$,
  '23503',
  'insert or update on table "ai_feedback" violates foreign key constraint "ai_feedback_message_owner"',
  'feedback cannot be attached to a member message'
);

select throws_ok(
  $up_reason$
    insert into public.ai_feedback (
      conversation_id,
      message_id,
      user_id,
      author_role,
      rating,
      reason_code
    ) values (
      'a1e00002-0505-4000-8000-000000000001',
      'a1e00003-0505-4000-8000-000000000002',
      'a1e00001-0505-4000-8000-000000000001',
      'ASSISTANT',
      'UP',
      'OTHER'
    )
  $up_reason$,
  '23514',
  'new row for relation "ai_feedback" violates check constraint "ai_feedback_reason_matches_rating"',
  'an up rating cannot carry a downvote reason'
);

select throws_ok(
  $down_reason$
    insert into public.ai_feedback (
      conversation_id,
      message_id,
      user_id,
      author_role,
      rating
    ) values (
      'a1e00002-0505-4000-8000-000000000003',
      'a1e00003-0505-4000-8000-000000000003',
      'a1e00001-0505-4000-8000-000000000002',
      'ASSISTANT',
      'DOWN'
    )
  $down_reason$,
  '23514',
  'new row for relation "ai_feedback" violates check constraint "ai_feedback_reason_matches_rating"',
  'a down rating needs a reason'
);

select throws_ok(
  $blank_tool$
    insert into public.ai_tool_calls (
      conversation_id,
      message_id,
      user_id,
      author_role,
      tool_name,
      outcome,
      position
    ) values (
      'a1e00002-0505-4000-8000-000000000001',
      'a1e00003-0505-4000-8000-000000000002',
      'a1e00001-0505-4000-8000-000000000001',
      'ASSISTANT',
      '   ',
      'SUCCEEDED',
      2
    )
  $blank_tool$,
  '23514',
  'new row for relation "ai_tool_calls" violates check constraint "ai_tool_calls_tool_name_length"',
  'a blank tool name is rejected'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  'a1e00001-0505-4000-8000-000000000001',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.ai_tool_calls),
  1,
  'member A sees only their own tool call'
);

select is(
  (select count(*)::integer from public.ai_answer_sources),
  1,
  'member A sees only their own answer source'
);

select is(
  (select count(*)::integer from public.ai_feedback),
  1,
  'member A sees only their own feedback'
);

select is(
  (
    select count(*)::integer
    from public.ai_tool_calls
    where id = 'a1e00004-0505-4000-8000-000000000002'
  ),
  0,
  'member A cannot read member B tool call by id'
);

select throws_ok(
  $member_insert$
    insert into public.ai_feedback (
      conversation_id,
      message_id,
      user_id,
      author_role,
      rating
    ) values (
      'a1e00002-0505-4000-8000-000000000001',
      'a1e00003-0505-4000-8000-000000000002',
      'a1e00001-0505-4000-8000-000000000001',
      'ASSISTANT',
      'UP'
    )
  $member_insert$,
  '42501',
  'permission denied for table ai_feedback',
  'a member cannot insert feedback from the browser role'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  'a1e00001-0505-4000-8000-000000000002',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.ai_tool_calls),
  1,
  'member B sees only their own tool call'
);

select is(
  (
    select count(*)::integer
    from public.ai_answer_sources
    where id = 'a1e00005-0505-4000-8000-000000000001'
  ),
  0,
  'member B cannot read member A source by id'
);

reset role;

select throws_ok(
  $append_update$
    update public.ai_tool_calls
    set tool_name = 'policy.explain'
    where id = 'a1e00004-0505-4000-8000-000000000001'
  $append_update$,
  '55000',
  'ai_tool_calls is append-only',
  'stored tool calls cannot be rewritten'
);

select throws_ok(
  $append_delete$
    delete from public.ai_answer_sources
    where id = 'a1e00005-0505-4000-8000-000000000001'
  $append_delete$,
  '55000',
  'ai_answer_sources is append-only',
  'stored answer sources cannot be deleted'
);

select throws_ok(
  $feedback_update$
    update public.ai_feedback
    set rating = 'DOWN',
        reason_code = 'OUTDATED'
    where id = 'a1e00006-0505-4000-8000-000000000001'
  $feedback_update$,
  '55000',
  'ai_feedback is append-only',
  'stored feedback cannot be rewritten'
);

select * from finish();

rollback;
