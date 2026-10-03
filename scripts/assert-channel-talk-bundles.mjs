/**
 * 프로덕션 빌드 결과에서 Channel Talk 경계를 확인한다.
 * 관리자 번들에 channel 출처가 없고, 공개 클라이언트 번들에 Member Hash secret 이름이 없다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNextDistDir } from "./resolve-next-dist-dir.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const adminRoot = join(root, "apps", "admin");
const adminBuild = join(adminRoot, resolveNextDistDir(adminRoot));
const publicClient = join(root, resolveNextDistDir(root), "static");

const adminForbidden = [
  "@channel.io",
  "CHANNEL_TALK_MEMBER_HASH_SECRET",
  "cdninstagram.com",
  "channel.app",
  "channel.io",
  "createChannelMemberHash",
  "sentry-cdn.com",
  "sentry.io",
];

const clientForbidden = [
  "CHANNEL_TALK_MEMBER_HASH_SECRET",
  "createChannelMemberHash",
];

function walk(directory, files) {
  for (const entry of readdirSync(directory)) {
    if (entry === "cache") continue;
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      walk(path, files);
      continue;
    }
    if (path.endsWith(".map")) continue;
    if (!/\.(css|html|js|mjs)$/.test(path)) continue;
    files.push(path);
  }
}

function findToken(files, tokens) {
  const hits = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const token of tokens) {
      if (source.includes(token)) {
        hits.push(`${relative(process.cwd(), file)} → ${token}`);
      }
    }
  }
  return hits;
}

const adminFiles = [];
const clientFiles = [];
walk(adminBuild, adminFiles);
walk(publicClient, clientFiles);

if (adminFiles.length === 0 || clientFiles.length === 0) {
  throw new Error(
    "프로덕션 번들이 없습니다. pnpm build:web와 pnpm build:admin 다음에 실행합니다.",
  );
}

const problems = [
  ...findToken(adminFiles, adminForbidden),
  ...findToken(clientFiles, clientForbidden),
];

if (problems.length > 0) {
  throw new Error(
    `Channel Talk 번들 경계가 깨졌습니다.\n${problems.join("\n")}`,
  );
}

process.stdout.write(
  `channel talk bundles ok admin=${adminFiles.length} client=${clientFiles.length}\n`,
);
