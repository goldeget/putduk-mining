"use client";

import { WithdrawalQueueError } from "./_components/queue-states";

export default function WithdrawalsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <WithdrawalQueueError
      description="인터넷 연결을 확인한 뒤 다시 불러오세요. 이미 기록된 송금과 원장에는 영향이 없습니다."
      onRetry={reset}
      title="출금 대기열을 열지 못했습니다"
    />
  );
}
