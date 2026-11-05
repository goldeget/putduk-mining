import type { ReactNode } from "react";
import Link from "next/link";

import { WorkroomMark } from "@/components/workroom/identity";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ThemeControl } from "@/components/system/theme-control";

import styles from "./auth-experience.module.css";

type AuthExperienceProps = {
  route: string;
  titleId: string;
  eyebrow: string;
  title: string;
  description: string;
  panelTitle: string;
  panelDescription: string;
  children?: ReactNode;
  footer?: ReactNode;
  spacious?: boolean;
  state?: "loaded" | "error";
};

/** Static approved artwork only. It does not select a product or run mining. */
export function AuthArtwork() {
  return (
    <div className={styles.artwork}>
      <WorkroomMark />
    </div>
  );
}

export function AuthExperience({
  route,
  titleId,
  eyebrow,
  title,
  description,
  panelTitle,
  panelDescription,
  children,
  footer,
  spacious = false,
  state = "loaded",
}: AuthExperienceProps) {
  return (
    <main
      className={`${styles.root} ${spacious ? styles.spacious : ""}`}
      data-ui-ready={route}
      data-ui-state={state}
    >
      <div className={styles.stage}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/" aria-label="WORKROOM 홈">
            <WorkroomMark />
            <span>
              <strong>WORKROOM</strong>
              <small>나만의 워크룸</small>
            </span>
          </Link>
          <ThemeControl />
        </header>
        <div className={styles.composition} data-auth-layout="stage">
          <section className={styles.story} aria-labelledby={titleId}>
            <div className={styles.scene} aria-hidden="true">
              <AuthArtwork />
              <div className={styles.scrim} data-auth-scrim="" />
            </div>
            <div className={styles.storyCopy}>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1 id={titleId}>{title}</h1>
              <p className={styles.description}>{description}</p>
            </div>
          </section>
          <section
            className={styles.panel}
            aria-labelledby={`${titleId}-panel`}
          >
            <div className={styles.panelHeader}>
              <span className={styles.seal} aria-hidden="true">
                <PutdukIcon name="shield" size={24} />
              </span>
              <h2 id={`${titleId}-panel`}>{panelTitle}</h2>
              <p>{panelDescription}</p>
            </div>
            {children}
            {footer ? <div className={styles.footer}>{footer}</div> : null}
          </section>
        </div>
        <footer className={styles.pageFooter}>
          <Link href="/">WORKROOM 홈</Link>
          <span aria-hidden="true">·</span>
          <Link href="/recover">계정 복구</Link>
        </footer>
      </div>
    </main>
  );
}
