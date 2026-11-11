import { WorkroomMark } from "../workroom/workroom-mark";
import styles from "./workroom-loading.module.css";

type WorkroomLoadingProps = {
  label?: string;
  variant?: "page" | "panel" | "inline";
  /** Set false only when the containing live region already announces it. */
  announce?: boolean;
};

/** Presentation only: mount for actual pending work; never delays its completion. */
export function WorkroomLoading({
  label = "화면을 불러오고 있어요",
  variant = "panel",
  announce = true,
}: WorkroomLoadingProps) {
  const live = {
    role: announce ? ("status" as const) : undefined,
    "aria-live": announce ? ("polite" as const) : undefined,
    "aria-atomic": announce ? true : undefined,
  };

  if (variant === "inline") {
    return (
      <span
        className={styles.inline}
        data-ui-state="loading"
        data-workroom-loading={variant}
        {...live}
      >
        <span
          className={styles.inlineMark}
          data-workroom-loading-mark=""
          aria-hidden="true"
        >
          <WorkroomMark size={22} />
        </span>
        <span>{label}</span>
      </span>
    );
  }

  return (
    <section
      className={`${styles.loading} ${styles[variant]}`}
      data-ui-state="loading"
      data-loading-variant={variant}
      data-workroom-loading={variant}
    >
      <div className={styles.identity} {...live}>
        <span className={styles.markFrame} aria-hidden="true">
          <span className={styles.halo} />
          <span className={styles.mark} data-workroom-loading-mark="">
            <WorkroomMark size={56} />
          </span>
        </span>
        <div className={styles.copy}>
          <span className={styles.brand} aria-hidden="true">
            WORKROOM
          </span>
          <span className={styles.label}>{label}</span>
        </div>
        <span className={styles.dots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className={styles.skeleton} aria-hidden="true">
        <div className={styles.summary}>
          <span className={styles.shortLine} />
          <span className={styles.headingLine} />
          <span className={styles.mediumLine} />
        </div>
        <div className={styles.cards}>
          {[0, 1, 2].map((index) => (
            <div className={styles.card} key={index}>
              <span className={styles.tile} />
              <span className={styles.mediumLine} />
              <span className={styles.line} />
              <span className={styles.shortLine} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
