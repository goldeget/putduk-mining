export default function AssistantLoading() {
  return (
    <div role="status" aria-label="운영 도우미 불러오기">
      <h1>운영 도우미</h1>
      <p>입금 신청을 불러오고 있어요.</p>
      <div className={styles.workspace} aria-hidden="true">
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
    </div>
  );
}
import styles from "@/components/assistant/assistant.module.css";
