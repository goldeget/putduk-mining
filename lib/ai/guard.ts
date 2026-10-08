export type AiDeniedClassification =
  | "UNSUPPORTED_MEDIA"
  | "ABUSE_EVASION"
  | "ACTION_BOUNDARY"
  | "CROSS_USER_DATA"
  | "INTERNAL_DATA_REQUEST"
  | "PRIVILEGE_ESCALATION"
  | "PROMPT_INJECTION";

export type AiGuardResult =
  | { classification: "ALLOWED"; allowed: true }
  | {
      allowed: false;
      answer: string;
      classification: AiDeniedClassification;
    };

const INTERNAL_DATA_PATTERN =
  /(비밀번호|패스워드|\bpassword\b|\bpasswd\b|\bpin\b|otp|인증번호|복구\s*코드|recovery\s*code|비밀\s*(키|값)|api\s*key|service[_ -]?role|private\s*key|access[_ -]?token|refresh[_ -]?token|시스템\s*프롬프트|내부\s*(지침|프롬프트|인프라|소스)|환경\s*변수|secret|(cloudflare|supabase|database).*(계정\s*id|프로젝트\s*ref|서비스\s*키|연결\s*문자열|내부\s*구성))/i;

const PROMPT_INJECTION_PATTERN =
  /(이전|위의?|앞선)\s*(지시|명령|규칙).*(무시|잊어|폐기)|ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)|developer\s*message|system\s*message|jailbreak|탈옥|숨겨진\s*(지시|추론)|정책을?\s*(우회|무시)|프롬프트\s*인젝션/i;

const CROSS_USER_PATTERN =
  /(다른\s*(사람|회원|사용자)|타인|남의|전체\s*회원|모든\s*(회원|사용자)).*(계정|개인정보|정보|잔액|지갑|원장|입금|출금|kyc|인증|대화|채굴|보상|이벤트|알림)|((계정|개인정보|잔액|지갑|원장|입금|출금|kyc|대화).*(다른\s*(사람|회원|사용자)|타인|남의))|(?:other|all|every)\s+(?:member|user|customer|people)s?.{0,80}(?:data|account|balance|wallet|ledger|withdrawal|deposit|kyc|conversation|chat|message|reward)|(?:data|account|balance|wallet|ledger|conversation|chat|message).{0,80}(?:other|all|every)\s+(?:member|user|customer|people)s?/i;

const PRIVILEGE_PATTERN =
  /(관리자|어드민|admin|운영자).*(권한|역할|role|승격|부여|접근|로그인|세션).*(줘|해|만들|우회|탈취|가져|얻|획득)|권한\s*(상승|에스컬레이션)|관리자\s*사칭/i;

const ABUSE_PATTERN =
  /(kyc|본인\s*인증|신원\s*인증|체험|trial|start|추천|referral|초대|리워드|보상|중복\s*보상|다계정|멀티\s*계정|기기|device|아이피|ip|차단|block|위험\s*탐지|부정\s*탐지|anti[- ]?abuse)/i;

const ABUSE_ACTION_PATTERN =
  /(우회|회피|피해|뚫|속이|조작|파밍|무한\s*반복|중복\s*(수령|지급)|탐지를?\s*숨기|기기\s*초기화|차단.{0,16}해제|안\s*걸리)/i;

const ACTION_TARGET_PATTERN =
  /(잔액|원장|입금|출금|채굴\s*결과|보상|경제\s*규칙|관리자|권한|kyc|본인\s*인증|추천\s*보상|이벤트\s*보상|차단)/i;
const ACTION_REQUEST_PATTERN =
  /(승인해|변경해|추가해|지급해|생성해|만들어\s*줘|올려\s*줘|취소해|삭제해|조작(해|하는\s*(법|방법))|변조|위조|우회|풀어\s*줘|통과시켜)/i;

export function guardAiQuestion(question: string): AiGuardResult {
  const normalized = question.replace(/\s+/g, " ").trim();

  if (
    /(?:사진|이미지|동영상|영상|비디오|음성|오디오|노래|그림).{0,24}(?:생성해|만들어|그려|합성해|편집해|변환해)|(?:generate|create|make|edit)\s+(?:a\s+|an\s+)?(?:image|photo|video|audio|song)/i.test(
      normalized,
    )
  ) {
    return {
      allowed: false,
      classification: "UNSUPPORTED_MEDIA",
      answer:
        "사진, 영상, 음성 파일은 만들 수 없어요. 글로 설명하거나 방법을 안내해 드릴 수 있어요.",
    };
  }

  if (PROMPT_INJECTION_PATTERN.test(normalized)) {
    return {
      allowed: false,
      answer: "내부 지침은 바꿀 수 없어요. 궁금한 내용을 다시 물어봐 주세요.",
      classification: "PROMPT_INJECTION",
    };
  }

  if (INTERNAL_DATA_PATTERN.test(normalized)) {
    return {
      allowed: false,
      answer:
        "비밀번호나 인증번호, 비밀 키는 확인해 드릴 수 없어요. 이런 정보는 대화에 보내지 마세요.",
      classification: "INTERNAL_DATA_REQUEST",
    };
  }

  if (CROSS_USER_PATTERN.test(normalized)) {
    return {
      allowed: false,
      answer:
        "다른 회원의 개인정보나 대화는 볼 수 없어요. 내 계정 정보만 확인할 수 있어요.",
      classification: "CROSS_USER_DATA",
    };
  }

  if (PRIVILEGE_PATTERN.test(normalized)) {
    return {
      allowed: false,
      answer:
        "관리자 권한을 얻거나 로그인 절차를 우회하는 방법은 안내할 수 없어요.",
      classification: "PRIVILEGE_ESCALATION",
    };
  }

  if (ABUSE_PATTERN.test(normalized) && ABUSE_ACTION_PATTERN.test(normalized)) {
    return {
      allowed: false,
      answer:
        "본인 확인이나 보상 지급 절차를 우회하는 방법은 안내할 수 없어요.",
      classification: "ABUSE_EVASION",
    };
  }

  if (
    ACTION_TARGET_PATTERN.test(normalized) &&
    ACTION_REQUEST_PATTERN.test(normalized)
  ) {
    return {
      allowed: false,
      answer:
        "퍼뜩 AI는 설명과 내 상태 확인을 도와드려요. 잔액이나 출금 승인, 보상, 권한은 바꿀 수 없어요.",
      classification: "ACTION_BOUNDARY",
    };
  }

  return { allowed: true, classification: "ALLOWED" };
}
