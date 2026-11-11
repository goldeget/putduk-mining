import { test } from "node:test";
import assert from "node:assert/strict";
import { browserPlan, ownsBrowser } from "./ci-workroom-browser-server.mjs";

const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "goldeget/putduk-mining",
  APP_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:63421",
  GITHUB_RUN_ID: "12345",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_JOB: "acceptance-worker",
  CI_HEAD_SHA: "a".repeat(40),
};
const plan = (
  change = {},
  root = "/work/repo",
  platform = "linux",
  version = "1.63.0",
) => browserPlan({ ...env, ...change }, root, platform, version);

test("browser runtime pins the approved amd64 image and loopback transport", () => {
  const value = plan();
  assert.match(
    value.image,
    /^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/,
  );
  assert.equal(value.endpoint, "ws://127.0.0.1:9323/");
  assert.equal(value.name, "workroom-browser-12345-1-acceptance-worker");
});
for (const change of [
  { GITHUB_ACTIONS: "false" },
  { GITHUB_REPOSITORY: "someone/other" },
  { APP_ENV: "production" },
  { NEXT_PUBLIC_SUPABASE_URL: "https://awrubjiqkggaxcvtckbr.supabase.co" },
  { GITHUB_RUN_ID: "123;stop" },
  { GITHUB_JOB: "../../other" },
  { CI_HEAD_SHA: "unverified" },
]) {
  test(`rejects unsafe runtime identity ${Object.keys(change)[0]}`, () => {
    assert.throws(() => plan(change), /WORKROOM_BROWSER_/);
  });
}
test("refuses a local Windows run or package version drift", () => {
  assert.throws(() => plan({}, "/work/repo", "win32"), /WORKROOM_BROWSER_/);
  assert.throws(
    () => plan({}, "/work/repo", "linux", "1.64.1"),
    /WORKROOM_BROWSER_/,
  );
  assert.throws(() => plan({}, "/work:rw/repo"), /WORKROOM_BROWSER_/);
});
test("cleanup requires every ownership label, including exact run and commit", () => {
  const value = plan();
  assert.equal(ownsBrowser(value.labels, value), true);
  for (const key of Object.keys(value.labels)) {
    assert.equal(
      ownsBrowser({ ...value.labels, [key]: "another-owner" }, value),
      false,
    );
  }
  assert.equal(ownsBrowser(null, value), false);
  assert.equal(ownsBrowser({}, value), false);
});
