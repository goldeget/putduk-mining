export type ConfirmedWelcomeConversion = {
  id: string;
  status: "CONVERTED";
  converted_amount_atomic: number | string | null;
  was_created: boolean;
};

export const welcomeConversionWaitLimitMs = 15_000;

/** Stop waiting locally; an aborted request may already have been accepted. */
export function waitForWelcomeConversionResult<T>(
  result: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () =>
      reject(new DOMException("Conversion result unavailable", "AbortError"));
    const pending = Promise.resolve(result);
    if (signal.aborted) {
      void pending.catch(() => undefined);
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Validate the existing API result, without computing eligibility or money. */
export function readWelcomeConversionSuccess(
  payload: unknown,
): ConfirmedWelcomeConversion | null {
  const envelope = record(payload);
  if (!envelope || envelope.error !== undefined) return null;
  const conversion = record(record(envelope.data)?.conversion);
  if (
    !conversion ||
    typeof conversion.id !== "string" ||
    !uuidPattern.test(conversion.id) ||
    conversion.status !== "CONVERTED" ||
    typeof conversion.was_created !== "boolean"
  )
    return null;

  // The existing adapter explicitly emits null when RPC amount is absent.
  const amount = conversion.converted_amount_atomic;
  if (!(
    amount === null ||
    (typeof amount === "string" && /^\d+$/.test(amount)) ||
    (typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0)
  ))
    return null;

  return {
    id: conversion.id,
    status: "CONVERTED",
    converted_amount_atomic: amount,
    was_created: conversion.was_created,
  };
}

const businessRejectionCopy: Readonly<Record<string, string>> = {
  WELCOME_REWARD_KYC_REQUIRED:
    "실명 확인을 완료하면 환영 보상을 전환할 수 있습니다.",
  WELCOME_REWARD_RISK_REVIEW_REQUIRED:
    "안전 확인이 필요해 보상 전환을 검토하고 있습니다.",
  TRIAL_NOT_COMPLETED: "PUTDUK START를 완료한 뒤 다시 시도해 주세요.",
  WELCOME_REWARD_AMOUNT_UNAVAILABLE: "환영 보상을 전환하지 못했습니다.",
};

/** Only the existing 409 business rejections prove that this command was rejected. */
export function readWelcomeConversionRejection(
  status: number,
  payload: unknown,
): string | null {
  if (status !== 409) return null;
  const envelope = record(payload);
  if (
    !envelope ||
    Object.keys(envelope).length !== 1 ||
    !Object.hasOwn(envelope, "error")
  )
    return null;
  const error = record(envelope.error);
  if (
    !error ||
    Object.keys(error).length !== 2 ||
    !Object.hasOwn(error, "code") ||
    !Object.hasOwn(error, "message") ||
    typeof error.code !== "string" ||
    !Object.hasOwn(businessRejectionCopy, error.code) ||
    typeof error.message !== "string" ||
    !error.message.trim()
  )
    return null;
  return businessRejectionCopy[error.code] ?? null;
}
