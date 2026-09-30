"use client";

import Link from "next/link";
import type { Route } from "next";

import styles from "./members.module.css";

export default function MembersError({
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  retry?: () => void;
}) {
  return (
    <div className={styles.errorPanel} role="alert" data-ui-state="error">
      <h1>회원 화면을 열지 못했습니다.</h1>
      <p>
        입력한 식별자는 유지됩니다. 잠시 후 다시 시도하거나 조회 화면으로 돌아가
        주세요.
      </p>
      <div className={styles.errorActions}>
        <button
          className="gold-button"
          type="button"
          onClick={retry ?? reset}
          disabled={!retry && !reset}
        >
          다시 시도
        </button>
        <Link className="text-link" href={"/members" as Route}>
          조회 화면
        </Link>
      </div>
    </div>
  );
}
