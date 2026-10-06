import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

const migration = source(
  "supabase/migrations/20261006043058_mining_reward_withdrawal_reservation.sql",
);
const previous = source(
  "supabase/migrations/20261006032821_withdrawal_verified_source_hold.sql",
);

describe("verified mining reward withdrawal reservation", () => {
  it("keeps the earlier principal hold migration unchanged", () => {
    expect(previous).toContain(
      "message = 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE'",
    );
    expect(previous).toContain(
      "perform app_private.apply_principal_recovery_newest_first(p_user_id, v_hold_tx);",
    );
    expect(previous).not.toContain(
      "reserve_verified_mining_reward_newest_first",
    );
  });

  it("reserves only a full fee-free mining reward and leaves principal on its own path", () => {
    expect(migration).toContain(
      "order by movement.effective_at desc, movement.recorded_at desc, movement.id desc",
    );
    expect(migration).toContain(
      "if v_mining > 0 and v_mining < v_need then",
    );
    expect(migration).toContain(
      "message = 'WITHDRAWAL_SOURCE_INSUFFICIENT'",
    );
    expect(migration).toContain("if v_mining >= v_need then");
    expect(migration).toContain("if p_fee_atomic <> 0 then");
    expect(migration).toContain("if v_mining_path then");
    expect(migration).toContain(
      "perform app_private.reserve_verified_mining_reward_newest_first(",
    );
    expect(migration).toContain(
      "perform app_private.apply_principal_recovery_newest_first(p_user_id, v_hold_tx);",
    );
    expect(migration).not.toMatch(/public\.record_mining_settlement/i);
    expect(migration).not.toMatch(
      /insert into public\.money_source_movements/i,
    );
    expect(migration).not.toMatch(
      /grant insert on (table )?public\.mining_reward_credits/i,
    );
    expect(migration).not.toMatch(
      /create (?:or replace )?function public\.request_krw_withdrawal/i,
    );
    expect(migration.trim()).toMatch(/^begin;[\s\S]*commit;$/);
  });
});
