begin;

-- 답변 메시지에 붙은 도구 호출, 근거, 피드백 행만 추가한다.
-- 쓰기는 service_role 서버 경로만 한다. 회원은 자기 행만 읽는다.
-- 새 SECURITY DEFINER, 금액 컬럼, 도구 결과 본문, 보상 계산, 원장 write는 없다.
-- BLOCKED: RAG, eval, provider router, 학습 후보, 대화 요약, 열람 감사.

alter table public.ai_messages
  add constraint ai_messages_id_owner_key
  unique (id, conversation_id, user_id, author_role);

create table public.ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  message_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  author_role text not null,
  tool_name text not null,
  tool_revision text,
  outcome text not null,
  latency_ms integer,
  position integer not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint ai_tool_calls_assistant_only
    check (author_role = 'ASSISTANT'),
  constraint ai_tool_calls_tool_name_length
    check (char_length(btrim(tool_name)) between 1 and 80),
  constraint ai_tool_calls_tool_revision_length
    check (
      tool_revision is null
      or char_length(btrim(tool_revision)) between 1 and 80
    ),
  constraint ai_tool_calls_outcome
    check (outcome in ('SUCCEEDED', 'FAILED')),
  constraint ai_tool_calls_latency_nonnegative
    check (latency_ms is null or latency_ms >= 0),
  constraint ai_tool_calls_position_positive check (position > 0),
  constraint ai_tool_calls_position_unique unique (message_id, position),
  constraint ai_tool_calls_message_owner
    foreign key (message_id, conversation_id, user_id, author_role)
    references public.ai_messages (id, conversation_id, user_id, author_role)
    on delete cascade,
  constraint ai_tool_calls_conversation_owner
    foreign key (conversation_id, user_id)
    references public.ai_conversations (id, user_id)
    on delete cascade
);

create table public.ai_answer_sources (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  message_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  author_role text not null,
  source_key text not null,
  knowledge_version text,
  economy_policy_version text,
  position integer not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint ai_answer_sources_assistant_only
    check (author_role = 'ASSISTANT'),
  constraint ai_answer_sources_source_key_length
    check (char_length(btrim(source_key)) between 1 and 160),
  constraint ai_answer_sources_knowledge_version_length
    check (
      knowledge_version is null
      or char_length(btrim(knowledge_version)) between 1 and 80
    ),
  constraint ai_answer_sources_economy_policy_version_length
    check (
      economy_policy_version is null
      or char_length(btrim(economy_policy_version)) between 1 and 80
    ),
  constraint ai_answer_sources_position_positive check (position > 0),
  constraint ai_answer_sources_position_unique unique (message_id, position),
  constraint ai_answer_sources_message_owner
    foreign key (message_id, conversation_id, user_id, author_role)
    references public.ai_messages (id, conversation_id, user_id, author_role)
    on delete cascade,
  constraint ai_answer_sources_conversation_owner
    foreign key (conversation_id, user_id)
    references public.ai_conversations (id, user_id)
    on delete cascade
);

create table public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  message_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  author_role text not null,
  rating text not null,
  reason_code text,
  created_at timestamptz not null default statement_timestamp(),
  constraint ai_feedback_assistant_only
    check (author_role = 'ASSISTANT'),
  constraint ai_feedback_rating
    check (rating in ('UP', 'DOWN')),
  constraint ai_feedback_reason_code
    check (
      reason_code is null
      or reason_code in (
        'INCORRECT',
        'HARD_TO_UNDERSTAND',
        'NOT_THE_ANSWER',
        'OUTDATED',
        'ACCOUNT_MISMATCH',
        'OTHER'
      )
    ),
  constraint ai_feedback_reason_matches_rating
    check (
      (rating = 'UP' and reason_code is null)
      or (rating = 'DOWN' and reason_code is not null)
    ),
  constraint ai_feedback_message_unique unique (message_id, user_id),
  constraint ai_feedback_message_owner
    foreign key (message_id, conversation_id, user_id, author_role)
    references public.ai_messages (id, conversation_id, user_id, author_role)
    on delete cascade,
  constraint ai_feedback_conversation_owner
    foreign key (conversation_id, user_id)
    references public.ai_conversations (id, user_id)
    on delete cascade
);

create index ai_tool_calls_user_created_idx
  on public.ai_tool_calls (user_id, created_at desc);
create index ai_tool_calls_conversation_owner_idx
  on public.ai_tool_calls (conversation_id, user_id);
create index ai_tool_calls_message_owner_idx
  on public.ai_tool_calls (message_id, conversation_id, user_id);
create index ai_answer_sources_user_created_idx
  on public.ai_answer_sources (user_id, created_at desc);
create index ai_answer_sources_conversation_owner_idx
  on public.ai_answer_sources (conversation_id, user_id);
create index ai_answer_sources_message_owner_idx
  on public.ai_answer_sources (message_id, conversation_id, user_id);
create index ai_feedback_user_created_idx
  on public.ai_feedback (user_id, created_at desc);
create index ai_feedback_conversation_owner_idx
  on public.ai_feedback (conversation_id, user_id);
create index ai_feedback_message_owner_idx
  on public.ai_feedback (message_id, conversation_id, user_id);

create trigger ai_tool_calls_prevent_update_delete
before update or delete on public.ai_tool_calls
for each row execute function app_private.prevent_row_mutation();

create trigger ai_answer_sources_prevent_update_delete
before update or delete on public.ai_answer_sources
for each row execute function app_private.prevent_row_mutation();

create trigger ai_feedback_prevent_update_delete
before update or delete on public.ai_feedback
for each row execute function app_private.prevent_row_mutation();

alter table public.ai_tool_calls enable row level security;
alter table public.ai_tool_calls force row level security;
alter table public.ai_answer_sources enable row level security;
alter table public.ai_answer_sources force row level security;
alter table public.ai_feedback enable row level security;
alter table public.ai_feedback force row level security;

revoke all privileges on table
  public.ai_tool_calls,
  public.ai_answer_sources,
  public.ai_feedback
  from public, anon, authenticated, service_role;
revoke delete, truncate, references, trigger, maintain
  on table public.ai_tool_calls, public.ai_answer_sources, public.ai_feedback
  from service_role;

grant select on table
  public.ai_tool_calls,
  public.ai_answer_sources,
  public.ai_feedback
  to authenticated;
grant select, insert on table
  public.ai_tool_calls,
  public.ai_answer_sources,
  public.ai_feedback
  to service_role;

create policy ai_tool_calls_select_own
on public.ai_tool_calls
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy ai_answer_sources_select_own
on public.ai_answer_sources
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy ai_feedback_select_own
on public.ai_feedback
for select
to authenticated
using ((select auth.uid()) = user_id);

comment on table public.ai_tool_calls is
  '답변에 붙은 도구 호출. 도구 결과 본문·금액·원장 write가 없다. 쓰기는 service_role만 한다.';
comment on table public.ai_answer_sources is
  '답변에 붙인 근거 식별자와 knowledge/economy 버전 라벨. 문서 본문과 RAG 인덱스는 없다.';
comment on table public.ai_feedback is
  '답변에 대한 좋아요/싫어요. 싫어요 사유는 틀린 정보, 이해하기 어려움, 원하는 답 없음, 오래된 정보, 계정정보가 틀림, 기타다.';
comment on column public.ai_tool_calls.latency_ms is
  '그 도구 호출의 소요 시간. provider 사용량이나 금액이 아니다.';
comment on column public.ai_tool_calls.outcome is
  'SUCCEEDED 또는 FAILED. 도구가 돌려준 잔액이나 보상 값은 저장하지 않는다.';
comment on column public.ai_answer_sources.economy_policy_version is
  '근거에 남긴 경제 정책 버전 라벨. 금액 컬럼이 아니다.';
comment on column public.ai_feedback.reason_code is
  'DOWN 사유. INCORRECT, HARD_TO_UNDERSTAND, NOT_THE_ANSWER, OUTDATED, ACCOUNT_MISMATCH, OTHER.';

commit;
