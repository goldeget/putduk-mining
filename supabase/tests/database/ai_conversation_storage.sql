begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

select ok(
  (
    select bool_and(c.relrowsecurity and c.relforcerowsecurity)
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('ai_conversations', 'ai_messages')
  )
    and (
      select count(*) = 2
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('ai_conversations', 'ai_messages')
        and c.relkind = 'r'
    ),
  'conversation and message tables force row level security'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_conversations'
      and policyname = 'ai_conversations_select_own'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual like '%auth.uid()%'
  )
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'ai_messages'
        and policyname = 'ai_messages_select_own'
        and cmd = 'SELECT'
        and roles = array['authenticated']::name[]
        and qual like '%auth.uid()%'
    )
    and not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename in ('ai_conversations', 'ai_messages')
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ),
  'members can select only their own rows and have no mutation policies'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('ai_conversations', 'ai_messages')
      and column_name ~* '(amount|balance|reward|ledger|krw|usdt|token|price|fee|atomic)'
  ),
  'conversation storage has no money, reward, or token columns'
);

select ok(
  (
    select coalesce(array_agg(trigger.tgname order by trigger.tgname), '{}'::name[])
    from pg_trigger as trigger
    where not trigger.tgisinternal
      and trigger.tgrelid in (
        'public.ai_conversations'::regclass,
        'public.ai_messages'::regclass
      )
  ) = array[
    'ai_conversations_set_updated_at',
    'ai_messages_prevent_update_delete'
  ]::name[],
  'conversation triggers only stamp updates and keep messages append-only'
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
        'public.signup_phone_availability(text)'::regprocedure
      )
  )
    and (
      select count(*) = 5
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
  'conversation storage does not add a security definer function'
);

select ok(
  not has_table_privilege('anon', 'public.ai_conversations', 'SELECT')
    and not has_table_privilege('anon', 'public.ai_conversations', 'INSERT')
    and not has_table_privilege('anon', 'public.ai_conversations', 'UPDATE')
    and not has_table_privilege('anon', 'public.ai_conversations', 'DELETE')
    and not has_table_privilege('anon', 'public.ai_messages', 'SELECT')
    and not has_table_privilege('anon', 'public.ai_messages', 'INSERT')
    and not has_table_privilege('anon', 'public.ai_messages', 'UPDATE')
    and not has_table_privilege('anon', 'public.ai_messages', 'DELETE')
    and not has_table_privilege('public', 'public.ai_conversations', 'SELECT')
    and not has_table_privilege('public', 'public.ai_messages', 'INSERT'),
  'anonymous and public clients cannot read or write conversation storage'
);

select ok(
  has_table_privilege('authenticated', 'public.ai_conversations', 'SELECT')
    and has_table_privilege('authenticated', 'public.ai_messages', 'SELECT')
    and not has_table_privilege('authenticated', 'public.ai_conversations', 'INSERT')
    and not has_table_privilege('authenticated', 'public.ai_conversations', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.ai_conversations', 'DELETE')
    and not has_table_privilege('authenticated', 'public.ai_messages', 'INSERT')
    and not has_table_privilege('authenticated', 'public.ai_messages', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.ai_messages', 'DELETE'),
  'authenticated members can select conversation storage and cannot mutate it'
);

select ok(
  has_table_privilege('service_role', 'public.ai_conversations', 'SELECT')
    and has_table_privilege('service_role', 'public.ai_conversations', 'INSERT')
    and has_table_privilege('service_role', 'public.ai_messages', 'SELECT')
    and has_table_privilege('service_role', 'public.ai_messages', 'INSERT')
    and not has_table_privilege('service_role', 'public.ai_conversations', 'DELETE')
    and not has_table_privilege('service_role', 'public.ai_conversations', 'TRUNCATE')
    and not has_table_privilege('service_role', 'public.ai_conversations', 'MAINTAIN')
    and not has_table_privilege('service_role', 'public.ai_messages', 'DELETE')
    and not has_table_privilege('service_role', 'public.ai_messages', 'TRUNCATE')
    and not has_table_privilege('service_role', 'public.ai_messages', 'UPDATE')
    and not has_table_privilege('service_role', 'public.ai_conversations', 'UPDATE')
    and has_column_privilege('service_role', 'public.ai_conversations', 'title_text', 'UPDATE')
    and has_column_privilege('service_role', 'public.ai_conversations', 'updated_at', 'UPDATE')
    and not has_column_privilege('service_role', 'public.ai_conversations', 'user_id', 'UPDATE'),
  'service_role can append rows and edit only the conversation label and timestamp'
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
    'a1c00001-0504-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'ai-conv-owner-a@putduk.test',
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
    'a1c00001-0504-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'ai-conv-owner-b@putduk.test',
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
    'a1c00002-0504-4000-8000-000000000001',
    'a1c00001-0504-4000-8000-000000000001',
    '입금 안내'
  ),
  (
    'a1c00002-0504-4000-8000-000000000002',
    'a1c00001-0504-4000-8000-000000000002',
    '출금 안내'
  );

insert into public.ai_messages (
  id,
  conversation_id,
  user_id,
  author_role,
  body_text,
  position,
  client_message_id
) values
  (
    'a1c00003-0504-4000-8000-000000000001',
    'a1c00002-0504-4000-8000-000000000001',
    'a1c00001-0504-4000-8000-000000000001',
    'MEMBER',
    '입금은 어디에서 확인하나요',
    1,
    'a1c00004-0504-4000-8000-000000000001'
  ),
  (
    'a1c00003-0504-4000-8000-000000000002',
    'a1c00002-0504-4000-8000-000000000001',
    'a1c00001-0504-4000-8000-000000000001',
    'ASSISTANT',
    '입금 화면에서 안내를 확인할 수 있어요.',
    2,
    null
  ),
  (
    'a1c00003-0504-4000-8000-000000000003',
    'a1c00002-0504-4000-8000-000000000002',
    'a1c00001-0504-4000-8000-000000000002',
    'MEMBER',
    '출금 전에 무엇을 확인하나요',
    1,
    'a1c00004-0504-4000-8000-000000000002'
  );

select is(
  (select count(*)::integer from public.ai_conversations),
  2,
  'service_role can store conversations for more than one member'
);

select throws_ok(
  $mismatch$
    insert into public.ai_messages (
      conversation_id,
      user_id,
      author_role,
      body_text,
      position
    ) values (
      'a1c00002-0504-4000-8000-000000000001',
      'a1c00001-0504-4000-8000-000000000002',
      'MEMBER',
      '다른 회원의 대화에 붙이는 메시지',
      3
    )
  $mismatch$,
  '23503',
  'insert or update on table "ai_messages" violates foreign key constraint "ai_messages_conversation_owner"',
  'a message cannot be attached to another member conversation'
);

select throws_ok(
  $duplicate$
    insert into public.ai_messages (
      conversation_id,
      user_id,
      author_role,
      body_text,
      position,
      client_message_id
    ) values (
      'a1c00002-0504-4000-8000-000000000001',
      'a1c00001-0504-4000-8000-000000000001',
      'MEMBER',
      '같은 요청을 다시 보냈어요',
      3,
      'a1c00004-0504-4000-8000-000000000001'
    )
  $duplicate$,
  '23505',
  'duplicate key value violates unique constraint "ai_messages_user_client_message_unique"',
  'the same member message id cannot be stored twice'
);

select lives_ok(
  $touch$
    update public.ai_conversations
    set updated_at = statement_timestamp()
    where id = 'a1c00002-0504-4000-8000-000000000001'
  $touch$,
  'service_role can stamp the conversation time'
);

select lives_ok(
  $deny_owner_change$
    do $body$
    begin
      update public.ai_conversations
      set user_id = 'a1c00001-0504-4000-8000-000000000002'
      where id = 'a1c00002-0504-4000-8000-000000000001';
      raise exception 'USER_ID_UPDATE_SHOULD_FAIL';
    exception
      when insufficient_privilege then
        null;
    end
    $body$;
  $deny_owner_change$,
  'service_role cannot move a conversation to another member'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  'a1c00001-0504-4000-8000-000000000001',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.ai_conversations),
  1,
  'member A sees only their own conversation'
);

select is(
  (select count(*)::integer from public.ai_messages),
  2,
  'member A sees only messages in their own conversation'
);

select is(
  (
    select count(*)::integer
    from public.ai_messages
    where user_id = 'a1c00001-0504-4000-8000-000000000002'
  ),
  0,
  'member A cannot read member B messages'
);

select is(
  (
    select count(*)::integer
    from public.ai_conversations
    where id = 'a1c00002-0504-4000-8000-000000000002'
  ),
  0,
  'member A cannot read member B conversation by id'
);

select throws_ok(
  $member_insert$
    insert into public.ai_conversations (user_id)
    values ('a1c00001-0504-4000-8000-000000000001')
  $member_insert$,
  '42501',
  'permission denied for table ai_conversations',
  'a member cannot insert a conversation from the browser role'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  'a1c00001-0504-4000-8000-000000000002',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.ai_conversations),
  1,
  'member B sees only their own conversation'
);

select is(
  (
    select count(*)::integer
    from public.ai_messages
    where id = 'a1c00003-0504-4000-8000-000000000001'
  ),
  0,
  'member B cannot read member A message by id'
);

reset role;

select throws_ok(
  $append_update$
    update public.ai_messages
    set body_text = '바뀐 본문'
    where id = 'a1c00003-0504-4000-8000-000000000001'
  $append_update$,
  '55000',
  'ai_messages is append-only',
  'stored message text cannot be rewritten'
);

select throws_ok(
  $append_delete$
    delete from public.ai_messages
    where id = 'a1c00003-0504-4000-8000-000000000001'
  $append_delete$,
  '55000',
  'ai_messages is append-only',
  'stored message rows cannot be deleted'
);

select * from finish();

rollback;
