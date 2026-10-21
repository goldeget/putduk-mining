export function qaValues(
  key: string | undefined,
  role: "member" | "admin",
): Record<string, string>;
export const TARGETS: Readonly<
  Record<
    "member" | "admin",
    { name: string; directory: string; accessId: string; workerId: string }
  >
>;
