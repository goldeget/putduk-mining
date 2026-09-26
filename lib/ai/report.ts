export type AiUsageRecord = {
  cached_input_tokens: number;
  input_tokens: number;
  output_tokens: number;
};

export type AiUsageReport = {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
};

// Reports are read-only projections. They never issue provider or asset commands.
export function createAiUsageReport(
  records: readonly AiUsageRecord[],
): AiUsageReport {
  return records.reduce<AiUsageReport>(
    (report, record) => ({
      cachedInputTokens: report.cachedInputTokens + record.cached_input_tokens,
      inputTokens: report.inputTokens + record.input_tokens,
      outputTokens: report.outputTokens + record.output_tokens,
      requestCount: report.requestCount + 1,
    }),
    {
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      requestCount: 0,
    },
  );
}
