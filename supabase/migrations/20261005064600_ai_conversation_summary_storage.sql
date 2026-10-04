begin;

-- 대화별 긴 대화 요약 행만 추가한다.
-- 쓰기는 service_role 서버 경로만 한다. 회원은 자기 행만 읽는다.
-- 새 SECURITY DEFINER, 금액 컬럼, 보상 계산, 원장 write는 없다.
-- BLOCKED: RAG, eval, provider router, 학습 후보, 열람 감사.

create table public.ai_conversation_summaries (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  summary_text text not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint ai_conversation_summaries_summary_length
    check (char_length(btrim(summary_text)) between 1 and 8000),
  constraint ai_conversation_summaries_conversation_unique unique (conversation_id),
  constraint ai_conversation_summaries_conversation_owner
    foreign key (conversation_id, user_id)
    references public.ai_conversations (id, user_id)
    on delete cascade
);

create index ai_conversation_summaries_user_created_idx
  on public.ai_conversation_summaries (user_id, created_at desc);
create index ai_conversation_summaries_conversation_owner_idx
  on public.ai_conversation_summaries (conversation_id, user_id);

create trigger ai_conversation_summaries_set_updated_at
before update on public.ai_conversation_summaries
for each row execute function app_private.set_updated_at();

alter table public.ai_conversation_summaries enable row level security;
alter table public.ai_conversation_summaries force row level security;

revoke all privileges on table public.ai_conversation_summaries
  from public, anon, authenticated, service_role;
revoke delete, truncate, references, trigger, maintain
  on table public.ai_conversation_summaries
  from service_role;

grant select on table public.ai_conversation_summaries to authenticated;
grant select, insert on table public.ai_conversation_summaries to service_role;
grant update (summary_text, updated_at)
  on table public.ai_conversation_summaries to service_role;

create policy ai_conversation_summaries_select_own
on public.ai_conversation_summaries
for select
to authenticated
using ((select auth.uid()) = user_id);

comment on table public.ai_conversation_summaries is
  '대화별 긴 요약. 금액·보상·원장 컬럼이 없다. 쓰기는 service_role만 한다.';
comment on column public.ai_conversation_summaries.summary_text is
  '서버가 저장한 긴 대화 요약. RAG, 평가, provider 선택, 학습 후보는 이 테이블의 일이 아니다.';

commit;
