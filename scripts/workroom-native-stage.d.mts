export const WORKROOM_MIGRATION: string;
export function buildWorkroomNativeFiles(root?: string): Array<{
  path: string;
  baseline: string;
  successor: string;
  sourceSha256: string;
  baselineSha256: string;
  successorSha256: string;
}>;
export function prepareWorkroomNativeStage(
  output: string,
  profile?: "ci" | "local",
): {
  kind: string;
  state: string;
  profile: string;
  head: string;
  files: unknown[];
};
