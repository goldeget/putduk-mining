import type { MemberAiSuggestion } from "@/domain/ai/member-help";
import type { PutdukIconName } from "@/components/icons/putduk-icon";

/** Drafts only. These questions use existing own-record tools or public help. */
export const AI_PAGE_PROMPTS: readonly (MemberAiSuggestion & {
  icon: PutdukIconName;
})[] = [
  { label: "내 채굴 상태", question: "내 채굴 상태 알려줘", icon: "mining" },
  {
    label: "START 확인",
    question: "내 PUTDUK START 체험 상태 알려줘",
    icon: "pulse",
  },
  {
    label: "출금 준비",
    question: "첫 출금은 어떻게 준비하나요?",
    icon: "wallet",
  },
  { label: "이벤트 안내", question: "이벤트 참여 방법 알려줘", icon: "event" },
  { label: "고객지원", question: "고객지원은 어디에 있나요?", icon: "user" },
];
