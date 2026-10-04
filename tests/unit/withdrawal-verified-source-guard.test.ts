import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(
    new URL(`../../${path}`, import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
}

const migration = source(
  "supabase/migrations/20261004100000_withdrawal_verified_source_guard.sql",
);
const original = source(
  "supabase/migrations/20260927120300_ws04_destination_and_request_commands.sql",
);
const historical = source(
  "supabase/test-fixtures/historical-held-withdrawal.sql",
).trimEnd();
const guard = `  -- Existing requests recover above. Fresh general withdrawals remain closed
  -- until an authoritative earned producer and source lifecycle are connected.
  -- Dedicated START must carry its own qualified, captured original receipt.
  if p_welcome_reward_conversion_id is null then
    raise exception using errcode = '55000',
      message = 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE';
  end if;
  if not exists (
    select 1
    from public.trial_reward_conversions as conversion
    join public.money_source_movements as movement
      on movement.ledger_transaction_id = conversion.ledger_transaction_id
    where conversion.id = p_welcome_reward_conversion_id
      and conversion.user_id = p_user_id
      and conversion.status = 'CONVERTED'
      and conversion.converted_amount_atomic = p_amount_krw
      and conversion.funding_required = false
      and movement.user_id = p_user_id
      and movement.source_bucket = 'BONUS'
      and movement.origin_code = 'WELCOME_REWARD'
      and movement.movement_kind = 'CREDIT'
      and movement.amount_atomic = p_amount_krw
      and movement.wallet_ledger_id = conversion.wallet_ledger_id
      and exists (
        select 1 from public.trial_qualification_snapshots as qualification
        where qualification.conversion_id = conversion.id
          and qualification.decision = 'APPROVED'
          and qualification.kyc_status = 'APPROVED'
          and qualification.rule_version = conversion.rule_version
          and qualification.risk_model_version = conversion.risk_model_version
      )
      and app_private.money_source_credit_verified(movement)
  ) then
    raise exception using errcode = '55000', message = 'WELCOME_REWARD_NOT_WITHDRAWABLE';
  end if;

`;
const suites = [
  { name: "ws04_security_money_workers", historicalCalls: 4 },
  { name: "withdrawal_logical_lifecycle", historicalCalls: 2 },
  { name: "legacy_withdrawal_entrypoint_closure", historicalCalls: 2 },
  { name: "krw_deposit_journal_integrity", historicalCalls: 3 },
];

function requestFunction(text: string) {
  const result = text.match(
    /create (?:or replace )?function app_private\.request_withdrawal_with_hold\([\s\S]*?\n\$\$;/,
  );
  if (!result) throw new Error("EXACT_WITHDRAWAL_WRITER_MISSING");
  return result[0];
}

function after(text: string, separator: string) {
  const value = text.split(separator)[1];
  if (value === undefined) throw new Error("SOURCE_BOUNDARY_MISSING");
  return value;
}

describe("withdrawal source safety closure source integrity", () => {
  it("preserves every original statement outside the new fail-closed branch", () => {
    const revised = requestFunction(migration);
    expect(revised.split(guard)).toHaveLength(2);
    expect(
      revised
        .replace("create or replace function", "create function")
        .replace(guard, ""),
    ).toBe(requestFunction(original));
    expect(migration.match(/create (?:or replace )?function /g)).toHaveLength(
      1,
    );
    expect(migration.trim()).toMatch(/^begin;[\s\S]*commit;$/);
    expect(migration).not.toMatch(
      /\b(?:grant|revoke|create trigger|alter table|pg_advisory|sourceComplete|feature_flag)\b/i,
    );
  });

  it("rejects only fresh general creation after original recovery and before locks or writes", () => {
    const revised = requestFunction(migration);
    const boundary = revised.indexOf(guard);
    expect(revised.indexOf("assert_not_safe_mode")).toBeLessThan(boundary);
    expect(revised.indexOf("INVALID_WITHDRAWAL_REQUEST")).toBeLessThan(
      boundary,
    );
    expect(revised.indexOf("return v_request_id;")).toBeLessThan(boundary);
    expect(revised.indexOf("for update;")).toBeGreaterThan(boundary);
    expect(
      revised.indexOf("insert into public.withdrawal_requests"),
    ).toBeGreaterThan(boundary);
    expect(
      revised.indexOf("app_private.post_withdrawal_hold("),
    ).toBeGreaterThan(boundary);
    expect(revised.slice(0, boundary)).toContain("request.user_id = p_user_id");
    expect(revised.slice(0, boundary)).toContain(
      "request.idempotency_key = p_idempotency_key",
    );
    expect(guard).not.toMatch(
      /\b(?:insert|update|delete|for update|perform)\b/i,
    );
  });

  it("leaves both public general callers unable to select the dedicated START argument", () => {
    const wrappers = original.slice(
      original.indexOf("create function public.request_krw_withdrawal("),
    );
    expect(
      wrappers.match(
        /p_amount_krw, '(?:KRW_BANK|USDT_ADDRESS)', p_idempotency_key, null/g,
      ),
    ).toHaveLength(2);
    const welcome = after(
      source(
        "supabase/migrations/20260927120400_ws04_withdrawal_lifecycle_commands.sql",
      ),
      "create or replace function public.create_welcome_reward_withdrawal_request(",
    );
    expect(welcome).toContain("conversion.user_id = p_user_id");
    expect(welcome).toContain("conversion.status = 'CONVERTED'");
    expect(welcome).toContain("v_conversion.converted_amount_atomic > 5000");
    expect(welcome).toContain("policy.fee_atomic = 0");
    expect(welcome).toContain(
      "request.welcome_reward_conversion_id = p_conversion_id",
    );
    expect(welcome).toContain("p_idempotency_key,\n    p_conversion_id");
  });

  it("uses only existing original receipt columns without inventing a source identity", () => {
    const tables = [
      {
        alias: "movement",
        table: "money_source_movements",
        migration:
          "supabase/migrations/20261003081200_money_source_credit_provenance.sql",
      },
      {
        alias: "conversion",
        table: "trial_reward_conversions",
        migration:
          "supabase/migrations/20260926192203_ws02_foundation_schema.sql",
      },
      {
        alias: "qualification",
        table: "trial_qualification_snapshots",
        migration:
          "supabase/migrations/20260926192203_ws02_foundation_schema.sql",
      },
    ];
    for (const entry of tables) {
      const definition = after(
        source(entry.migration),
        `create table public.${entry.table} (`,
      ).split(/^create (?:table|index)/m)[0];
      if (definition === undefined) throw new Error("RECEIPT_TABLE_MISSING");
      const columns = new Set(
        [
          ...definition.matchAll(
            /^  ([a-z_][a-z_0-9]*) (?:uuid|text|bigint|integer|boolean|timestamptz|public\.)/gm,
          ),
        ].map((match) => match[1]),
      );
      const references = [
        ...guard.matchAll(
          new RegExp(`\\b${entry.alias}\\.([a-z_][a-z_0-9]*)`, "g"),
        ),
      ];
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references)
        expect(columns.has(reference[1])).toBe(true);
    }
  });

  it("isolates historical setup from production and never synthesizes verified source or wallet money", () => {
    expect(historical).toContain(
      "create function pg_temp.seed_historical_held_withdrawal(",
    );
    expect(historical).toContain("if current_user <> 'postgres' then");
    expect(historical).toContain(
      "from public, anon, authenticated, service_role;",
    );
    expect(historical).toContain(
      "security invoker set search_path = pg_catalog",
    );
    expect(historical).toContain(
      "v_journal := app_private.post_withdrawal_hold(",
    );
    expect(historical).toContain("'WITHDRAWAL_REQUESTED.v1'");
    expect(historical).toContain("insert into public.transaction_receipts");
    expect(historical).not.toMatch(
      /\b(?:grant|security definer|sourceComplete|pg_advisory)\b/i,
    );
    expect(historical).not.toMatch(
      /(?:insert into|update|delete from) public\.(?:wallet_ledger|money_source_movements|trial_reward_conversions)/i,
    );
    expect(historical).not.toMatch(/create function (?:public|app_private)\./i);
  });

  it("keeps the shared helper outside standalone database test discovery", () => {
    expect(
      existsSync(
        new URL(
          "../../supabase/tests/fixtures/historical-held-withdrawal.sql",
          import.meta.url,
        ),
      ),
    ).toBe(false);
    expect(historical).not.toMatch(/select (?:plan|no_plan|finish)\(/);
  });

  it("reconciles a historical outcome through the real recovery command before asserting its durable state", () => {
    const sql = source(
      "supabase/tests/database/withdrawal_logical_lifecycle.sql",
    );
    const canonical = source(
      "supabase/migrations/20260930052429_withdrawal_logical_lifecycle.sql",
    );
    expect(canonical).toContain(
      "if v_request is not null then\n    return v_request;",
    );
    const recovery = sql.indexOf(
      "update logical_ctx set logical=public.resolve_withdrawal_logical_request(owner_id,'RECOVER',logical->>'key');",
    );
    expect(recovery).toBeGreaterThan(
      sql.indexOf(
        "update logical_ctx set withdrawal_id=pg_temp.seed_historical_held_withdrawal(",
      ),
    );
    expect(recovery).toBeLessThan(
      sql.indexOf(
        "'OUTCOME_UNCERTAIN','historical hold recovery records durable outcome uncertainty'",
      ),
    );
  });

  it.each(suites)(
    "keeps $name historical helper identical and rollback-only",
    ({ name, historicalCalls }) => {
      const sql = source(`supabase/tests/database/${name}.sql`);
      const start = "-- BEGIN TEST-ONLY HISTORICAL HOLD FIXTURE\n";
      const end = "\n-- END TEST-ONLY HISTORICAL HOLD FIXTURE";
      const embedded = sql.split(start)[1]?.split(end)[0];
      expect(embedded).toBe(historical);
      expect(sql.trim()).toMatch(/^begin;[\s\S]*rollback;$/);
      const body = after(sql, end);
      expect(
        body.match(/pg_temp\.seed_historical_held_withdrawal\(/g),
      ).toHaveLength(historicalCalls);
      expect(body).toContain(
        "WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE",
      );
      expect(body).toContain("select * from finish();");
      expect(sql).not.toMatch(/(?<![A-Za-z_0-9$])\$select\b/);
      const delimiters = sql.match(/\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/g) ?? [];
      for (const delimiter of new Set(delimiters)) {
        expect(
          delimiters.filter((token) => token === delimiter).length % 2,
        ).toBe(0);
      }
      const plan = body.match(/select plan\((\d+)\);/);
      if (plan) {
        expect(Number(plan[1])).toBe(
          body.match(/^select (?:ok|is|isnt|throws_ok|lives_ok|cmp_ok)\(/gm)
            ?.length,
        );
      } else {
        expect(body).toContain("select no_plan();");
      }
    },
  );

  it("keeps worker finalization evidence on the recovered original while closing fresh general requests", () => {
    const worker = source("tests/worker/runtime-evidence.test.ts");
    const test = after(
      worker,
      'it("closes fresh general withdrawal and finalizes a historical original without another send"',
    ).split('\n  it("')[0];
    expect(test).toContain('requestError?.code).toBe("55000")');
    expect(test).toContain("rejectedRequestCount).toBe(0)");
    expect(test).toContain(
      'readFileSync("supabase/test-fixtures/historical-held-withdrawal.sql", "utf8")',
    );
    expect(test).toContain("recovered.data).toBe(withdrawalId)");
    expect(test).toContain('provenance.data?.coverage).toBe("UNRESOLVED")');
    expect(test).toContain('"record_krw_external_send"');
    expect(test).toContain('"finalize_withdrawal_ledger"');
    expect(test).toContain("sendCountAfter).toBe(1)");
    expect(test).toContain("finalizeReplay).toBe(finalizeTx)");
  });
});
