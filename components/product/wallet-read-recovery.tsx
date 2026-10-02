"use client";

import { useRouter } from "next/navigation";

/** 읽기 실패 후 서버 읽기 모델을 다시 불러온다. 잔액은 바꾸지 않는다. */
export function WalletReadRecovery({
  label = "다시 시도",
}: {
  label?: string;
}) {
  const router = useRouter();

  return (
    <button
      className="button button--secondary"
      type="button"
      onClick={() => {
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
