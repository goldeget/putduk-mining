import type { ComponentPropsWithRef } from "react";

import styles from "./feedback-message.module.css";

export type FeedbackTone = "danger" | "info" | "success" | "warning";

const symbols: Record<FeedbackTone, string> = {
  danger: "⚠️",
  info: "💡",
  success: "✅",
  warning: "🔎",
};

/** Decoration stays outside the spoken message and its exact text content. */
export function FeedbackSymbol({ tone }: { tone: FeedbackTone }) {
  return (
    <span
      className={styles.symbol}
      aria-hidden="true"
      data-feedback-symbol={symbols[tone]}
    />
  );
}

/** Persistent feedback: the existing domain message and live-region role win. */
export function FeedbackMessage({
  children,
  className,
  role = "status",
  tone,
  ...attributes
}: ComponentPropsWithRef<"p"> & { tone?: FeedbackTone }) {
  if (children == null || children === "") return null;
  const resolvedTone =
    tone ??
    (role === "alert" || className?.includes("--error")
      ? "danger"
      : className?.includes("--success") ||
          className?.includes("--confirmation")
        ? "success"
        : "info");
  return (
    <p
      {...attributes}
      className={[styles.message, className].filter(Boolean).join(" ")}
      role={role}
      data-feedback-tone={resolvedTone}
    >
      <FeedbackSymbol tone={resolvedTone} />
      {children}
    </p>
  );
}
