import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Test-only derivatives. Frozen source files are never edited or written back.
export const USDT_195_FROZEN_SOURCES = Object.freeze({
  principal: {
    path: "supabase/test-fixtures/principal_finalize_current_basis.sql",
    sha256: "a9869874465283af88759d86f7fc608c96e70abb296774b32f3e40002a96b8d2",
  },
  krw: {
    path: "supabase/tests/database/krw_deposit_journal_integrity.sql",
    sha256: "97e1dc22ac782ad341a16d6b1ab5401a5210c667e5cb698275d9725dd6305d93",
  },
  concurrency: {
    path: "tests/integration/external-send-concurrency.py",
    sha256: "ef224c4a352f5e0d20cb16381e3c6c41e96d2a4660807f3577cb3ea7b3058c0d",
  },
});
function frozen(source, kind, confirmation) {
  if (
    confirmation?.fullPayoutConfirmed !== true ||
    Object.keys(confirmation).length !== 1
  )
    throw new Error("EXPLICIT_TEST_OPERATOR_FULL_PAYOUT_CONFIRMATION_REQUIRED");
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source, "utf8");
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    USDT_195_FROZEN_SOURCES[kind].sha256
  )
    throw new Error("FROZEN_USDT_195_SOURCE_MISMATCH");
  return bytes.toString("utf8");
}
function replaceOnce(source, before, after, name, changes) {
  if (source.split(before).length !== 2)
    throw new Error("USDT_195_EXACT_MATCH_REQUIRED:" + name);
  changes.push({
    name,
    before,
    after,
    beforeSha256: createHash("sha256").update(before).digest("hex"),
    afterSha256: createHash("sha256").update(after).digest("hex"),
    matches: 1,
  });
  return source.replace(before, () => after);
}
const proofFunction = `
-- Test-only explicit manual attestation. No price, chain proof or operating approval.
create function pg_temp.usdt_195_evidence(p_id uuid,p_actual text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $fixture$
declare r public.withdrawal_requests%rowtype;
begin
  select * into strict r from public.withdrawal_requests where id=p_id;
  if r.currency::text<>'KRW' or r.destination_type<>'USDT_ADDRESS' or r.fee_atomic<>0
    or p_actual !~ '^(0|[1-9][0-9]{0,31})([.][0-9]{0,5}[1-9])?$' or p_actual::numeric<=0
    then raise exception 'TEST_ORIGINAL_REQUEST_OR_QUANTITY_INVALID'; end if;
  return jsonb_build_object('version',1,'basis','OPERATOR_MANUAL_FULL_PAYOUT',
    'withdrawalId',r.id::text,'requestedKrwAmount',r.amount_atomic::text,
    'actualUsdtAmount',p_actual,'network','TRC20','feeKrw','0','fullPayoutConfirmed',true);
end; $fixture$;
`;
const historySelect = (
  context,
  destination,
) => `insert into public.withdrawal_destination_history
(destination_id,user_id,destination_type,action,display_hint,value_fingerprint,metadata,actor_user_id,request_id)
select d.id,d.user_id,d.destination_type,'REGISTERED',d.display_hint,d.value_fingerprint,
 jsonb_build_object('network','TRC20','fixture','EXPLICIT_195_SYNTHETIC_ORIGINAL'),d.user_id,gen_random_uuid()
from public.withdrawal_destinations d join ${context} c on d.id=c.${destination};
`;
function receipt(sql, changes, kind) {
  return {
    sql,
    source: USDT_195_FROZEN_SOURCES[kind],
    changes,
    sha256: createHash("sha256").update(sql).digest("hex"),
    status: "AUTHORED_NOT_TESTED",
  };
}
export function buildPrincipal195Fixture(source, confirmation) {
  let sql = frozen(source, "principal", confirmation);
  const changes = [];
  const anchor =
    "grant select,update on finalize_usdt_ctx to authenticated,service_role;";
  sql = replaceOnce(
    sql,
    anchor,
    historySelect("finalize_usdt_ctx", "destination") + proofFunction + anchor,
    "principal-explicit-original-history-and-proof",
    changes,
  );
  const send =
    "update finalize_usdt_ctx set send=public.record_usdt_external_send(withdrawal,'TRC20','139-local-operator-manual-hash',1.25::numeric,null,";
  sql = replaceOnce(
    sql,
    send,
    send.replace(
      "1.25::numeric,null,",
      "1.25::numeric,pg_temp.usdt_195_evidence(withdrawal,'1.25'),",
    ),
    "principal-only-fresh-send-evidence",
    changes,
  );
  const assertion =
    " and s.conversion_evidence is null and s.method='USDT_ADDRESS'";
  sql = replaceOnce(
    sql,
    assertion,
    " and s.conversion_evidence=pg_temp.usdt_195_evidence(r.id,'1.25') and s.method='USDT_ADDRESS'",
    "principal-only-evidence-conjunct",
    changes,
  );
  return receipt(sql, changes, "principal");
}
export function buildKrw195Fixture(source, confirmation) {
  let sql = frozen(source, "krw", confirmation);
  const changes = [];
  const anchor =
    "set local role service_role;\nupdate krw_ctx\nset usdt_withdrawal_id = public.request_usdt_withdrawal(";
  sql = replaceOnce(
    sql,
    anchor,
    historySelect("krw_ctx", "usdt_destination_id") + proofFunction + anchor,
    "krw-explicit-original-history-and-proof",
    changes,
  );
  const first =
    "  1.250000,\n  null,\n  admin_id,\n  statement_timestamp(),\n  'krw-journal-usdt-send-0001'";
  sql = replaceOnce(
    sql,
    first,
    first.replace(
      "  null,",
      "  pg_temp.usdt_195_evidence(usdt_withdrawal_id,'1.25'),",
    ),
    "krw-only-fresh-send-evidence",
    changes,
  );
  const replay =
    "    1.250000,\n    null,\n    (select admin_id from krw_ctx),";
  sql = replaceOnce(
    sql,
    replay,
    replay.replace(
      "    null,",
      "    pg_temp.usdt_195_evidence((select usdt_withdrawal_id from krw_ctx),'1.25'),",
    ),
    "krw-identical-replay-evidence",
    changes,
  );
  const alias =
    "(select usdt_withdrawal_id from krw_ctx), ' trc20 ', ' ABC123DEF456 ', 1.250000, null,";
  sql = replaceOnce(
    sql,
    alias,
    alias.replace(
      "1.250000, null,",
      "1.250000, pg_temp.usdt_195_evidence((select usdt_withdrawal_id from krw_ctx),'1.25'),",
    ),
    "krw-identical-alias-evidence",
    changes,
  );

  for (const [name, original] of [
    [
      "krw-network-only-negative",
      "  (select usdt_withdrawal_id from krw_ctx), 'ERC20', 'abc123def456', 1.25, null,",
    ],
    [
      "krw-tx-only-negative",
      "  (select usdt_withdrawal_id from krw_ctx), 'TRC20', 'abc123def457', 1.25, null,",
    ],
    [
      "krw-one-micro-only-negative",
      "  (select usdt_withdrawal_id from krw_ctx), 'TRC20', 'abc123def456', 1.250001, null,",
    ],
  ]) {
    sql = replaceOnce(
      sql,
      original,
      original.replace(
        "null,",
        "pg_temp.usdt_195_evidence((select usdt_withdrawal_id from krw_ctx),'1.25'),",
      ),
      name,
      changes,
    );
  }
  const timeNegative =
    "  (select usdt_withdrawal_id from krw_ctx), 'TRC20', 'abc123def456', 1.25, null,\n  (select admin_id from krw_ctx),\n  (select sent_at + interval '1 second'";
  sql = replaceOnce(
    sql,
    timeNegative,
    timeNegative.replace(
      "null,",
      "pg_temp.usdt_195_evidence((select usdt_withdrawal_id from krw_ctx),'1.25'),",
    ),
    "krw-time-only-negative",
    changes,
  );
  return receipt(sql, changes, "krw");
}
export function buildConcurrency195Fixture(source, confirmation) {
  let sql = frozen(source, "concurrency", confirmation);
  const changes = [];
  const anchor =
    "          insert into esc_context(method,ordinal,member,destination)";
  sql = replaceOnce(
    sql,
    anchor,
    `          insert into public.withdrawal_destination_history(destination_id,user_id,destination_type,
            action,display_hint,value_fingerprint,metadata,actor_user_id,request_id)
          select id,user_id,destination_type,'REGISTERED',display_hint,value_fingerprint,
            '{{"network":"TRC20","fixture":"EXPLICIT_195_SYNTHETIC_ORIGINAL"}}'::jsonb,user_id,gen_random_uuid()
            from public.withdrawal_destinations where id='{destination}' and destination_type='USDT_ADDRESS';
` + anchor,
    "concurrency-only-new-destination-history",
    changes,
  );
  const oldLine = sql
    .split("\n")
    .find((line) =>
      line.includes('return f"public.record_usdt_external_send('),
    );
  if (!oldLine) throw new Error("USDT_195_CONCURRENCY_CALL_REQUIRED");
  const newLine = `    evidence = json.dumps({"version": 1, "basis": "OPERATOR_MANUAL_FULL_PAYOUT", "withdrawalId": withdrawal,
        "requestedKrwAmount": "5000", "actualUsdtAmount": "1.25",
        "network": "TRC20", "feeKrw": "0", "fullPayoutConfirmed": True}, separators=(",", ":"))
    return f"public.record_usdt_external_send('{withdrawal}','TRC20','esc-tx-{run}',{amount},'{evidence}'::jsonb,'{admin}','{sent_at}','{key}')"`;
  sql = replaceOnce(
    sql,
    oldLine,
    newLine,
    "concurrency-only-explicit-evidence-constructor",
    changes,
  );
  // ROOT, exact project, migration, advisory wait and all concurrency assertions retained.
  // The original clone-directory guard is retained; this assigned R has a .git directory.
  return receipt(sql, changes, "concurrency");
}
export function buildApi195HeldFixture(source, input) {
  frozen(source, "krw", { fullPayoutConfirmed: input.fullPayoutConfirmed });
  for (const key of ["memberId", "adminId", "destinationId", "movementId"])
    if (
      typeof input[key] !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input[key])
    )
      throw new Error("USDT_195_FIXTURE_UUID_REQUIRED");
  const text = Buffer.isBuffer(source) ? source.toString("utf8") : source;
  const start = "-- BEGIN TEST-ONLY VERIFIED MINING REWARD FIXTURE";
  const end = "-- END TEST-ONLY VERIFIED MINING REWARD FIXTURE";
  if (text.split(start).length !== 2 || text.split(end).length !== 2)
    throw new Error("USDT_195_REWARD_PRELUDE_REQUIRED");
  const prelude = text.slice(text.indexOf(start), text.indexOf(end));
  return `begin;
${prelude}
select * from app_private.ensure_withdrawal_hold_accounts('${input.memberId}');
select pg_temp.plant_verified_mining_reward('${input.memberId}','${input.movementId}',10000,
 statement_timestamp(),statement_timestamp(),'195-api-credit-${input.movementId}');
insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,minimum_amount_atomic,fee_atomic,
 destination_config,effective_at,approved_by,allows_welcome_reward)
select 'KRW','USDT_ADDRESS',coalesce(max(version),0)+1,true,1,0,'{"allowed_networks":["TRC20"]}'::jsonb,
 statement_timestamp()-interval '3 hours','${input.adminId}',false from public.withdrawal_policies where currency='KRW' and destination_type='USDT_ADDRESS';
insert into public.withdrawal_destinations(id,user_id,destination_type,encrypted_value,value_fingerprint,display_hint,verification_status,verified_at,protection_until)
values('${input.destinationId}','${input.memberId}','USDT_ADDRESS',convert_to('SYNTHETIC-195-ONLY','UTF8'),
 '195-api-${input.destinationId}','TRC20 synthetic mature owner fixture','VERIFIED',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day');
insert into public.withdrawal_destination_history(destination_id,user_id,destination_type,action,display_hint,value_fingerprint,metadata,actor_user_id,request_id)
select id,user_id,destination_type,'REGISTERED',display_hint,value_fingerprint,'{"network":"TRC20","fixture":"EXPLICIT_195_SYNTHETIC_ORIGINAL"}'::jsonb,
 user_id,gen_random_uuid() from public.withdrawal_destinations where id='${input.destinationId}';
set local role service_role;
select public.request_usdt_withdrawal('${input.memberId}','${input.destinationId}',5000,'195-api-hold-${input.movementId}');
commit;`;
}

// Emits text only; does not apply SQL, run Python, start services, or write source files.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const modes = {
    "--emit-basis": ["principal", buildPrincipal195Fixture],
    "--emit-krw": ["krw", buildKrw195Fixture],
    "--emit-concurrency": ["concurrency", buildConcurrency195Fixture],
  };
  const mode = modes[process.argv[2]];
  if (
    !mode ||
    process.argv.length !== 4 ||
    process.argv[3] !== "--confirmed-full-payout"
  )
    throw new Error("USDT_195_EXPLICIT_EMIT_ARGUMENTS_REQUIRED");
  const gate = await import("./backend-http-195-source.mjs");
  const reviewed =
    process.platform === "win32"
      ? gate.assertBackendHttp195LocalCandidateSources()
      : gate.assertBackendHttp195CanonicalCandidateSources();
  if (reviewed.migrationSources !== 195)
    throw new Error("EXACT_195_CANDIDATE_REQUIRED");
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const original = await readFile(
    resolve(root, USDT_195_FROZEN_SOURCES[mode[0]].path),
  );
  process.stdout.write(mode[1](original, { fullPayoutConfirmed: true }).sql);
}
