import { StatePanel } from "@/components/ui/states";
import type { MiningAmountView } from "@/lib/product/mining-server-display";

import styles from "./mining-amount-board.module.css";

const missingLabel = "아직 없어요";
const unreadableLabel = "확인할 수 없어요";

type ReadyView = Extract<MiningAmountView, { state: "ready" }>;
type AmountWeight = "lead" | "companion" | "pending" | "speed" | "capacity";

/** 이미 한국어로 바뀐 서버 표시값만 고른다. 금액을 다시 계산하지 않는다. */
export function miningDisplayedValue(view: ReadyView, label: string) {
  return view.rows.find((row) => row.label === label)?.value ?? missingLabel;
}

function retentionCopy(value: string) {
  if (value === missingLabel) {
    return "확인 전 금액은 아직 없어요. 확정된 수익이 아니에요.";
  }
  if (value === unreadableLabel) {
    return "확인 전 금액을 확인할 수 없어요. 확정된 수익이 아니에요.";
  }
  return `확인 전 ${value}. 확정된 수익이 아니에요.`;
}

function Fact({
  label,
  value,
  weight,
}: {
  label: string;
  value: string;
  weight: AmountWeight;
}) {
  return (
    <div data-amount-weight={weight}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Lead({ view }: { view: ReadyView }) {
  return (
    <dl className={styles.moneyLead} aria-label="채굴 원금과 등급">
      <Fact
        label="채굴 원금"
        value={miningDisplayedValue(view, "인정 원금")}
        weight="lead"
      />
      <Fact
        label="현재 등급"
        value={miningDisplayedValue(view, "등급")}
        weight="companion"
      />
    </dl>
  );
}

function Follow({ view }: { view: ReadyView }) {
  return (
    <div className={styles.moneyFollow}>
      <dl className={styles.moneyPair} aria-label="정산 전과 속도">
        <Fact
          label="정산 전"
          value={miningDisplayedValue(view, "정산 전")}
          weight="pending"
        />
        <Fact
          label="채굴 속도"
          value={miningDisplayedValue(view, "속도")}
          weight="speed"
        />
      </dl>
      <section
        className={styles.moneyCapacity}
        aria-labelledby="mining-capacity-title"
        data-amount-weight="capacity"
      >
        <h3 id="mining-capacity-title">채굴 용량</h3>
        <dl>
          <Fact
            label="이번 한도"
            value={miningDisplayedValue(view, "이번 한도")}
            weight="capacity"
          />
          <Fact
            label="사용한 한도"
            value={miningDisplayedValue(view, "사용한 한도")}
            weight="capacity"
          />
          <Fact
            label="남은 한도"
            value={miningDisplayedValue(view, "남은 한도")}
            weight="capacity"
          />
        </dl>
      </section>
      <p className={styles.moneyRetention} data-amount-weight="unconfirmed">
        {retentionCopy(miningDisplayedValue(view, "확인 전"))}
      </p>
    </div>
  );
}

function Unavailable({ error }: { error: boolean }) {
  if (error) {
    return (
      <StatePanel
        tone="error"
        title="채굴 금액을 불러오지 못했어요"
        description="잠시 후 다시 시도해 주세요."
      />
    );
  }
  return <p className={styles.moneyEmpty}>채굴 금액은 아직 없어요.</p>;
}

export function MiningAmountBoard({
  error,
  placement,
  view,
}: {
  error: boolean;
  placement: "lead" | "follow" | "stack";
  view: MiningAmountView | null;
}) {
  const ready = !error && view?.state === "ready" ? view : null;
  if (!ready) {
    if (placement === "lead") {
      return null;
    }
    return <Unavailable error={error} />;
  }
  if (placement === "lead") {
    return <Lead view={ready} />;
  }
  if (placement === "follow") {
    return <Follow view={ready} />;
  }
  return (
    <div className={styles.moneyStack}>
      <Lead view={ready} />
      <Follow view={ready} />
    </div>
  );
}
