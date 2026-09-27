import Link from "next/link";
import type { Route } from "next";

export function QueueShell({
  eyebrow,
  title,
  lead,
  backHref = "/" as Route,
  backLabel = "오늘의 퍼뜩",
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
}: {
  result?: { ok: boolean; message: string } | null;
}) {
  if (!result) return null;
  return (
    <p
      className={result.ok ? "queue-flash queue-flash--ok" : "queue-flash"}
      role="status"
    >
      {result.message}
    </p>
  );
}

export function EmptyQueue({ title, body }: { title: string; body: string }) {
  return (
    <section className="queue-empty" aria-live="polite">
      <span>0</span>
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}

export function QueueCard({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "caution" | "done";
}) {
  return (
    <article className={`queue-card queue-card--${tone}`}>{children}</article>
  );
}
