import type {
  AttentionItem,
  TodaySnapshot,
} from "@/app/(control)/_lib/today-snapshot";

const priority: Record<string, number> = {
  SAFE: 0,
  EXCEPTION: 1,
  KRW_BANK: 2,
  USDT_WD: 2,
  KYC: 3,
  KRW_DEPOSIT: 4,
  USDT_DEPOSIT: 4,
};
export function buildDailyBrief(snapshot: TodaySnapshot) {
  const unknown = snapshot.attention.filter(
    (item) => item.status.kind === "unavailable",
  );
  const pending = snapshot.attention
    .filter((item) => item.status.kind === "ready" && item.status.count > 0)
    .sort((a, b) => (priority[a.code] ?? 9) - (priority[b.code] ?? 9));
  const next: AttentionItem | undefined = unknown[0] ?? pending[0];
  return {
    unknown,
    pending,
    next,
    fact:
      snapshot.attentionTotal.kind === "ready"
        ? `현재 확인할 항목은 ${snapshot.attentionTotal.count.toLocaleString("ko-KR")}건이에요.`
        : "확인할 항목의 합계를 아직 알 수 없어요.",
    inference: unknown.length
      ? "일부 정보가 빠져 있어 운영 상태를 단정할 수 없어요."
      : pending.length
        ? "확인할 일이 남아 있어요. 안전 모드와 예외부터 살펴보는 순서를 권해요."
        : "조회된 대기열은 비어 있어요. 서비스 전체가 정상이라는 뜻은 아니에요.",
    recommendation: next
      ? `${next.label}부터 확인해 주세요.`
      : "서비스 상태와 최근 운영 기록을 확인해 주세요.",
    unknownText:
      "이체 진위, 중복 요청 여부, 실제 회원 수신은 별도 기록 확인이 필요해요.",
  };
}
