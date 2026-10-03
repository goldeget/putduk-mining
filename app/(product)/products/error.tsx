"use client";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/published-catalog-view.module.css";

export default function ProductsError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className={styles.page} data-ui-state="error">
      <header className={styles.pageHeading}>
        <h1>상품</h1>
      </header>
      <section className={styles.recovery} role="alert">
        <p className={styles.eyebrow}>상품 다시 확인</p>
        <h2>상품 화면을 열지 못했어요</h2>
        <p>잠시 후 다시 확인해 주세요.</p>
        <button
          className="button button--primary"
          type="button"
          onClick={retry}
        >
          다시 확인
          <PutdukIcon name="arrow-right" size={18} />
        </button>
      </section>
    </div>
  );
}
