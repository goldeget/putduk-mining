"use client";

import { useEffect } from "react";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "./route-feedback.module.css";
import { WorkroomLoading } from "../ui/workroom-loading";

export function ProductRouteLoading({ label }: { label: string }) {
  return <WorkroomLoading label={label} />;
}

export function ProductRouteError({
  description,
  error,
  reset,
  title,
}: {
  description: string;
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={styles.page}>
      <section className={styles.card} role="alert">
        <span className={styles.mark} aria-hidden="true">
          <PutdukIcon name="shield" size={24} />
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
        <button className={styles.action} type="button" onClick={reset}>
          다시 시도
          <PutdukIcon name="arrow-right" size={18} />
        </button>
      </section>
    </div>
  );
}
