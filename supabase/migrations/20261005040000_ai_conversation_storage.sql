begin;

-- 회원별 PUTDUK AI 대화와 메시지 행만 추가한다.
-- 쓰기는 service_role 서버 경로만 한다. 회원은 자기 행만 읽는다.
-- 새 SECURITY DEFINER, 금액 컬럼, 보상 계산, 원장 write는 없다.
-- BLOCKED: RAG, eval, provider router, 학습 후보.

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title_text text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint ai_conversations_owner_key unique (id, user_id),
  constraint ai_conversations_title_length check (
    title_text is null or char_length(btrim(title_text)) between 1 and 80
  )
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  author_role text not null,
  body_text text not null,
  position integer not null,
  client_message_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  constraint ai_messages_author_role
    check (author_role in ('MEMBER', 'ASSISTANT')),
  constraint ai_messages_body_length
    check (char_length(btrim(body_text)) between 1 and 8000),
  constraint ai_messages_position_positive check (position > 0),
  constraint ai_messages_position_unique unique (conversation_id, position),
  constraint ai_messages_conversation_owner
    foreign key (conversation_id, user_id)
    references public.ai_conversations (id, user_id)
    on delete cascade
);

create index ai_conversations_user_created_idx
  on public.ai_conversations (user_id, created_at desc);
create index ai_messages_user_created_idx
  on public.ai_messages (user_id, created_at desc);
create index ai_messages_conversation_owner_idx
  on public.ai_messages (conversation_id, user_id);
create unique index ai_messages_user_client_message_unique
  on public.ai_messages (user_id, client_message_id)
  where client_message_id is not null;

create trigger ai_conversations_set_updated_at
before update on public.ai_conversations
for each row execute function app_private.set_updated_at();

create trigger ai_messages_prevent_update_delete
before update or delete on public.ai_messages
for each row execute function app_private.prevent_row_mutation();

alter table public.ai_conversations enable row level security;
alter table public.ai_conversations force row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_messages force row level security;

revoke all privileges on table public.ai_conversations
  from public, anon, authenticated, service_role;
revoke all privileges on table public.ai_messages
  from public, anon, authenticated, service_role;
revoke delete, truncate, references, trigger, maintain
  on table public.ai_conversations, public.ai_messages
  from service_role;

grant select on table public.ai_conversations, public.ai_messages to authenticated;
grant select, insert on table public.ai_conversations, public.ai_messages to service_role;
grant update (title_text, updated_at) on table public.ai_conversations to service_role;

create policy ai_conversations_select_own
on public.ai_conversations
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy ai_messages_select_own
on public.ai_messages
for select
to authenticated
using ((select auth.uid()) = user_id);

comment on table public.ai_conversations is
  '회원별 PUTDUK AI 대화 머리글. 금액·보상·원장 컬럼이 없다. 쓰기는 service_role만 한다.';
comment on table public.ai_messages is
  '대화 본문 행. 다른 회원의 대화에 붙일 수 없고, 추가 이후 고치거나 지우지 않는다.';
comment on column public.ai_messages.body_text is
  '서버가 저장한 대화 본문. 비밀값 탐지, RAG, 평가, provider 선택은 이 테이블의 일이 아니다.';

commit;
