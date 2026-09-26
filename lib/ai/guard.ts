export type AiGuardResult =
  | { classification: "PUBLIC_INFORMATION"; allowed: true }
  | {
      allowed: false;
      answer: string;
      classification: "ACTION_BOUNDARY" | "INTERNAL_DATA_REQUEST";
    };

const ACTION_TARGET_PATTERN =
  /(잔액|원장|입금|출금|채굴 결과|보상|경제 규칙|관리자|권한)/i;
const ACTION_REQUEST_PATTERN =
  /(해\s?줘|해주세요|승인해|변경해|추가해|지급해|만들어\s?줘|올려\s?줘|취소해)/i;
const INTERNAL_DATA_PATTERN =
  /(시스템 프롬프트|내부 지침|비밀 키|api\s*key|service[_ -]?role|관리자 데이터)/i;

export function guardAiQuestion(question: string): AiGuardResult {
  if (INTERNAL_DATA_PATTERN.test(question)) {
    return {
      allowed: false,
      answer:
        "내부 지침, 비밀 값 또는 관리자 데이터는 제공할 수 없습니다. 공개된 PUTDUK 제품 사실과 이용 원칙은 설명할 수 있습니다.",
      classification: "INTERNAL_DATA_REQUEST",
    };
  }

  if (
    ACTION_TARGET_PATTERN.test(question) &&
    ACTION_REQUEST_PATTERN.test(question)
  ) {
    return {
      allowed: false,
      answer:
        "PUTDUK AI는 설명과 분석만 제공하며 잔액, 원장, 입출금 승인, 채굴 결과, 경제 규칙 또는 관리자 권한을 변경할 수 없습니다.",
      classification: "ACTION_BOUNDARY",
    };
  }

  return { allowed: true, classification: "PUBLIC_INFORMATION" };
}
