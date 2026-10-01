import { PutdukIcon } from "@/components/icons/putduk-icon";

export function Skeleton({ label = "콘텐츠 불러오는 중" }: { label?: string }) {
  return (
    <div className="state-skeleton" role="status" aria-label={label}>
      <span className="state-skeleton__line state-skeleton__line--short" />
      <span className="state-skeleton__line" />
      <span className="state-skeleton__line state-skeleton__line--medium" />
    </div>
  );
}

type StatePanelProps = {
  action?: React.ReactNode;
  description: string;
  headingLevel?: 1 | 2;
  title: string;
  tone?: "empty" | "error" | "offline";
};

export function StatePanel({
  action,
  description,
  headingLevel = 2,
  title,
  tone = "empty",
}: StatePanelProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className={`state-panel state-panel--${tone}`} role="status">
      <span className="state-panel__icon">
        <PutdukIcon name={tone === "error" ? "shield" : "pulse"} />
      </span>
      <Heading>{title}</Heading>
      <p>{description}</p>
      {action ? <div className="state-panel__action">{action}</div> : null}
    </section>
  );
}
