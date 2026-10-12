export type Frozen195Source = { path: string; sha256: string };
export type Native195Derivative = {
  sql: string;
  source: Frozen195Source;
  changes: Array<{
    name: string;
    before: string;
    after: string;
    beforeSha256: string;
    afterSha256: string;
    matches: number;
  }>;
  sha256: string;
  status: "AUTHORED_NOT_TESTED";
};
export const USDT_195_FROZEN_SOURCES: Readonly<
  Record<"principal" | "krw" | "concurrency", Frozen195Source>
>;
export function buildPrincipal195Fixture(
  source: Buffer | string,
  confirmation: { fullPayoutConfirmed: true },
): Native195Derivative;
export function buildKrw195Fixture(
  source: Buffer | string,
  confirmation: { fullPayoutConfirmed: true },
): Native195Derivative;
export function buildConcurrency195Fixture(
  source: Buffer | string,
  confirmation: { fullPayoutConfirmed: true },
): Native195Derivative;
export function buildApi195HeldFixture(
  source: Buffer | string,
  input: {
    fullPayoutConfirmed: true;
    memberId: string;
    adminId: string;
    destinationId: string;
    movementId: string;
  },
): string;
