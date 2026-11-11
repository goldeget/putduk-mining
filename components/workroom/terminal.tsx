import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeControl } from "../system/theme-control";
import { WorkroomMark } from "./workroom-mark";
import workspace from "./workroom.module.css";
import styles from "./terminal.module.css";

/** Standalone recovery keeps one page heading and the same member visual system. */
export function WorkroomTerminal({
  title,
  description,
  action,
  state = "error",
  ready,
}: {
  title: string;
  description: ReactNode;
  action: ReactNode;
  state?: "error" | "offline";
  ready?: string;
}) {
  return (
    <main
      className={`${workspace.theme} ${styles.page}`}
      data-ui-state={state}
      data-ui-ready={ready}
    >
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="WORKROOM 홈">
          <WorkroomMark />
          <span>
            WORKROOM<small>나만의 워크룸</small>
          </span>
        </Link>
        <ThemeControl />
      </header>
      <section
        className={styles.card}
        role={state === "error" ? "alert" : undefined}
      >
        <span className={styles.eyebrow}>
          {state === "offline" ? "CONNECTION" : "WORKROOM SUPPORT"}
        </span>
        <h1>{title}</h1>
        <div className={styles.description}>{description}</div>
        <div className={styles.actions}>{action}</div>
      </section>
      <footer className={styles.footer}>© 2026 WORKROOM</footer>
    </main>
  );
}
