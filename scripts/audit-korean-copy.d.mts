export type KoreanCopyFinding = {
  path: string;
  line: number;
  code: string;
  severity: "error" | "review";
  text: string;
};
export function auditKoreanCopySource(
  source: string,
  path?: string,
): {
  koreanLiterals: number;
  findings: KoreanCopyFinding[];
};
export function auditKoreanCopyFiles(
  files: { path: string; source: string }[],
): {
  sources: number;
  koreanLiterals: number;
  errors: KoreanCopyFinding[];
  reviews: KoreanCopyFinding[];
  scope: string;
};
