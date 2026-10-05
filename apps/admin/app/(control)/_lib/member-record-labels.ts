import { kycRiskLabel } from "../kyc/labels";

/** No reviewed flag-code vocabulary is published by the current risk producer. */
export const ADDITIONAL_REVIEW_RECORD_LABEL = "추가 확인 기록";

/** Display the persisted severity only; never infer a decision from a flag code. */
export function memberRiskSeverityLabel(severity: string): string {
  switch (severity) {
    case "LOW":
    case "MEDIUM":
    case "HIGH":
      return kycRiskLabel(severity);
    case "CRITICAL":
      return "매우 높음";
    default:
      return "확인 필요";
  }
}

// Exact timeline values written by capture_public_signup_identity. Do not infer
// activity, completion or money from unregistered codes or a matching prefix.
const eventLabels = new Map<string, string>([
  ["MEMBER_PROFILE_CAPTURED", "가입 정보 기록"],
]);
const summaryLabels = new Map<string, string>([
  ["SIGNUP_PROFILE_COMPLETED", "가입할 때 입력한 정보를 저장했습니다."],
]);

export function memberTimelineEventLabel(code: string): string {
  return eventLabels.get(code) ?? ADDITIONAL_REVIEW_RECORD_LABEL;
}

export function memberTimelineSummaryLabel(code: string): string {
  return summaryLabels.get(code) ?? "세부 내용은 확인이 필요합니다.";
}
