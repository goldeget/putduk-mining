export type TrialConversionRpcRow = {
  conversion_id?: string;
  converted_amount_atomic?: number | string | null;
  ledger_transaction_id?: string | null;
  was_created?: boolean;
};

/** PostgREST TABLE 행 또는 단일 객체·배열을 환영 전환 결과로 정규화한다. */
export function normalizeTrialConversionRpcData(
  data: unknown,
): TrialConversionRpcRow | null {
  if (data == null) return null;
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === "object"
      ? (first as TrialConversionRpcRow)
      : null;
  }
  if (typeof data === "object") {
    return data as TrialConversionRpcRow;
  }
  return null;
}

export function toWelcomeConversionResult(row: TrialConversionRpcRow | null) {
  if (!row?.conversion_id) {
    return null;
  }

  return {
    converted_amount_atomic: row.converted_amount_atomic ?? null,
    id: row.conversion_id,
    status: "CONVERTED" as const,
    was_created: Boolean(row.was_created),
  };
}
