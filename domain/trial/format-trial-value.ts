const trialValuePattern = /^(0|[1-9][0-9]*)$/;
const formatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
  useGrouping: true,
});

/**
 * Trial output is an internal, non-monetary experience unit. It must never be
 * formatted with a real currency before an approved conversion is committed.
 */
export function formatTrialValue(value: string) {
  if (!trialValuePattern.test(value)) {
    throw new Error("INVALID_TRIAL_VALUE");
  }

  return `${formatter.format(BigInt(value))} 체험 단위`;
}
