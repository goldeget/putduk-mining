import type { HomePrimaryAction } from "@/lib/product/home-start-display";
import { formatAtomicAmount } from "@/domain/wallet/format-amount";
import {
  formatMiningMicroKrw,
  resolveFundedRuntimeStatus,
  type FundedRuntimeDisplay,
  type MiningServerDisplay,
} from "@/lib/product/mining-server-display";
import {
  isConfirmedMiningRunning,
  presentMiningStatus,
} from "@/lib/product/mining-display";

type Snapshot = {
  status: string | null | undefined;
  world_name_ko?: string | null;
};

const knownTrialStatuses = new Set(["READY", "ACTIVE", "COMPLETED", "EXPIRED"]);
const knownMiningStatuses = new Set([
  "NORMAL",
  "REDUCED",
  "MAINTENANCE",
  "PARTIAL_STOP",
  "STOPPED",
]);

function worldName(snapshot: Snapshot | null | undefined) {
  return snapshot?.world_name_ko?.trim() || "한국";
}

/** Display only: failed reads and new enums never imply readiness or running. */
export function resolveHomeWorldState(input: {
  trial: Snapshot | null | undefined;
  mining: Snapshot | null | undefined;
  trialUnavailable: boolean;
  miningUnavailable: boolean;
  fundedDisplay: MiningServerDisplay | null | undefined;
  fundedUnavailable: boolean;
}) {
  // A failed read can retain data. It is not a confirmed source for the scene.
  const trial = input.trialUnavailable ? null : input.trial;
  const mining = input.miningUnavailable ? null : input.mining;
  const trialStatusKnown =
    !input.trialUnavailable &&
    (!trial || knownTrialStatuses.has(trial.status ?? ""));
  const miningStatusKnown =
    !input.miningUnavailable &&
    (!mining || knownMiningStatuses.has(mining.status ?? ""));
  const funded = input.fundedUnavailable ? null : input.fundedDisplay;
  const fundedStatus = funded?.available
    ? resolveFundedRuntimeStatus(funded.funded_runtime)
    : "UNKNOWN";
  const fundedUnknown =
    !funded ||
    (funded.available && fundedStatus === "UNKNOWN") ||
    (!funded.available && funded.funded_runtime !== undefined);

  // A paid read takes priority. Only verified absence permits legacy/START fallback.
  if (fundedUnknown || funded?.available) {
    const unavailable = input.fundedUnavailable;
    const partial = input.trialUnavailable || input.miningUnavailable;
    const sourceState = unavailable
      ? partial
        ? ("error" as const)
        : ("partial" as const)
      : fundedUnknown
        ? ("unknown" as const)
        : partial || !trialStatusKnown || !miningStatusKnown
          ? ("partial" as const)
          : ("loaded" as const);
    const safeMode =
      fundedStatus === "STOPPED" &&
      funded?.funded_runtime?.schema_version === 2 &&
      funded.funded_runtime.stop_reason === "SAFE_MODE";
    const primary: HomePrimaryAction = fundedUnknown
      ? { href: "/home", label: "상태 다시 확인" }
      : fundedStatus === "ACTIVE"
        ? { href: "/mining", label: "실제 채굴 보기" }
        : safeMode
          ? { href: "/mining", label: "채굴 상태 확인" }
          : { href: "/products/allocation", label: "채굴 배분 확인" };
    const capacityUsed =
      funded?.funded_runtime?.schema_version === 2 &&
      funded.funded_runtime.stop_reason === "CAPACITY_USED";
    return {
      sourceState,
      needsRequery: fundedUnknown,
      running: !fundedUnknown && fundedStatus === "ACTIVE",
      liveLabel: fundedUnknown
        ? unavailable
          ? "상태를 불러오지 못했어요"
          : "상태 확인이 필요해요"
        : fundedStatus === "ACTIVE"
          ? "채굴 중"
          : safeMode
            ? "안전 모드로 잠시 멈춤"
            : capacityUsed
              ? "이번 한도 완료"
              : "배분 대기",
      worldTitle: fundedUnknown ? "다시 확인해 주세요" : "실제 채굴",
      worldLead: fundedUnknown
        ? "실제 채굴 상태를 다시 확인하면 다음 안내를 보여 드려요."
        : fundedStatus === "ACTIVE"
          ? "서버에서 확인된 배분으로 채굴을 이어가고 있어요."
          : safeMode
            ? "안전 모드로 잠시 멈췄어요. 지금까지 확인된 채굴 기록은 유지돼요."
            : capacityUsed
              ? "이번 채굴 한도를 사용했어요. 상품과 배분을 확인해 주세요."
              : "채굴할 상품과 배분을 확인해 주세요.",
      primary,
      trialStatusKnown,
      notStarted: false,
    };
  }
  const readFailed = input.trialUnavailable || input.miningUnavailable;
  const unknown = !readFailed && (!trialStatusKnown || !miningStatusKnown);
  const needsRequery = readFailed || unknown;
  const sourceState = readFailed
    ? input.trialUnavailable && input.miningUnavailable
      ? ("error" as const)
      : ("partial" as const)
    : unknown
      ? ("unknown" as const)
      : ("loaded" as const);
  let running = false;
  let liveLabel = "시작 준비 완료";
  let worldTitle = worldName(trial);
  let worldLead = "안내에 따라 첫 채굴 결과를 만나보세요.";
  let primary: HomePrimaryAction = { href: "/start", label: "첫 채굴 시작" };

  if (needsRequery) {
    liveLabel = readFailed
      ? "상태를 불러오지 못했어요"
      : "상태 확인이 필요해요";
    worldTitle = "다시 확인해 주세요";
    worldLead = "채굴 정보를 다시 확인하면 다음 안내를 보여 드려요.";
    primary = { href: "/home", label: "상태 다시 확인" };
  } else if (mining) {
    running = isConfirmedMiningRunning(mining.status);
    liveLabel = presentMiningStatus(mining.status).label;
    worldTitle = worldName(mining);
    worldLead = running
      ? "앱을 닫아도 채굴은 계속돼요."
      : "현재 확인된 채굴 상태예요. 상태가 바뀌면 다시 확인해 주세요.";
    primary = { href: "/mining", label: "채굴 월드 보기" };
  } else if (trial?.status === "ACTIVE") {
    running = true;
    liveLabel = "PUTDUK START 진행 중";
    worldLead =
      "앱을 닫아도 채굴은 계속돼요. 다시 접속하면 결과를 확인할 수 있어요.";
    primary = { href: "/start", label: "START 계속하기" };
  } else if (trial?.status === "COMPLETED" || trial?.status === "EXPIRED") {
    liveLabel =
      trial.status === "COMPLETED" ? "PUTDUK START 완료" : "PUTDUK START 종료";
    worldLead = "체험은 끝났어요. 환영 보상은 START에서 이어가요.";
    primary = { href: "/start", label: "START 결과 보기" };
  }

  return {
    sourceState,
    needsRequery,
    running,
    liveLabel,
    worldTitle,
    worldLead,
    primary,
    trialStatusKnown,
    notStarted: !needsRequery && !trial && !mining,
  };
}

/** This accepted sum is per activation. The DTO does not provide a daily aggregate. */
export function presentHomeMiningFacts(
  runtime: FundedRuntimeDisplay | null | undefined,
) {
  return {
    today: "확인할 수 없어요",
    committedTotal: runtime
      ? formatAtomicAmount(runtime.committed_reward_total_atomic, "KRW")
      : "확인할 수 없어요",
  };
}

/** These two amounts are already computed by the server; neither is a wallet total. */
export function presentHomeFundingFacts(
  display: MiningServerDisplay | null | undefined,
  unavailable = false,
) {
  const confirmed = !unavailable && display?.available ? display : null;
  return {
    principal:
      confirmed?.eligible_principal_micro_krw == null
        ? "확인할 수 없어요"
        : formatMiningMicroKrw(confirmed.eligible_principal_micro_krw),
    remainingCapacity:
      confirmed?.remaining_capacity_micro_krw == null
        ? "확인할 수 없어요"
        : formatMiningMicroKrw(confirmed.remaining_capacity_micro_krw),
  };
}
