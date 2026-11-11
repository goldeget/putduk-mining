import type { PublicFact } from "./public-content";
export {
  getPublicFactLabel,
  localizePublicWorldNames,
} from "@/lib/trust/public-presentation";

const labels: Record<string, string> = {
  "/about": "워크룸 소개",
  "/how-it-works": "이용 방법",
  "/faq": "자주 묻는 질문",
  "/mining-rules": "회차 규칙",
  "/trial": "무료 체험 안내",
  "/economy": "포인트와 실제 잔액",
  "/deposit": "입금 안내",
  "/withdrawal": "출금 안내",
  "/verification": "기록 확인 기준",
  "/terms": "이용약관",
  "/privacy": "개인정보 처리방침",
  "/putduk-facts": "서비스 정보",
  "/status": "서비스 상태",
  "/changelog": "변경 안내",
  "/ai/about": "이전 AI 서비스 안내",
  "/ai/facts": "이전 AI 정보",
  "/ai/faq": "이전 AI 도움말",
  "/ai/how-it-works": "이전 AI 이용 방법",
};
export function getTrustNavigationLabel(path: string) {
  return labels[path] ?? "워크룸 안내";
}
export function getPublicFactDisplayValue(fact: PublicFact) {
  return fact.value;
}
