"use client";

import { useEffect } from "react";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
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
    <div className={styles.routeState}>
      <section className={styles.routeStateCard} role="alert">
        <PutdukIcon name="shield" size={34} />
        <h1>{title}</h1>
        <p>{description}</p>
        <button
          className="button button--primary"
          type="button"
          onClick={reset}
        >
          다시 시도
          <PutdukIcon name="arrow-right" size={18} />
        </button>
      </section>
    </div>
  );
}
