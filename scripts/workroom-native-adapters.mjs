/** Pure successor fixtures. Historical source and admission remain untouched. */
import { createHash } from "node:crypto";
export const sha256 = (x) => createHash("sha256").update(x).digest("hex");
const fail = (reason) => {
  throw Error("WORKROOM_NATIVE_" + reason);
};
// A small expression scanner, not a SQL reformatter. Only INSERT auth.users
// column/value positions are changed, including INSERTs inside dblink strings.
function expressions(sql, start, stop) {
  let depth = 0,
    quote = false,
    begin = start;
  const spans = [];
  for (let i = start; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      if (quote && sql[i + 1] === "'") {
        i++;
        continue;
      }
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") {
      if (depth === 0 && stop === ")") {
        spans.push([begin, i]);
        return { spans, end: i };
      }
      depth--;
    }
    if (depth === 0 && c === ",") {
      spans.push([begin, i]);
      begin = i + 1;
    }
    if (
      depth === 0 &&
      stop === "from" &&
      /^from\b/i.test(sql.slice(i)) &&
      !/[A-Za-z0-9_]/.test(sql[i - 1] ?? "")
    ) {
      spans.push([begin, i]);
      return { spans, end: i };
    }
  }
  fail("UNSUPPORTED_AUTH_INSERT_EXPRESSION");
}
export function adaptWorkroomSignupFixtures(input) {
  const sql = String(input),
    edits = [];
  const pattern =
    /\binsert\s+into\s+auth\.users\s*\(([^)]+)\)\s*(values|select)\b/gi;
  for (const m of sql.matchAll(pattern)) {
    const columns = m[1].split(",").map((x) => x.trim().toLowerCase());
    const index = columns.indexOf("raw_user_meta_data");
    if (index < 0) {
      const at = m.index + m[0].indexOf(")");
      edits.push({
        start: at,
        end: at,
        before: "",
        after: ",raw_user_meta_data",
      });
    }
    let cursor = m.index + m[0].length;
    const add = (parsed) => {
      if (parsed.spans.length !== columns.length)
        fail("AUTH_COLUMN_VALUE_ARITY");
      if (index < 0) {
        const at = parsed.spans.at(-1)[1];
        edits.push({
          start: at,
          end: at,
          before: "",
          after: ",app_private.workroom_native_signup_metadata('{}'::jsonb) ",
        });
        return;
      }
      const [a, b] = parsed.spans[index];
      edits.push({
        start: a,
        end: b,
        before: sql.slice(a, b),
        after: `app_private.workroom_native_signup_metadata((${sql.slice(a, b).trim()})::jsonb) `,
      });
    };
    if (m[2].toLowerCase() === "select") add(expressions(sql, cursor, "from"));
    else {
      for (;;) {
        while (/\s/.test(sql[cursor] ?? "")) cursor++;
        if (sql[cursor] !== "(") fail("AUTH_VALUES_TUPLE_REQUIRED");
        const parsed = expressions(sql, cursor + 1, ")");
        add(parsed);
        cursor = parsed.end + 1;
        while (/\s/.test(sql[cursor] ?? "")) cursor++;
        if (sql[cursor] !== ",") break;
        cursor++;
      }
    }
  }
  let next = sql;
  for (const e of [...edits].sort((a, b) => b.start - a.start))
    next = next.slice(0, e.start) + e.after + next.slice(e.end);
  // Reverse in positional order; no broad textual replacement can hide a change.
  let reversed = next,
    delta = 0;
  for (const e of edits.sort((a, b) => a.start - b.start)) {
    const at = e.start + delta;
    if (reversed.slice(at, at + e.after.length) !== e.after)
      fail("FIXTURE_REVERSE_SPAN");
    reversed =
      reversed.slice(0, at) + e.before + reversed.slice(at + e.after.length);
  }
  if (reversed !== sql) fail("FIXTURE_REVERSE_FAILED");
  return {
    sql: next,
    originalSha256: sha256(sql),
    sha256: sha256(next),
    matches: edits.length,
    reverseExact: true,
  };
}
/** Migration202 retires enrollment; retain the old RLS suite with its one
 * service enrollment permission inverted. Baseline201 remains byte-identical. */
/** Retained race runs after real admin/worker fixtures, so AI can already exist.
 * Reuse its actual ID/predecessor receipt; retain the original two-session race. */
export function adaptWorkroomSafeModeConcurrency(input) {
  const sql = String(input),
    edits = [
      [
        "'0d460000-0000-4000-8000-00000000f002');\n  $setup$);",
        "'0d460000-0000-4000-8000-00000000f002') on conflict (component) do nothing;\n  $setup$);",
      ],
      [
        "where id = '0d460000-0000-4000-8000-00000000f001' for update",
        "where component = 'AI' for update",
      ],
      [
        "if v_result is distinct from '0d460000-0000-4000-8000-00000000f001' then",
        "if v_result is null or v_result is distinct from (select id::text from public.safe_mode_controls where component = 'AI') then",
      ],
      [
        "'expected_request_id', '0d460000-0000-4000-8000-00000000f002'",
        "'expected_request_id', (select request_id from public.safe_mode_controls where component = 'AI')",
      ],
    ];
  let next = sql;
  for (const [before, after] of edits) {
    if (next.split(before).length !== 2)
      fail("SAFE_CONCURRENCY_EXACT_SPAN_REQUIRED");
    next = next.replace(before, after);
  }
  let reversed = next;
  for (const [before, after] of [...edits].reverse())
    reversed = reversed.replace(after, before);
  if (reversed !== sql) fail("SAFE_CONCURRENCY_REVERSE_FAILED");
  return {
    sql: next,
    originalSha256: sha256(sql),
    sha256: sha256(next),
    reverseExact: true,
  };
}
export function adaptWorkroomWithdrawalPolicyVersions(name, input) {
  const reviewed = {
    "withdrawal_logical_lifecycle.sql": { 189001: 9 },
    "withdrawal_mining_reward_hold.sql": { 1062101: 1, 1062102: 1 },
    "withdrawal_source_hold.sql": { 1061001: 1 },
    "withdrawal_reserved_source_disposition.sql": { 1063101: 1, 1063102: 1 },
    "withdrawal_verified_source_guard.sql": { 1041001: 3, 1041002: 2 },
    "withdrawal_completion_notification_original.sql": {
      1041001: 2,
      1041002: 2,
    },
    "withdrawal_zero_fee_policy.sql": { 1065101: 1, 1065102: 2 },
  };
  const sql = String(input),
    versions = reviewed[name];
  if (!versions)
    return {
      sql,
      matches: 0,
      originalSha256: sha256(sql),
      sha256: sha256(sql),
      reverseExact: true,
    };
  const transaction = sql.match(/^begin;\r?\n/gm);
  if (transaction?.length !== 1)
    fail("POLICY_VERSION_TRANSACTION_REQUIRED:" + name);
  // A single captured base survives role changes and cannot drift when this
  // suite inserts its own policies. Only local fixture version literals move;
  // relative ordering, amounts, policy contents and assertions stay exact.
  const capture =
    "select set_config('putduk.workroom_policy_base', (select coalesce(max(version),0)::text from public.withdrawal_policies), true);\n";
  let next = sql,
    matches = 0;
  const edits = [];
  for (const [version, count] of Object.entries(versions)) {
    const pattern = new RegExp("\\b" + version + "\\b", "g");
    if ((sql.match(pattern) ?? []).length !== count)
      fail("POLICY_VERSION_EXACT_COUNT_REQUIRED");
    const after =
      "(current_setting('putduk.workroom_policy_base')::integer + " +
      version +
      ")";
    next = next.replace(pattern, after);
    edits.push([version, after]);
    matches += count;
  }
  next = next.replace(transaction[0], transaction[0] + capture);
  let reversed = next.replace(capture, "");
  for (const [version, after] of edits)
    reversed = reversed.replaceAll(after, version);
  if (reversed !== sql) fail("POLICY_VERSION_REVERSE_FAILED");
  return {
    sql: next,
    matches,
    originalSha256: sha256(sql),
    sha256: sha256(next),
    reverseExact: true,
  };
}
export function adaptWorkroomRetiredTrialAcl(input) {
  const sql = String(input);
  const before =
    "select ok(\n  has_function_privilege('service_role', 'public.start_trial(uuid,text)', 'EXECUTE'),\n  'service role can execute start_trial'\n);";
  if (sql.split(before).length !== 2) fail("TRIAL_ACL_EXACT_SPAN_REQUIRED");
  const after = before
    .replace("  has_function_privilege", "  not has_function_privilege")
    .replace(
      "service role can execute start_trial",
      "service role cannot execute retired start_trial",
    );
  const next = sql.replace(before, after);
  if (next.replace(after, before) !== sql) fail("TRIAL_ACL_REVERSE_FAILED");
  return {
    sql: next,
    originalSha256: sha256(sql),
    sha256: sha256(next),
    reverseExact: true,
  };
}
export function adaptWorkroomDefinerRoster(input) {
  const sql = String(input),
    before =
      "        'app_private.ack_safe_mode_outbox(uuid,text)'::regprocedure,";
  const additions = [
    "app_private.workroom_signup()",
    "public.workroom_read_state()",
    "public.workroom_member_command(text,text,jsonb)",
    "public.workroom_admin_command(text,text,jsonb,uuid,uuid,text,text)",
    "app_private.resolve_operator_login_email(text)",
  ];
  const after =
    before +
    "\n" +
    additions.map((x) => `        '${x}'::regprocedure,`).join("\n");
  if (!sql.includes(before) || sql.split("select count(*) = 84").length !== 2)
    fail("SECDEF_201_ROSTER_REQUIRED");
  const next = sql
    .replaceAll(before, after)
    .replace("select count(*) = 84", "select count(*) = 89");
  if (
    next
      .replaceAll(after, before)
      .replace("select count(*) = 89", "select count(*) = 84") !== sql
  )
    fail("SECDEF_REVERSE_FAILED");
  return {
    sql: next,
    originalSha256: sha256(sql),
    sha256: sha256(next),
    reverseExact: true,
  };
}

/** Existing identities are seeded before202. Keep all negative signup tests and
 * use real DB time instead of disabling immutable-round/signup triggers. */
export function adaptWorkroomPractice(input) {
  let sql = String(input).replaceAll("\r\n", "\n");
  const replace = (before, after) => {
    if (sql.split(before).length !== 2) fail("PRACTICE_EXACT_SPAN_REQUIRED");
    sql = sql.replace(before, after);
  };
  const identity = sql.match(
    /^insert into auth\.users\(id,email,email_confirmed_at\) values[^\n]+;/m,
  )?.[0];
  const cohort = sql.match(
    /insert into app_private\.workroom_cohort\(user_id\) values[^;]+;/,
  )?.[0];
  if (!identity || !cohort) fail("PRACTICE_PREEXISTING_FIXTURE_REQUIRED");
  replace(
    identity,
    "-- Existing UUIDs were actually inserted on schema201 and captured by migration202.",
  );
  replace(cohort, "");
  replace(
    "select extensions.plan(1);",
    "select extensions.plan(1);\nupdate app_private.workroom_config set duration=30;",
  );
  replace(
    "update app_private.workroom_rounds set started_at=clock_timestamp()-interval '121 seconds' where user_id=auth.uid();",
    "select pg_sleep(31);",
  );
  replace(
    "update app_private.workroom_config set pattern=pattern_name,roi=10,duration=120,amplitude=4,version=version+1 where instrument='usd';",
    "update app_private.workroom_config set pattern=pattern_name,roi=10,duration=30,amplitude=4,version=version+1 where instrument='usd';",
  );
  replace(
    "update app_private.workroom_rounds set started_at=clock_timestamp()-interval '44.4 seconds' where id=(s#>>'{active,id}')::uuid;",
    "perform pg_sleep(11.1);",
  );
  replace(
    "update app_private.workroom_rounds set started_at=clock_timestamp()-interval '31 seconds' where id=(select (value#>>'{active,id}')::uuid from negative_start);",
    "select pg_sleep(31);",
  );
  replace("select set_config('session_replication_role','replica',true);", "");
  replace("select set_config('session_replication_role','origin',true);", "");
  replace(
    "elapsed:=extract(epoch from(r.closed_at-r.started_at))/120;",
    "elapsed:=extract(epoch from(r.closed_at-r.started_at))/30;",
  );
  sql = sql
    .replaceAll("set local session_replication_role=replica;", "")
    .replaceAll("set local session_replication_role=origin;", "")
    .replaceAll(
      "perform set_config('session_replication_role','replica',true);",
      "",
    )
    .replaceAll(
      "perform set_config('session_replication_role','origin',true);",
      "",
    );
  if (sql.includes("session_replication_role"))
    fail("PRACTICE_TRIGGER_BYPASS_REJECTED");
  return { sql, sha256: sha256(sql), originalSha256: sha256(input) };
}
