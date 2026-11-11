"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { WorkroomLoading } from "../../../../components/ui/workroom-loading";

import styles from "./today.module.css";

/** 조회 실패 후 같은 화면을 다시 불러온다. */
export function TodayRefreshButton({
  label = "다시 불러오기",
}: {
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={styles.refreshButton}
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
    >
      {pending ? (
        <WorkroomLoading label="불러오는 중…" variant="inline" />
      ) : (
        label
      )}
    </button>
  );
}
