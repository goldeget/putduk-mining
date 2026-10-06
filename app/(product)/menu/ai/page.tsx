import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukAiChat } from "@/components/product/putduk-ai-chat";
import Link from "next/link";
import styles from "./page.module.css";

export default function PutdukAiPage() {
  return (
    <section className={styles.page} data-ai-page>
      <header className={styles.header}>
        <div className={styles.identity}>
          <BrandMark title="" />
          <h1>퍼뜩 AI</h1>
        </div>
        <Link className={styles.close} href="/menu" aria-label="AI 화면 닫기">
          닫기
        </Link>
        <details className={styles.principles}>
          <summary>답변 범위</summary>
          <div>
            <p>내 기록과 퍼뜩 이용 안내를 확인해요.</p>
            <p>송금·승인·잔액 변경은 퍼뜩 AI가 직접 실행하지 않아요.</p>
            <p>확인할 수 없는 내용은 추측하지 않아요.</p>
          </div>
        </details>
      </header>
      <PutdukAiChat presentation="page" surface="page" />
    </section>
  );
}
