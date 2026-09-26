"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const SYNC_INTERVAL_MS = 60_000;

export function TrialSynchronizer({ active }: { active: boolean }) {
  const router = useRouter();
  const inFlight = useRef(false);

  const synchronize = useCallback(async () => {
    if (!active || document.visibilityState !== "visible" || inFlight.current) {
      return;
    }

    inFlight.current = true;
    try {
      const response = await fetch("/api/v1/trial/settle", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      if (response.ok) {
        router.refresh();
      }
    } catch {
      // The next visibility or interval sync safely retries with a new key.
    } finally {
      inFlight.current = false;
    }
  }, [active, router]);

  useEffect(() => {
    if (!active) {
      return;
    }

    void synchronize();
    const interval = window.setInterval(
      () => void synchronize(),
      SYNC_INTERVAL_MS,
    );
    const handleVisibility = () => void synchronize();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [active, synchronize]);

  return null;
}
