"use client";

import { useState } from "react";

import { createLogicalOperationKey } from "@/lib/money/logical-operation";

const OFFLINE_COPY =
  "연결이 끊겼습니다. 다시 연결된 뒤 직접 눌러 주세요. 자동으로 보내지 않습니다.";

export function useLogicalOperationKey(prefix: string): string {
  const [key] = useState(() => createLogicalOperationKey(prefix));
  return key;
}

/** 끊김이면 제출을 막고, 재연결 때 자동으로 보내지 않는다. */
export function bindMoneyFormSubmit(
  event: React.FormEvent<HTMLFormElement>,
  onBlocked: (message: string) => void,
): void {
  const online = navigator.onLine;
  const field = event.currentTarget.elements.namedItem("clientOnline");
  if (field instanceof HTMLInputElement) field.value = online ? "1" : "0";
  if (!online) {
    event.preventDefault();
    onBlocked(OFFLINE_COPY);
  }
}

export function MoneyOperationFields({
  operationKey,
}: {
  operationKey: string;
}) {
  return (
    <>
      <input name="idempotencyKey" type="hidden" value={operationKey} />
      <input name="clientOnline" type="hidden" defaultValue="1" />
    </>
  );
}

export function MoneyOfflineNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="queue-flash" role="status">
      {message}
    </p>
  );
}
