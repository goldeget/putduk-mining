import {
  validateWithdrawalLogicalRequest,
  WithdrawalLogicalSafetyError,
  type PersistedWithdrawalLogicalRequest,
} from "./withdrawal-logical-request";

export type PrincipalWithdrawalLogicalRequest = Readonly<
  Omit<PersistedWithdrawalLogicalRequest, "v"> & {
    v: 3;
    source: Readonly<{
      version: 1;
      kind: "PRINCIPAL";
      confirmationId: string;
    }>;
  }
>;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Source is immutable server evidence, never a browser amount or default. */
export function validatePrincipalWithdrawalLogicalRequest(
  value: unknown,
  ownerId: string,
): PrincipalWithdrawalLogicalRequest {
  const unsafe = (): never => {
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  };
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return unsafe();
  const record = value as Record<string, unknown>;
  const source = record.source;
  if (
    record.v !== 3 ||
    !source ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    Object.getPrototypeOf(source) !== Object.prototype
  )
    return unsafe();
  const original = source as Record<string, unknown>;
  if (
    Object.keys(original).length !== 3 ||
    !["version", "kind", "confirmationId"].every((key) =>
      Object.hasOwn(original, key),
    ) ||
    original.version !== 1 ||
    original.kind !== "PRINCIPAL" ||
    typeof original.confirmationId !== "string" ||
    !UUID.test(original.confirmationId)
  )
    return unsafe();
  // Reuse every existing amount/owner/key/date/state guard. Only the explicit
  // version and new source envelope differ; extra top-level fields still fail.
  const existing = { ...record };
  delete existing.source;
  const checked = validateWithdrawalLogicalRequest(
    { ...existing, v: 2 },
    ownerId,
  );
  if (!checked.destinationId || checked.state === "PREPARED") return unsafe();
  return Object.freeze({
    ...checked,
    v: 3,
    source: Object.freeze({
      version: 1,
      kind: "PRINCIPAL",
      confirmationId: original.confirmationId,
    }),
  });
}
