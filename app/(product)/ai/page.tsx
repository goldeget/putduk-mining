import PutdukAiPage from "@/app/(product)/menu/ai/page";
import styles from "@/app/(product)/menu/ai/page.module.css";

export default function AiAliasPage() {
  return (
    <div className={styles.alias} data-ui-ready="/ai" data-ui-state="loaded">
      <PutdukAiPage />
    </div>
  );
}
