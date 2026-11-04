import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptWorkroomSignupFixtures,
  adaptWorkroomDefinerRoster,
  adaptWorkroomRetiredTrialAcl,
  adaptWorkroomWithdrawalPolicyVersions,
  adaptWorkroomSafeModeConcurrency,
} from "./workroom-native-adapters.mjs";
import { readFileSync } from "node:fs";
test("safe-mode race preserves existing control and all real concurrency assertions", () => {
  const sql = readFileSync(
    new URL(
      "../supabase/tests-concurrent/safe_mode_concurrent_command.sql",
      import.meta.url,
    ),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const r = adaptWorkroomSafeModeConcurrency(sql);
  assert.equal(r.reverseExact, true);
  assert.match(r.sql, /on conflict \(component\) do nothing/);
  assert.match(
    r.sql,
    /'expected_request_id', \(select request_id from public.safe_mode_controls where component = 'AI'\)/,
  );
  assert.equal(
    r.sql.slice(r.sql.indexOf("select is((select blocked_sessions")),
    sql.slice(sql.indexOf("select is((select blocked_sessions")),
  );
  assert.match(r.sql, /v_blocked <> 2/);
  assert.match(r.sql, /set role service_role/);
  assert.throws(
    () =>
      adaptWorkroomSafeModeConcurrency(
        sql.replace("where id =", "where changed_id ="),
      ),
    /SAFE_CONCURRENCY_EXACT_SPAN_REQUIRED/,
  );
});
test("retained withdrawal policies capture one transaction-local base and preserve every other byte", () => {
  const original =
    "begin;\nselect " + Array(9).fill("189001").join(",") + ";\nrollback;";
  const r = adaptWorkroomWithdrawalPolicyVersions(
    "withdrawal_logical_lifecycle.sql",
    original,
  );
  assert.equal(r.reverseExact, true);
  assert.equal(r.matches, 9);
  assert.equal((r.sql.match(/max\(version\)/g) ?? []).length, 1);
  assert.equal((r.sql.match(/current_setting/g) ?? []).length, 9);
  assert.match(r.sql, /set_config\('putduk.workroom_policy_base'.*, true\)/);
  assert.throws(
    () =>
      adaptWorkroomWithdrawalPolicyVersions(
        "withdrawal_logical_lifecycle.sql",
        original.replace("189001", "189002"),
      ),
    /POLICY_VERSION_EXACT_COUNT_REQUIRED/,
  );
});
test("successor trial ACL denies the retired service entrypoint without changing other SQL", () => {
  const assertion =
    "select ok(\n  has_function_privilege('service_role', 'public.start_trial(uuid,text)', 'EXECUTE'),\n  'service role can execute start_trial'\n);";
  const original =
    "-- unchanged prefix\n" + assertion + "\n-- unchanged suffix";
  const result = adaptWorkroomRetiredTrialAcl(original);
  assert.equal(result.reverseExact, true);
  assert.equal(
    result.sql,
    original.replace(
      assertion,
      assertion
        .replace("  has_function_privilege", "  not has_function_privilege")
        .replace(
          "service role can execute start_trial",
          "service role cannot execute retired start_trial",
        ),
    ),
  );
  assert.throws(
    () =>
      adaptWorkroomRetiredTrialAcl(
        original.replace("can execute", "may execute"),
      ),
    /TRIAL_ACL_EXACT_SPAN_REQUIRED/,
  );
  assert.throws(
    () => adaptWorkroomRetiredTrialAcl(original + assertion),
    /TRIAL_ACL_EXACT_SPAN_REQUIRED/,
  );
});
test("invitation metadata wraps only exact metadata positions in VALUES and SELECT", () => {
  const a =
    "insert into auth.users(id, raw_user_meta_data, email) values (gen_random_uuid(),jsonb_build_object('name','x,y'),'a'),(gen_random_uuid(),'{}','b');";
  const r = adaptWorkroomSignupFixtures(a);
  assert.equal(r.matches, 2);
  assert.equal(r.reverseExact, true);
  assert.match(r.sql, /signup_metadata\(\(jsonb_build_object/);
  assert.match(r.sql, /'a'\),\(gen_random_uuid/);
  const b =
    "insert into auth.users(id,raw_user_meta_data) select person,'{}' from context;";
  assert.equal(adaptWorkroomSignupFixtures(b).matches, 1);
});
test("unsupported auth insertion fails closed", () => {
  assert.equal(
    adaptWorkroomSignupFixtures("insert into auth.users(id) values('x');")
      .matches,
    2,
  );
  assert.throws(
    () =>
      adaptWorkroomSignupFixtures(
        "insert into auth.users(id,raw_user_meta_data) values('x');",
      ),
    /AUTH_COLUMN_VALUE_ARITY/,
  );
});
test("SECDEF adapter appends exact five names and preserves historical roster", () => {
  const original =
    "        'app_private.ack_safe_mode_outbox(uuid,text)'::regprocedure,\nselect count(*) = 84";
  const r = adaptWorkroomDefinerRoster(original);
  assert.match(r.sql, /count\(\*\) = 89/);
  assert.match(r.sql, /app_private.resolve_operator_login_email/);
  assert.match(r.sql, /workroom_signup/);
  assert.equal(r.reverseExact, true);
  assert.throws(
    () => adaptWorkroomDefinerRoster(original.replace("84", "83")),
    /SECDEF_201_ROSTER_REQUIRED/,
  );
});
