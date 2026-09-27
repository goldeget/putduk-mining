export type AiOutputGuardResult =
  { allowed: true } | { allowed: false; code: "AI_OUTPUT_POLICY_REJECTED" };

const INTERNAL_DISCLOSURE_PATTERN =
  /(시스템\s*프롬프트|developer\s*message|service[_ -]?role|api\s*key|비밀\s*키)\s*(은|는|:|=)/i;
const PERSONAL_ACCOUNT_CLAIM_PATTERN =
  /((회원님의|고객님의|당신의|내)\s*(현재\s*)?|((조회|확인)\s*결과|현재)\s*(본인\s*)?)(잔액|지갑|입금|출금|채굴\s*보상|추천\s*보상|kyc\s*상태|본인\s*인증\s*상태).{0,40}(\d[\d,.]*\s*(원|krw|usdt)|완료|승인|반려|대기|접수|검토|진행|실패|취소|보류|재제출|확인|지급|처리\s*중)/i;

export function createAiProviderOutputGuard() {
  let carry = "";

  return {
    inspect(delta: string): AiOutputGuardResult {
      const candidate = `${carry}${delta}`;
      carry = candidate.slice(-512);

      if (INTERNAL_DISCLOSURE_PATTERN.test(candidate)) {
        return { allowed: false, code: "AI_OUTPUT_POLICY_REJECTED" };
      }

      if (PERSONAL_ACCOUNT_CLAIM_PATTERN.test(candidate)) {
        return { allowed: false, code: "AI_OUTPUT_POLICY_REJECTED" };
      }

      return { allowed: true };
    },
  };
}
