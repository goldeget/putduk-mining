import styles from "./economy.module.css";

export default function EconomyLoading() {
  return (
    <section
      className={styles.root}
      aria-busy="true"
      aria-label="채굴 정책 불러오는 중"
    >
      <h1>채굴 정책</h1>
      <p role="status">저장된 정책과 검토 기록을 확인하고 있습니다.</p>
      <div className={styles.skeleton} aria-hidden="true" />
      <div className={styles.skeleton} aria-hidden="true" />
    </section>
  );
}
