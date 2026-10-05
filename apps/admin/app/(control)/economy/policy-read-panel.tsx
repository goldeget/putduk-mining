import { presentEconomyPolicyRead } from "../../../lib/economy/policy-read-view";
import type { EconomyConsoleView } from "../../../lib/economy/types";
import styles from "./economy.module.css";

function ReadList({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className={styles.facts}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 승인 폼과 분리된, 저장된 정책 값 표시. */
export function PolicyReadPanel({ view }: { view: EconomyConsoleView }) {
  const read = presentEconomyPolicyRead(view);
  return (
    <section className={styles.panel} aria-label="저장된 정책 값">
      <div className={styles.panelHead}>
        <div>
          <p className="eyebrow">선택한 버전</p>
          <h2>저장된 정책 값</h2>
        </div>
      </div>
      <p className={styles.note}>선택한 버전에 저장된 값만 보여 줍니다.</p>
      <ReadList items={read.status} />
      <h3>등급별 원금 범위</h3>
      <p className={styles.note}>{read.tierNote}</p>
      <div className={styles.tiers}>
        {read.tiers.map((tier) => (
          <section className={styles.tier} key={tier.code}>
            <h4>
              {tier.code} <span>{tier.name}</span>
            </h4>
            <ReadList items={tier.items} />
          </section>
        ))}
      </div>
      {read.groups.map((group) => (
        <div key={group.title}>
          <h3>{group.title}</h3>
          {group.note ? <p className={styles.note}>{group.note}</p> : null}
          <ReadList items={group.items} />
        </div>
      ))}
    </section>
  );
}
