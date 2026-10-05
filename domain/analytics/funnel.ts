import type { AnalyticsEventName } from "@/domain/analytics/events";

/** 문서의 기본 퍼널. 호스팅 대시보드 설정은 이 저장소 밖이다. */
export const CORE_FUNNEL_STEPS = [
  "landing_view",
  "signup_complete",
  "trial_start",
  "trial_first_reward",
  "trial_50_percent",
  "trial_complete",
  "welcome_reward_qualified",
  "welcome_reward_converted",
  "welcome_withdrawal_complete",
  "withdrawal_complete_no_funding",
  "deposit_start",
  "deposit_complete",
  "real_mining_start",
  "first_real_settlement",
  "return_visit",
] as const satisfies readonly AnalyticsEventName[];

export const PRODUCTION_FUNNEL_DASHBOARD = {
  id: "core_activation",
  steps: CORE_FUNNEL_STEPS,
} as const;

export type FunnelObservation = {
  actorId: string;
  eventName: string;
  occurredAt: string;
};

/** 시간 순으로 앞 단계를 통과한 사람만 다음 단계에 센다. */
export function countCoreFunnel(observations: readonly FunnelObservation[]) {
  const byActor = new Map<string, FunnelObservation[]>();
  for (const observation of observations) {
    if (!observation.actorId) continue;
    const list = byActor.get(observation.actorId) ?? [];
    list.push(observation);
    byActor.set(observation.actorId, list);
  }

  const counts = CORE_FUNNEL_STEPS.map(() => 0);
  for (const events of byActor.values()) {
    const ordered = [...events].sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt),
    );
    let step = 0;
    for (const event of ordered) {
      if (step >= CORE_FUNNEL_STEPS.length) break;
      if (event.eventName === CORE_FUNNEL_STEPS[step]) step += 1;
    }
    for (let index = 0; index < step; index += 1) {
      counts[index] = (counts[index] ?? 0) + 1;
    }
  }

  return CORE_FUNNEL_STEPS.map((step, index) => ({
    actors: counts[index] ?? 0,
    step,
  }));
}
