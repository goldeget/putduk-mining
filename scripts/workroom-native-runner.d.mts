export function assertNativeTap(text: string): number;
export function runWorkroomNativePhase(
  phase: "baseline" | "cutover",
  stage: string,
  principal?: "A" | "B" | "D" | "E" | null,
): unknown;
export function verifyWorkroomNativeComplete(stage: string): unknown;
