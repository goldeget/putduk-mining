import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_MINING_PHRASES,
  findForbiddenMiningPhrases,
} from "@/tests/helpers/mining-language-gate";

const root = process.cwd();

const SCAN_ROOTS = [
  "app",
  "components/product",
  "lib/trust/public-content.ts",
  "tests/fixtures/ai",
] as const;

const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".txt",
]);

type SourceHit = {
  file: string;
  phrase: string;
  line: number;
  excerpt: string;
};

function isScannableFile(filePath: string) {
  const lower = filePath.toLowerCase();
  for (const ext of SCAN_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function collectFiles(target: string): string[] {
  const absolute = join(root, target);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return [];
  }

  if (stats.isFile()) {
    return isScannableFile(absolute) ? [absolute] : [];
  }

  const files: string[] = [];
  const stack = [absolute];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current)) {
      const child = join(current, entry);
      const childStats = statSync(child);
      if (childStats.isDirectory()) {
        if (
          entry === "node_modules" ||
          entry === ".next" ||
          entry === "dist" ||
          entry === "coverage"
        ) {
          continue;
        }
        stack.push(child);
        continue;
      }
      if (isScannableFile(child)) {
        files.push(child);
      }
    }
  }
  return files;
}

function toPosix(pathValue: string) {
  return pathValue.split(sep).join("/");
}

function scanUserFacingSources(): SourceHit[] {
  const files = SCAN_ROOTS.flatMap((target) => collectFiles(target));
  const hits: SourceHit[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const relativePath = toPosix(relative(root, file));
    const lines = source.split(/\r?\n/);

    for (const phrase of FORBIDDEN_MINING_PHRASES) {
      let cursor = 0;
      while (cursor < source.length) {
        const index = source.indexOf(phrase, cursor);
        if (index === -1) {
          break;
        }
        const line = source.slice(0, index).split(/\r?\n/).length;
        const excerpt = (lines[line - 1] ?? "").trim().slice(0, 160);
        hits.push({
          file: relativePath,
          phrase,
          line,
          excerpt,
        });
        cursor = index + phrase.length;
      }
    }
  }

  return hits;
}

describe("user-facing mining language gate", () => {
  it("rejects internal or simulated mining wording in user-facing sources", () => {
    const hits = scanUserFacingSources();
    const summary = hits
      .map((hit) => `${hit.file}:${hit.line} [${hit.phrase}] ${hit.excerpt}`)
      .join("\n");

    expect(
      hits,
      hits.length === 0
        ? "no forbidden mining phrases"
        : `금지 채굴 표현이 사용자 노출 소스에 남아 있습니다 (${hits.length}건):\n${summary}`,
    ).toEqual([]);
  });

  it("keeps the forbidden phrase list non-empty and exact", () => {
    expect(FORBIDDEN_MINING_PHRASES).toEqual([
      "가상 채굴",
      "가상 채굴 플랫폼",
      "내부 규칙 기반 채굴",
      "내부 규칙으로 운영되는 채굴",
      "실제 채굴이 아님",
      "시뮬레이션 채굴",
      "모의 채굴",
      "가짜 채굴",
      "deterministic mining",
    ]);
    expect(findForbiddenMiningPhrases("가상 채굴 플랫폼")).toHaveLength(2);
  });
});
