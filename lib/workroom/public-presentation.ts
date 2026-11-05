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
  "/economy": "체험 포인트와 기존 기록",
  "/deposit": "무료 이용 안내",
  "/withdrawal": "기존 잔액 안내",
  "/verification": "기록 확인 기준",
  "/terms": "이용약관",
  "/privacy": "개인정보 처리방침",
};
export function getTrustNavigationLabel(path: string) {
  return labels[path] ?? "워크룸 안내";
}
export function getPublicFactDisplayValue(fact: PublicFact) {
  return fact.value;
}
