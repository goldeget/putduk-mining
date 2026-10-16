import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertBackend197CanonicalSources,
  assertBackend197LocalSources,
} from "./backend-successor-197-source.mjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PINS = {
  "scripts/ci-authenticated-shards.d.mts":
    "e377f11a96a91d45c2cf3b3c62f18902684ec1816f9ae30c3fdaaf71d939695d",
  "tests/unit/ci-authenticated-execution-197.test.ts":
    "8f52749085d36cf57dfb0c2889edbe21e253d9cfc7496bf77e91ed6c3dda9261",
  "scripts/ci-authenticated-shards.mjs":
    "c956696b96bc6b5670000917f512ac15dbd503018a85c39aeea5d8e36bc2b24c",
  "tests/e2e/authenticated/helpers/principal-canonical-193-fixture.ts":
    "a1a9b84169a25514fdf63fe724556e67c2696360aa098f73c84fbb3e694107d9",
  "tests/unit/backend-http-193-consumer.test.ts":
    "c01fb349a7feadaeaa287c3a3d67b8be34ec66fc2cd061c11fcf32c30ed7b9fb",
  "playwright.backend-browser-197.config.ts":
    "2963f4a9b9100a89ef6c36a61eb775bcf1016ab5c1e23b2d91854186ff372309",
  "scripts/backend-successor-197-browser-source.d.mts":
    "1d73c137b3bb9a6c653b52a70c2acc834b3c4d657e69854dbeb9b45abc842063",
  "vitest.config.ts":
    "6e02b56397cb0934cd213278aa91f3583450052eef5a42a42b8a34464b80b1f6",
  "scripts/backend-successor-197-unit-fixture.mjs":
    "21f830e90d471a24a7b92bc4b2a59300fb285a3979b66a5c68a8d76e6196020a",
  "scripts/backend-successor-197-unit-fixture.d.mts":
    "1b31aa36dde67b1a5435f9ce387b2a6b6cb8f4f1ad4e62f0009412836e44ace3",
  "tests/unit/backend-successor-197-unit-fixture.test.ts":
    "16c47eff692ba0aac590ffdfd78803d84684b7f915dc6a1928fb1c6b828df196",
  "tests/unit/backend-successor-197-browser-source.test.ts":
    "05e1151bbe4ab42cc189dd01b53f7fb9db9d5cce0f36ca71e12c164d129b8287",
};
function reviewed(root, local) {
  const base = realpathSync(root);
  const boundary = local
    ? assertBackend197LocalSources(base)
    : assertBackend197CanonicalSources(base);
  for (const [name, expected] of Object.entries(PINS)) {
    let file;
    try {
      file = realpathSync(resolve(base, name));
    } catch {
      throw Error("BACKEND197_BROWSER_SOURCE_MISSING");
    }
    const loc = relative(base, file);
    if (
      !loc ||
      isAbsolute(loc) ||
      loc === ".." ||
      loc.startsWith("../") ||
      loc.startsWith("..\\")
    )
      throw Error("BACKEND197_BROWSER_PATH_REJECTED");
    if (
      createHash("sha256").update(readFileSync(file)).digest("hex") !== expected
    )
      throw Error("BACKEND197_BROWSER_SOURCE_CHANGED");
  }
  return Object.freeze({
    ...boundary,
    browserConsumerSources: Object.keys(PINS).length,
    browserConsumerHashes: Object.freeze({ ...PINS }),
  });
}
export function assertBackend197BrowserCanonicalSources(root = ROOT) {
  if (arguments.length > 1)
    throw Error("BACKEND197_BROWSER_CALLER_OPTIONS_REJECTED");
  return reviewed(root, false);
}
export function assertBackend197BrowserLocalSources(root = ROOT) {
  if (arguments.length > 1)
    throw Error("BACKEND197_BROWSER_CALLER_OPTIONS_REJECTED");
  return reviewed(root, true);
}
