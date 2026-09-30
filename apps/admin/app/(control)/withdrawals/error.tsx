"use client";

import { WithdrawalQueueError } from "./_components/queue-states";

export default function WithdrawalsError({
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  retry?: () => void;
}) {
  return (
    <WithdrawalQueueError
      description="인터넷 연결을 확인한 뒤 다시 불러오세요. 이미 기록된 송금과 원장에는 영향이 없습니다."
      onRetry={retry ?? reset ?? (() => window.location.reload())}
      title="출금 대기열을 열지 못했습니다"
    />
  );
}
