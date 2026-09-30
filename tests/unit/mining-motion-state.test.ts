import { expect, it } from "vitest";
import {
  isConfirmedMiningRunning,
  presentMiningStatus,
} from "../../lib/product/mining-display";

it("running presentation uses the mining snapshot status contract", () => {
  for (const status of ["NORMAL", "REDUCED"])
    expect(isConfirmedMiningRunning(status)).toBe(true);
  for (const status of [
    "MAINTENANCE",
    "PARTIAL_STOP",
    "STOPPED",
    "ACTIVE",
    "NEW_STATUS",
    null,
    undefined,
  ])
    expect(isConfirmedMiningRunning(status)).toBe(false);
  expect(presentMiningStatus("STOPPED").label).toBe("중지");
});
