import { describe, expect, it } from "vitest";

import {
  normalizeTrialConversionRpcData,
  toWelcomeConversionResult,
} from "@/domain/trial/conversion-response";

describe("welcome conversion API response", () => {
  it("maps the service RPC identifier to the product-facing id", () => {
    expect(
      toWelcomeConversionResult({
        conversion_id: "d092731d-ca0e-4976-8de4-88a5034a429a",
        converted_amount_atomic: 5000,
        ledger_transaction_id: "62b680f9-1415-454d-af79-90e792d4d027",
        was_created: true,
      }),
    ).toEqual({
      converted_amount_atomic: 5000,
      id: "d092731d-ca0e-4976-8de4-88a5034a429a",
      status: "CONVERTED",
      was_created: true,
    });
  });

  it("does not invent a conversion when the command returns no row", () => {
    expect(toWelcomeConversionResult(null)).toBeNull();
  });

  it("normalizes array and object RPC payloads the same way", () => {
    const row = {
      conversion_id: "d092731d-ca0e-4976-8de4-88a5034a429a",
      converted_amount_atomic: 5000,
      ledger_transaction_id: null,
      was_created: false,
    };
    expect(normalizeTrialConversionRpcData([row])).toEqual(row);
    expect(normalizeTrialConversionRpcData(row)).toEqual(row);
    expect(normalizeTrialConversionRpcData([])).toBeNull();
  });
});
