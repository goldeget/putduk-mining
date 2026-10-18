/**
 * 외부 AI 공급자 호출 허용 판단. 키가 있다는 사실만으로는 호출하지 않는다.
 *
 * 호출하려면 아래가 모두 맞아야 한다.
 * - 운영(production)이 아니다. 운영은 별도 승인·검토 단계 전까지 코드로 막는다.
 * - 소유자가 명시 스위치 AI_PROVIDER_DISPATCH_ENABLED=true 를 켰다.
 * - 승인된 NVIDIA 공급자·키·기본 모델이 함께 설정됐다.
 *
 * 스위치는 기본값이 꺼짐이다. 비어 있거나 "true" 가 아니면 꺼짐이다.
 * 꺼져 있으면 정적 안내와 본인 상태 확인만 답한다. 유료 호출 승인은
 * 이 스위치와 무관하게 별도이며 route 가 paidCallAuthorized:false 를 넘긴다.
 * 이 파일은 server-only 모듈을 가져오지 않아 단위 테스트에서 그대로 쓴다.
 */

export const AI_PROVIDER_DISPATCH_SWITCH = "AI_PROVIDER_DISPATCH_ENABLED";

export function isAiProviderDispatchSwitchOn(
  value: string | undefined | null,
): boolean {
  return value === "true";
}

export function isAiProviderDispatchAdmitted(input: {
  apiKey: string | undefined | null;
  appEnv: string | undefined | null;
  expectedModel: string;
  model: string | undefined | null;
  provider: string | undefined | null;
  switchValue: string | undefined | null;
}): boolean {
  return Boolean(
    input.appEnv !== "production" &&
    isAiProviderDispatchSwitchOn(input.switchValue) &&
    input.provider === "nvidia" &&
    input.apiKey &&
    input.model === input.expectedModel,
  );
}
