/**
 * 외부 AI 공급자 호출 허용 판단. 키가 있다는 사실만으로는 호출하지 않는다.
 *
 * 호출하려면 아래가 모두 맞아야 한다.
 * - 소유자가 명시 스위치 AI_PROVIDER_DISPATCH_ENABLED=true 를 켰다.
 * - 승인된 NVIDIA 공급자·키·기본 모델이 함께 설정됐다.
 *
 * APP_ENV=production 도 같은 스위치로만 허용한다. 키만으로는 켜지지 않는다.
 * 스위치는 기본값이 꺼짐이다. 비어 있거나 "true" 가 아니면 꺼짐이다.
 * 꺼져 있으면 정적 안내와 본인 상태 확인만 답한다.
 *
 * 유료 Haiku 는 AI_PAID_CALL_AUTHORIZED=true 와 OPENROUTER_API_KEY 가
 * 함께 있을 때만 route 가 paidCallAuthorized:true 를 넘긴다. 기본은 false.
 * 이 파일은 server-only 모듈을 가져오지 않아 단위 테스트에서 그대로 쓴다.
 */

export const AI_PROVIDER_DISPATCH_SWITCH = "AI_PROVIDER_DISPATCH_ENABLED";
export const AI_PAID_CALL_AUTHORIZED_SWITCH = "AI_PAID_CALL_AUTHORIZED";

export function isAiProviderDispatchSwitchOn(
  value: string | undefined | null,
): boolean {
  return value === "true";
}

export function isAiPaidCallAuthorized(
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
  void input.appEnv;
  return Boolean(
    isAiProviderDispatchSwitchOn(input.switchValue) &&
    input.provider === "nvidia" &&
    input.apiKey &&
    input.model === input.expectedModel,
  );
}
