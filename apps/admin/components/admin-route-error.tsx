"use client";

import Link from "next/link";

export function AdminRouteError({
  retry,
  reset,
}: {
  retry?: (() => void) | undefined;
  reset?: (() => void) | undefined;
}) {
  return (
    <section className="queue-empty" data-ui-state="error" role="alert">
      <h1>운영 화면을 확인하지 못했습니다.</h1>
      <p>
        연결과 로그인 상태를 확인해 주세요. 확인되지 않은 정보로 작업을 진행하지
        마세요.
      </p>
      <button
        className="gold-button"
        type="button"
        onClick={retry ?? reset}
        disabled={!retry && !reset}
      >
        다시 불러오기
      </button>
      <Link className="text-link" href="/login">
        로그인 상태 확인
      </Link>
    </section>
  );
}
