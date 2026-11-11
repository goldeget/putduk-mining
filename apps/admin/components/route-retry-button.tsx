"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { WorkroomLoading } from "../../../components/ui/workroom-loading";

export function RouteRetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="ghost-button"
      type="button"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? (
        <WorkroomLoading label="다시 불러오는 중…" variant="inline" />
      ) : (
        "다시 불러오기"
      )}
    </button>
  );
}
