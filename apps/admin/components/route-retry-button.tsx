"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RouteRetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="ghost-button"
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "다시 불러오는 중…" : "다시 불러오기"}
    </button>
  );
}
