export function assertNativeTap(text: string): number;
export function assertWorkroomLegacyReceipt(
  legacy: unknown,
  expectedLabels: string[],
  context: { head: string; containerId: string },
): void;
export function runWorkroomNativePhase(
  phase: "legacy" | "baseline" | "cutover",
  stage: string,
  principal?: "A" | "B" | "D" | "E" | null,
): unknown;
export function verifyWorkroomNativeComplete(stage: string): unknown;
