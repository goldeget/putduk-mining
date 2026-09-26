import type { ReactNode } from "react";

export function StatusToast({
  action,
  description,
  title,
  tone = "info",
}: {
  action?: ReactNode;
  description: string;
  title: string;
  tone?: "danger" | "info" | "success" | "warning";
}) {
  const urgent = tone === "danger";

  return (
    <aside
      className={`toast toast--${tone}`}
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
    >
      <span aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {action ? <div className="toast__action">{action}</div> : null}
    </aside>
  );
}
