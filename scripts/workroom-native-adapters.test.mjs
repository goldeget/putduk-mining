import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptWorkroomSignupFixtures,
  adaptWorkroomDefinerRoster,
} from "./workroom-native-adapters.mjs";
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
test("SECDEF adapter appends exact four names and preserves historical roster", () => {
  const original =
    "        'app_private.ack_safe_mode_outbox(uuid,text)'::regprocedure,\nselect count(*) = 84";
  const r = adaptWorkroomDefinerRoster(original);
  assert.match(r.sql, /count\(\*\) = 88/);
  assert.match(r.sql, /workroom_signup/);
  assert.equal(r.reverseExact, true);
  assert.throws(
    () => adaptWorkroomDefinerRoster(original.replace("84", "83")),
    /SECDEF_201_ROSTER_REQUIRED/,
  );
});
