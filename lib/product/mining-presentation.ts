import { presentTrialStatus } from "@/lib/product/home-start-display";
import {
  isConfirmedMiningRunning,
  presentMiningStatus,
  type MiningStatusTone,
} from "@/lib/product/mining-display";
import {
  presentMiningServerDisplay,
  resolveFundedRuntimeStatus,
  type MiningServerDisplay,
} from "@/lib/product/mining-server-display";

type Session = {
  status: string | null | undefined;
  world_name_ko?: string | null;
};

type Presentation = {
  source: "funded" | "legacy" | "empty" | "unknown";
  running: boolean;
  label: string;
  title: string;
  lead: string;
  tone: MiningStatusTone;
  action: "reload" | "allocation" | "start" | "none";
};

const unknown: Presentation = {
  source: "unknown",
  running: false,
  label: "상태 확인 중",
  title: "채굴 상태를 다시 확인해 주세요",
  lead: "기록을 다시 불러오면 현재 상태를 보여 드려요.",
  tone: "neutral",
  action: "reload",
};

/** A paid source takes priority; only verified absence permits the old session path. */
export function resolveMiningPresentation(input: {
  display: MiningServerDisplay | null;
  displayError: boolean;
  session: Session | null | undefined;
  sessionError: boolean;
}): Presentation {
  if (input.displayError || !input.display) return unknown;
  const display = input.display;
  if (display.available || display.funded_runtime !== undefined) {
    if (!display.available) return unknown;
    const runtime = display.funded_runtime;
    const status = resolveFundedRuntimeStatus(runtime);
    if (status === "UNKNOWN") return unknown;
    if (status === "ACTIVE") {
      return {
        source: "funded",
        running: true,
        label: "채굴 중",
        title: "실제 채굴 · 채굴 중",
        lead: "확인된 배분으로 채굴하고 있어요. 확정 금액은 지갑에서 확인해 주세요.",
        tone: "success",
        action: "allocation",
      };
    }
    const reason = runtime?.schema_version === 2 ? runtime.stop_reason : null;
    const label =
      reason === "SAFE_MODE"
        ? "안전 모드로 잠시 멈춤"
        : reason === "CAPACITY_USED"
          ? "이번 한도 완료"
          : "배분 대기";
    return {
      source: "funded",
      running: false,
      label,
      title: `실제 채굴 · ${label}`,
      lead:
        reason === "SAFE_MODE"
          ? "안전 모드로 잠시 멈췄어요. 지금까지 확인된 채굴 기록은 유지돼요."
          : reason === "CAPACITY_USED"
            ? "이번 채굴 한도를 사용했어요. 확정된 기록은 유지돼요."
            : "채굴할 상품과 배분을 확인해 주세요.",
      tone: "neutral",
      action: reason === "SAFE_MODE" ? "reload" : "allocation",
    };
  }
  if (input.sessionError) return unknown;
  if (input.session) {
    const status = presentMiningStatus(input.session.status);
    if (status.label === "상태 확인 중") return unknown;
    return {
      source: "legacy",
      running: isConfirmedMiningRunning(input.session.status),
      label: status.label,
      title: `${input.session.world_name_ko?.trim() || "채굴 월드"} · ${status.label}`,
      lead: "현재 확인된 채굴 상태예요. 정산된 금액은 지갑에서 확인할 수 있어요.",
      tone: status.tone,
      action: "none",
    };
  }
  return {
    source: "empty",
    running: false,
    label: "시작 전",
    title: "첫 월드에서 채굴을 시작해 보세요",
    lead: "PUTDUK START로 첫 채굴을 시작해 보세요.",
    tone: "neutral",
    action: "start",
  };
}

/** Select existing server display strings. No daily aggregate, rate, or capacity ratio is derived. */
export function presentMiningReferenceFacts(
  display: MiningServerDisplay | null,
  error = false,
) {
  const ready = !error && display?.available ? display : null;
  const view = ready ? presentMiningServerDisplay(ready) : null;
  const value = (label: string, proof: unknown) =>
    proof == null || view?.state !== "ready"
      ? "확인할 수 없어요"
      : (view.rows.find((row) => row.label === label)?.value ??
        "확인할 수 없어요");
  return {
    principal: value("인정 원금", ready?.eligible_principal_micro_krw),
    tier: ready
      ? value("등급", ready.tier_activated ? ready.tier_code : false)
      : "확인할 수 없어요",
    today: "확인할 수 없어요",
    capacity: value("이번 한도", ready?.effective_capacity_micro_krw),
    used: value("사용한 한도", ready?.used_capacity_micro_krw),
    remaining: value("남은 한도", ready?.remaining_capacity_micro_krw),
    speed: value(
      "속도",
      ready?.funded_runtime?.schema_version === 2 ? ready.funded_runtime : null,
    ),
    period: value(
      "기간",
      (ready?.cycle_started_at && ready?.cycle_end) || null,
    ),
    pending: value("정산 전", ready?.pending_micro_krw),
    committed: value("채굴 확정 누계", ready?.funded_runtime),
  };
}

/** START is a separate verified trial snapshot, never fallback proof for paid mining. */
export function presentMiningTrial(
  status: string | null | undefined,
  unavailable = false,
) {
  const known =
    !unavailable &&
    ["READY", "ACTIVE", "COMPLETED", "EXPIRED"].includes(status ?? "");
  return {
    known,
    presentation: presentTrialStatus(known ? status : undefined),
    actionLabel: !known
      ? "START 상태 다시 확인"
      : status === "ACTIVE"
        ? "START 계속하기"
        : status === "READY"
          ? "PUTDUK START 확인"
          : "START 결과 보기",
  };
}
