import { FeedbackMessage } from "../../../components/ui/feedback-message";
import Link from "next/link";
import type { Route } from "next";

export function QueueShell({
  eyebrow,
  title,
  lead,
  backHref = "/" as Route,
  backLabel = "운영 대시보드",
  children,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  backHref?: Route;
  backLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <section className="page-intro queue-intro">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{lead}</p>
        <Link className="text-link" href={backHref}>
          ← {backLabel}
        </Link>
      </section>
      {children}
    </>
  );
}

export function QueueFlash({
  result,
  stale = false,
}: {
  result?: { ok: boolean; message: string } | null;
  stale?: boolean;
}) {
  if (stale) {
    return (
      <FeedbackMessage className="panel-note" role="status">
        입력이 바뀌었습니다. 내용을 다시 확인해 주세요.
      </FeedbackMessage>
    );
  }
  if (!result) return null;
  return (
    <FeedbackMessage
      className={result.ok ? "queue-flash queue-flash--ok" : "queue-flash"}
      role="status"
    >
      {result.message}
    </FeedbackMessage>
  );
}

export function EmptyQueue({ title, body }: { title: string; body: string }) {
  return (
    <section className="queue-empty" aria-live="polite">
      <span aria-hidden="true">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m4 7 3-3h10l3 3v13H4Z" />
          <path d="M4 12h5l1 3h4l1-3h5M8 8h8" />
        </svg>
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      <Link href="/" className="text-link">
        운영 대시보드로 →
      </Link>
    </section>
  );
}

export function QueueCard({
  children,
  tone = "default",
  id,
}: {
  children: React.ReactNode;
  tone?: "default" | "caution" | "done";
  id?: string;
}) {
  return (
    <article className={`queue-card queue-card--${tone}`} id={id}>
      {children}
    </article>
  );
}
