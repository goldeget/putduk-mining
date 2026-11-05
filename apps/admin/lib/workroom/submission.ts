export type ReviewedSubmission = {
  key: string;
  operation: string;
  input: Record<string, unknown>;
  signature: string;
};
export function reviewedSubmission(
  previous: ReviewedSubmission | null,
  operation: string,
  input: Record<string, unknown>,
  uuid: () => string = () => crypto.randomUUID(),
): ReviewedSubmission {
  const signature = JSON.stringify({ operation, input });
  if (previous) {
    if (previous.signature !== signature)
      throw new Error("UNRESOLVED_SUBMISSION");
    return previous;
  }
  return { key: uuid(), operation, input: structuredClone(input), signature };
}
