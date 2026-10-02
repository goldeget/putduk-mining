/** 기존 KYC 상태·위험 enum의 표시용 한국어. 새 위험 정책을 만들지 않는다. */

export function kycStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "대기";
    case "IN_REVIEW":
      return "검토 중";
    case "APPROVED":
      return "승인";
    case "ON_HOLD":
      return "보류";
    case "REJECTED":
      return "반려";
    case "REQUIRES_RESUBMISSION":
      return "재제출 필요";
    default:
      return status;
  }
}

export function kycRiskLabel(riskLevel: string): string {
  switch (riskLevel) {
    case "UNASSESSED":
      return "미평가";
    case "LOW":
      return "낮음";
    case "MEDIUM":
      return "보통";
    case "HIGH":
      return "높음";
    default:
      return riskLevel;
  }
}
