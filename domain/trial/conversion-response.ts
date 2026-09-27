export type TrialConversionRpcRow = {
  conversion_id: string;
  converted_amount_atomic: number | string;
  ledger_transaction_id: string | null;
  was_created: boolean;
};

export function toWelcomeConversionResult(row: TrialConversionRpcRow | null) {
  if (!row) {
    return null;
  }

  return {
    converted_amount_atomic: row.converted_amount_atomic,
    id: row.conversion_id,
    status: "CONVERTED" as const,
    was_created: row.was_created,
  };
}
