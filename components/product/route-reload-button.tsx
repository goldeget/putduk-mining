"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { PutdukIcon } from "@/components/icons/putduk-icon";

/** 서버 스냅샷을 다시 읽어 오는 복구 버튼. 금액·자격을 계산하지 않는다. */
export function RouteReloadButton({
  className = "button button--primary",
  label = "다시 확인",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      className={className}
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
    >
      {pending ? "확인 중" : label}
      <PutdukIcon name="arrow-right" size={18} />
    </button>
  );
}
