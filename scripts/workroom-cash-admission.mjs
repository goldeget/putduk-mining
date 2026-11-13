import { createHash } from "node:crypto";

export const WORKROOM_CASH_MIGRATION =
  "supabase/migrations/20261111065929_workroom_direct_deposit_cash.sql";
export const WORKROOM_BANK_MIGRATION =
  "supabase/migrations/20261111165640_workroom_bank_instructions_member_directory.sql";
export const WORKROOM_MEMBER_SESSION_MIGRATION =
  "supabase/migrations/20261112080627_workroom_member_birth_completion_session_continuity.sql";
export const WORKROOM_CASH_ISOLATION_MIGRATION =
  "supabase/migrations/20261113061155_workroom_direct_cash_mode_isolation.sql";
export const WORKROOM_CASH_BEFORE_ISOLATION =
  "supabase/tests/fixtures/workroom_cash_mode_before_isolation.sql";
export const WORKROOM_CASH_ADOPTION =
  "supabase/tests/database/workroom_cash_mode_adoption.sql";
export const WORKROOM_CASH_TESTS = [
  "supabase/tests/database/workroom_direct_cash.sql",
  "supabase/tests-concurrent/workroom_direct_cash_concurrency.sql",
  "supabase/tests/database/workroom_bank_members.sql",
  "supabase/tests/database/workroom_member_session_completion.sql",
  "supabase/tests/database/workroom_cash_mode_isolation.sql",
];
export const WORKROOM_CASH_FILES = [
  WORKROOM_CASH_MIGRATION,
  WORKROOM_BANK_MIGRATION,
  WORKROOM_MEMBER_SESSION_MIGRATION,
  WORKROOM_CASH_ISOLATION_MIGRATION,
  WORKROOM_CASH_BEFORE_ISOLATION,
  WORKROOM_CASH_ADOPTION,
  ...WORKROOM_CASH_TESTS,
];
export const WORKROOM_CASH_ACL_TESTS = [
  "supabase/tests/database/ai_conversation_storage.sql",
  "supabase/tests/database/ai_conversation_summaries.sql",
  "supabase/tests/database/ai_tool_evidence.sql",
  "supabase/tests/database/rls.sql",
  "supabase/tests/database/ws04_security_money_workers.sql",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Keep the historical 89-definer fixture intact; admit one new private helper. */
export function adaptWorkroomCashDefinerRoster(
  input,
  { occurrences = 1 } = {},
) {
  const source = String(input);
  const anchor =
    "        'app_private.resolve_operator_login_email(text)'::regprocedure,";
  const addition =
    anchor +
    "\n        'app_private.workroom_cash_owner_ready(uuid)'::regprocedure,";
  if (
    ![1, 2].includes(occurrences) ||
    source.split(anchor).length !== occurrences + 1 ||
    source.split("select count(*) = 89").length !== 2
  )
    throw Error("WORKROOM_CASH_89_ROSTER_REQUIRED");
  const sql = source
    .replaceAll(anchor, addition)
    .replace("select count(*) = 89", "select count(*) = 90");
  if (
    sql
      .replaceAll(addition, anchor)
      .replace("select count(*) = 90", "select count(*) = 89") !== source
  )
    throw Error("WORKROOM_CASH_ROSTER_REVERSE_FAILED");
  return {
    sql,
    originalSha256: digest(source),
    sha256: digest(sql),
    reverseExact: true,
  };
}

/** Admission is exact: source and isolated staged money tests must both match. */
export function assertWorkroomCashAdmission(records, readSource, readStage) {
  if (
    !Array.isArray(records) ||
    JSON.stringify(records.map((row) => row.path)) !==
      JSON.stringify(WORKROOM_CASH_FILES)
  )
    throw Error("WORKROOM_CASH_EXACT_ROSTER_REQUIRED");
  for (const record of records) {
    if (
      !/^[a-f0-9]{64}$/.test(record.sha256 ?? "") ||
      digest(readSource(record.path)) !== record.sha256 ||
      digest(readStage(record.path)) !== record.sha256
    )
      throw Error("WORKROOM_CASH_STAGED_BYTES_CHANGED");
  }
}

/** Completion requires the ordered real205 seed, preservation and206 regressions. */
export function assertWorkroomCashCompletion(records) {
  const label = (path) => path.split("/").at(-1).replaceAll(".", "-");
  const required = [
    [label(WORKROOM_CASH_BEFORE_ISOLATION), false],
    ["cash-isolation-existing-rows-before", false],
    [label(WORKROOM_CASH_ISOLATION_MIGRATION), false],
    ["cash-isolation-existing-rows-after", false],
    ["cash-isolation-migration-history", false],
    [label(WORKROOM_CASH_ADOPTION), true],
    ...WORKROOM_CASH_TESTS.map((path) => [label(path), true]),
  ];
  let previous = -1;
  for (const [name, tap] of required) {
    const matches = records
      .map((record, index) => ({ record, index }))
      .filter((x) => x.record.label === name);
    if (
      matches.length !== 1 ||
      matches[0].index <= previous ||
      (tap &&
        !(
          Number.isInteger(matches[0].record.assertions) &&
          matches[0].record.assertions > 0
        ))
    )
      throw Error("WORKROOM_CASH_COMPLETION_PROOF_REQUIRED_" + name);
    previous = matches[0].index;
  }
}
