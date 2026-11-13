import { createHash } from "node:crypto";
import { WORKROOM_CASH_ACL_TESTS } from "./workroom-cash-admission.mjs";

export const WORKROOM_APP_MIGRATION =
  "supabase/migrations/20261113080126_workroom_support_notifications_scheduler.sql";
export const WORKROOM_APP_TESTS = [
  "supabase/tests/database/workroom_app_support.sql",
  "supabase/tests-concurrent/workroom_app_due_race.sql",
];
export const WORKROOM_APP_FILES = [
  WORKROOM_APP_MIGRATION,
  ...WORKROOM_APP_TESTS,
];
const digest = (input) => createHash("sha256").update(input).digest("hex");

/** Only the four additive207 identities are admitted; historical bodies stay frozen. */
export function adaptWorkroomAppDefinerRoster(input, { occurrences = 1 } = {}) {
  const source = String(input);
  const anchor =
    "        'app_private.workroom_cash_owner_ready(uuid)'::regprocedure,";
  const names = [
    "public.workroom_app_member(text,text,jsonb)",
    "public.workroom_app_admin(text,text,jsonb,uuid,uuid,text,text)",
    "public.workroom_app_worker(text,jsonb)",
    "app_private.workroom_app_cash_event()",
  ];
  const addition =
    anchor +
    "\n" +
    names.map((name) => `        '${name}'::regprocedure,`).join("\n");
  if (
    ![1, 2].includes(occurrences) ||
    source.split(anchor).length !== occurrences + 1 ||
    source.split("select count(*) = 90").length !== 2
  )
    throw Error("WORKROOM_APP_90_ROSTER_REQUIRED");
  const sql = source
    .replaceAll(anchor, addition)
    .replace("select count(*) = 90", "select count(*) = 94");
  if (
    sql
      .replaceAll(addition, anchor)
      .replace("select count(*) = 94", "select count(*) = 90") !== source
  )
    throw Error("WORKROOM_APP_ROSTER_REVERSE_FAILED");
  return {
    sql,
    originalSha256: digest(source),
    sha256: digest(sql),
    reverseExact: true,
  };
}
export function assertWorkroomAppAdmission(records, readSource, readStage) {
  if (
    !Array.isArray(records) ||
    JSON.stringify(records.map((r) => r.path)) !==
      JSON.stringify(WORKROOM_APP_FILES)
  )
    throw Error("WORKROOM_APP_EXACT_ROSTER_REQUIRED");
  for (const row of records)
    if (
      !/^[a-f0-9]{64}$/.test(row.sha256 ?? "") ||
      digest(readSource(row.path)) !== row.sha256 ||
      digest(readStage(row.path)) !== row.sha256
    )
      throw Error("WORKROOM_APP_STAGED_BYTES_CHANGED");
}
export function assertWorkroomAppCompletion(records) {
  const label = (path) => path.split("/").at(-1).replaceAll(".", "-");
  const required = [
    ["app-existing-rows-before", false],
    [label(WORKROOM_APP_MIGRATION), false],
    ["app-existing-rows-after", false],
    ["app-migration-history", false],
    ...WORKROOM_CASH_ACL_TESTS.map((p) => ["app-acl-" + label(p), true]),
    ...WORKROOM_APP_TESTS.map((p) => [label(p), true]),
  ];
  let previous = -1;
  for (const [name, tap] of required) {
    const matches = records
      .map((record, index) => ({ record, index }))
      .filter((r) => r.record.label === name);
    if (
      matches.length !== 1 ||
      matches[0].index <= previous ||
      (tap &&
        !(
          Number.isInteger(matches[0].record.assertions) &&
          matches[0].record.assertions > 0
        ))
    )
      throw Error("WORKROOM_APP_COMPLETION_PROOF_REQUIRED_" + name);
    previous = matches[0].index;
  }
}
