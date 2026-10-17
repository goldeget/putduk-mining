import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// This probe creates only isolated local test security events. Refuse remote
// targets before reading credentials or constructing a network client.
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid");
const config = readFileSync(
  new URL("../supabase/config.toml", import.meta.url),
  "utf8",
);
const project = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
const api = config.split(/^\[api\][ \t]*\r?$/m)[1]?.split(/^\[/m)[0];
const port = api?.match(/^port\s*=\s*([0-9]+)\s*$/m)?.[1];
assert.ok(
  ["development", "test"].includes(process.env.APP_ENV ?? "") &&
    project &&
    /^putduk-mining(?:-[a-z0-9-]+)?$/.test(project) &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    url.port === port &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    ["", "/"].includes(url.pathname),
  "Admin auth concurrency probe requires this checkout's isolated loopback API",
);
const secretKey = process.env.SUPABASE_SECRET_KEY;
assert.ok(secretKey, "Local service credential is required");
const db = createClient(url.href, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []),
          AbortSignal.timeout(10_000),
        ]),
      }),
  },
});
const bucket = createHash("sha256")
  .update(`putduk-admin-auth-probe:${randomUUID()}`)
  .digest("hex");
const seeded = await db.from("security_events").insert(
  Array.from({ length: 4 }, () => ({
    event_type: "ADMIN_AUTH_FAILURE",
    ip_source: "NONE",
    request_id: randomUUID(),
    device_context: { surface: "admin_auth_failure", scope: "TOTP", bucket },
  })),
);
assert.equal(seeded.error, null, "Local failure fixture could not be recorded");
const admit = () =>
  db.rpc("admit_admin_auth_attempt", { p_scope: "TOTP", p_bucket: bucket });
const attempts = await Promise.all(Array.from({ length: 20 }, admit));
const accepted = attempts.filter(
  ({ data, error }) => !error && typeof data === "string",
);
const limited = attempts.filter(
  ({ error }) => error?.message === "ADMIN_AUTH_RATE_LIMITED",
);
assert.equal(accepted.length, 1, "Only one remaining slot may be reserved");
assert.equal(
  limited.length,
  19,
  "All remaining concurrent requests must be denied",
);
assert.equal(
  (
    await db.rpc("finish_admin_auth_attempt", {
      p_attempt_id: accepted[0].data,
      p_succeeded: true,
    })
  ).error,
  null,
);
const retry = await admit();
assert.equal(
  retry.error,
  null,
  "A successful attempt must release its reservation",
);
assert.equal(
  (
    await db.rpc("finish_admin_auth_attempt", {
      p_attempt_id: retry.data,
      p_succeeded: false,
    })
  ).error,
  null,
);
assert.equal(
  (
    await db.rpc("finish_admin_auth_attempt", {
      p_attempt_id: retry.data,
      p_succeeded: false,
    })
  ).error,
  null,
  "Identical completion retry must be idempotent",
);
assert.equal(
  (await admit()).error?.message,
  "ADMIN_AUTH_RATE_LIMITED",
  "The fifth failed attempt must close the budget",
);
console.info(
  JSON.stringify({
    check: "local admin auth concurrent admission",
    concurrentRequests: 20,
    admitted: accepted.length,
    denied: limited.length,
    successfulReservationReleased: true,
    failureCompletionIdempotent: true,
  }),
);
