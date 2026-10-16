import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function validDate(value) {
  assert.match(
    value,
    /^\d{4}-\d{2}-\d{2}$/,
    "Compatibility date must be ISO UTC",
  );
  const date = new Date(`${value}T00:00:00Z`);
  assert.ok(Number.isFinite(date.valueOf()), "Compatibility date is invalid");
  assert.equal(
    date.toISOString().slice(0, 10),
    value,
    "Compatibility date is invalid",
  );
  return value;
}

function configuredDate(source, path) {
  let normalized = "";
  let keys = 0;
  for (let index = 0; index < source.length;) {
    const char = source[index];
    if (char === '"') {
      const start = index++;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index++] === '"') {
          closed = true;
          break;
        }
      }
      assert.ok(closed, `${path}: unterminated configuration string`);
      const token = source.slice(start, index);
      if (source.slice(index).trimStart().startsWith(":"))
        keys += Number(JSON.parse(token) === "compatibility_date");
      normalized += token;
      continue;
    }
    // Keep this small pre-install parser conservative: reviewed configs allow
    // trailing commas but no comments. Only the actual root date is accepted.
    assert.ok(
      !(char === "/" && ["/", "*"].includes(source[index + 1])),
      `${path}: configuration comments are not permitted by the date guard`,
    );
    if (!(char === "," && /^[\s]*[}\]]/.test(source.slice(index + 1))))
      normalized += char;
    index += 1;
  }
  const config = JSON.parse(normalized);
  assert.equal(keys, 1, `${path}: exactly one compatibility date required`);
  assert.ok(
    config &&
      typeof config === "object" &&
      !Array.isArray(config) &&
      Object.hasOwn(config, "compatibility_date"),
    `${path}: root compatibility date required`,
  );
  return config.compatibility_date;
}

export function assertCompatibilityDates({
  configs,
  workerdVersions,
  now = new Date(),
}) {
  assert.ok(configs.length > 0, "No Worker configurations supplied");
  const versions = [...new Set(workerdVersions)];
  assert.equal(
    versions.length,
    1,
    "Exactly one pinned workerd runtime is required",
  );
  const match = /^1\.(\d{4})(\d{2})(\d{2})\.\d+$/.exec(versions[0]);
  assert.ok(match, "Pinned workerd version must contain its release date");
  const runtimeDate = validDate(`${match[1]}-${match[2]}-${match[3]}`);
  assert.ok(Number.isFinite(now.valueOf()), "Current UTC time is invalid");
  const utcDate = now.toISOString().slice(0, 10);
  const dates = configs.map(({ path, source }) => {
    const date = validDate(configuredDate(source, path));
    assert.ok(
      date <= utcDate,
      `${path}: compatibility date is in the future in UTC`,
    );
    assert.ok(
      date <= runtimeDate,
      `${path}: compatibility date exceeds pinned workerd support`,
    );
    return { path, date };
  });
  return { workerdVersion: versions[0], runtimeDate, utcDate, dates };
}

export function inspectCompatibilityDates(root, now = new Date()) {
  const lock = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
  const workerdVersions = [
    ...lock.matchAll(/^\s{2}['"]?workerd@(1\.\d{8}\.\d+)['"]?:\s*$/gm),
  ].map((match) => match[1]);
  const configs = ["wrangler.jsonc", "apps/admin/wrangler.jsonc"].map(
    (path) => ({
      path,
      source: readFileSync(resolve(root, path), "utf8"),
    }),
  );
  return assertCompatibilityDates({ configs, workerdVersions, now });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  console.log(JSON.stringify(inspectCompatibilityDates(root)));
}
