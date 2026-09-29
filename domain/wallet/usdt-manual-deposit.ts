export type UsdtDepositNetwork = "TRC20" | "ERC20" | "BEP20";

export type UsdtDepositInstruction = {
  depositAddress: string;
  network: UsdtDepositNetwork;
};

const SENT_AMOUNT_PATTERN = /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,6})?$/;

export function isUsdtDepositNetwork(
  value: string,
): value is UsdtDepositNetwork {
  return value === "TRC20" || value === "ERC20" || value === "BEP20";
}

export function findUsdtDepositInstruction(
  instructions: readonly UsdtDepositInstruction[],
  network: string,
): UsdtDepositInstruction | null {
  return instructions.find((item) => item.network === network) ?? null;
}

/** 입력 중의 수량 문자열. 숫자와 점만 남긴다. 잘못된 점은 지우지 않는다. */
export function sanitizeUsdtSentAmountInput(raw: string): string {
  return raw.replace(/[^0-9.]/g, "").slice(0, 32);
}

/**
 * 제출용 수량. 앞자리 0을 정리하고, 0 이하·형식 오류는 null.
 * 부동소수점 연산은 하지 않는다.
 */
export function normalizeUsdtSentAmount(raw: string): string | null {
  const sanitized = sanitizeUsdtSentAmountInput(raw.trim());
  const parts = sanitized.split(".");
  if (parts.length > 2) {
    return null;
  }
  const [whole = "", fraction] = parts;
  if (!/^[0-9]+$/.test(whole)) {
    return null;
  }
  if (fraction !== undefined && !/^[0-9]{1,6}$/.test(fraction)) {
    return null;
  }
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalized =
    fraction === undefined ? normalizedWhole : `${normalizedWhole}.${fraction}`;
  if (!isPositiveUsdtSentAmount(normalized)) {
    return null;
  }
  return normalized;
}

export function isPositiveUsdtSentAmount(value: string): boolean {
  return SENT_AMOUNT_PATTERN.test(value) && /[1-9]/.test(value);
}

/** 화면 표시용. 원장 계산에 쓰지 않는다. */
export function formatSentUsdtDisplay(value: unknown): string {
  const raw =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" &&
          Number.isFinite(value) &&
          !/[eE]/.test(String(value))
        ? String(value)
        : null;
  if (!raw || !/^[0-9]+(?:\.[0-9]+)?$/.test(raw)) {
    return "수량 확인 중";
  }
  const [whole = "", fraction = ""] = raw.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  return trimmedFraction
    ? `${normalizedWhole}.${trimmedFraction}`
    : normalizedWhole;
}

export function assertManualUsdtDepositSnapshots(input: {
  depositAddressSnapshot: string;
  networkSnapshot: string;
}): void {
  if (!input.depositAddressSnapshot.trim() || !input.networkSnapshot.trim()) {
    throw new Error("USDT_DEPOSIT_SNAPSHOT_REQUIRED");
  }
}
