import styles from "./members.module.css";

export default function MembersLoading() {
  return (
    <div
      className={styles.loadingShell}
      aria-busy="true"
      aria-live="polite"
      data-ui-state="loading"
    >
      <p className={styles.loadingLabel}>회원 정보를 불러오는 중</p>
      <div className={styles.loadingBlock} />
      <div className={`${styles.loadingBlock} ${styles.loadingBlockWide}`} />
      <div className={styles.loadingBlock} />
    </div>
  );
}
