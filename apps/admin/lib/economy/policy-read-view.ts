import { formatPolicyBps } from "./editor-input";
import type { EconomyConsoleView, EconomySettings } from "./types";

/** 없는 정책 값은 0원으로 바꾸지 않는다. */
const unreadLabel = "확인할 수 없어요";
const notYetLabel = "아직 없어요";

export type PolicyReadItem = {
  label: string;
  value: string;
};

export type PolicyReadTier = {
  code: string;
  name: string;
  items: PolicyReadItem[];
};

export type PolicyReadGroup = {
  title: string;
  note?: string;
  items: PolicyReadItem[];
};

export type PolicyReadView = {
  status: PolicyReadItem[];
  tierNote: string;
  tiers: PolicyReadTier[];
  groups: PolicyReadGroup[];
};

function formatWhen(value: string | null) {
  if (value === null) return notYetLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return unreadLabel;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function formatWon(value: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return unreadLabel;
  return `${BigInt(value).toLocaleString("ko-KR")}원`;
}

function formatPercent(bps: number) {
  try {
    return `${formatPolicyBps(bps, 2)}%`;
  } catch {
    return unreadLabel;
  }
}

function formatMultiplier(bps: number) {
  try {
    return `${formatPolicyBps(bps, 4)}배`;
  } catch {
    return unreadLabel;
  }
}

function formatCount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) return unreadLabel;
  return `${value.toLocaleString("ko-KR")}개`;
}

function settlementLabel(status: string) {
  if (status === "POLICY_CONSUMER_NOT_ENABLED") return "아직 연결되지 않음";
  return unreadLabel;
}

function tierItems(row: EconomySettings["tiers"][number]): PolicyReadItem[] {
  return [
    { label: "원금 하한", value: formatWon(row.minimumPrincipalKrw) },
    {
      label: "원금 상한",
      value:
        row.maximumPrincipalKrw === null
          ? "상한 없음"
          : formatWon(row.maximumPrincipalKrw),
    },
    { label: "유지 혜택", value: formatPercent(row.retentionBonusBps) },
    { label: "동시 상품", value: formatCount(row.slots) },
  ];
}

/**
 * 선택한 정책 버전에 이미 들어 있는 값만 한국어로 나눈다.
 * 유지 혜택·한도·속도·배율은 원금 금액으로 적지 않는다.
 */
export function presentEconomyPolicyRead(
  view: EconomyConsoleView,
): PolicyReadView {
  const settings = view.selectedVersion.settings;
  const campaign = settings.campaign;
  const product = settings.productMultiplier;
  const allocation = settings.allocation;
  const override = settings.userOverride;
  const fees = settings.platformFeesKrw;
  return {
    status: [
      {
        label: "정산 연결",
        value: settlementLabel(view.runtimeStatus),
      },
      {
        label: "최근 발행 적용 시간",
        value: formatWhen(view.latestPublishedStart),
      },
      { label: "조회 시각", value: formatWhen(view.serverNow) },
    ],
    tierNote: "유지 혜택은 원금이 아니에요.",
    tiers: settings.tiers.map((row) => ({
      code: row.code,
      name: row.name,
      items: tierItems(row),
    })),
    groups: [
      {
        title: "상품 배율",
        note: "배율은 원금이 아니에요.",
        items: [
          { label: "최소 배율", value: formatMultiplier(product.minimumBps) },
          { label: "기본 배율", value: formatMultiplier(product.defaultBps) },
          { label: "최대 배율", value: formatMultiplier(product.maximumBps) },
        ],
      },
      {
        title: "상품 배분",
        items: [
          {
            label: "전체 상한",
            value: formatPercent(allocation.maximumTotalBps),
          },
          {
            label: "상품 하나 상한",
            value: formatPercent(allocation.maximumPerProductBps),
          },
        ],
      },
      {
        title: "캠페인 한도",
        note: "한도 추가는 원금이 아니에요.",
        items: [
          {
            label: "기본 한도 추가",
            value: formatPercent(campaign.defaultCapacityBoostBps),
          },
          {
            label: "한 건 한도 추가",
            value: formatPercent(campaign.maximumSingleCapacityBoostBps),
          },
          {
            label: "동시 한도 추가",
            value: formatPercent(campaign.maximumCombinedCapacityBoostBps),
          },
        ],
      },
      {
        title: "캠페인 속도",
        note: "속도는 원금이 아니에요.",
        items: [
          {
            label: "기본 속도",
            value: formatMultiplier(campaign.defaultSpeedMultiplierBps),
          },
          {
            label: "한 건 속도",
            value: formatMultiplier(campaign.maximumSingleSpeedMultiplierBps),
          },
          {
            label: "동시 속도",
            value: formatMultiplier(campaign.maximumCombinedSpeedMultiplierBps),
          },
        ],
      },
      {
        title: "개별 조정",
        note: "개별 조정은 원금이 아니에요.",
        items: [
          {
            label: "최소 배율",
            value: formatMultiplier(override.minimumMultiplierBps),
          },
          {
            label: "기본 배율",
            value: formatMultiplier(override.defaultMultiplierBps),
          },
          {
            label: "최대 배율",
            value: formatMultiplier(override.maximumMultiplierBps),
          },
        ],
      },
      {
        title: "작업 수수료",
        note: "수수료는 각 작업에 저장된 금액이에요.",
        items: [
          { label: "원화 입금", value: formatWon(fees.krwDeposit) },
          {
            label: "USDT 입금 환산",
            value: formatWon(fees.usdtDepositConversion),
          },
          { label: "채굴", value: formatWon(fees.mining) },
          {
            label: "채굴 수익 출금",
            value: formatWon(fees.krwMiningRewardWithdrawal),
          },
          { label: "원금 회수", value: formatWon(fees.principalRecovery) },
        ],
      },
    ],
  };
}
