"use client";

import { createContext, useContext, useState } from "react";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";

const ReviewFeedback = createContext<
  ((result: CommandActionResult | null) => void) | null
>(null);

/** Keep the confirmed result visible when a reviewed card leaves the queue. */
export function KycReviewFeedback({ children }: { children: React.ReactNode }) {
  const [result, setResult] = useState<CommandActionResult | null>(null);
  return (
    <ReviewFeedback.Provider value={setResult}>
      {result?.ok ? (
        <p
          aria-label="본인 확인 검토 결과"
          className="queue-flash queue-flash--ok"
          role="status"
        >
          {result.message}
        </p>
      ) : null}
      {children}
    </ReviewFeedback.Provider>
  );
}

export function useKycReviewFeedback() {
  return useContext(ReviewFeedback);
}
