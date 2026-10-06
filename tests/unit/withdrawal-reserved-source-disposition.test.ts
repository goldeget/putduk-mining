import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(
    new URL(`../../${path}`, import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
}

const migration = source(
  "supabase/migrations/20261006050208_withdrawal_reserved_source_disposition.sql",
);
const rewardReservation = source(
  "supabase/migrations/20261006043058_mining_reward_withdrawal_reservation.sql",
);
const principalHold = source(
  "supabase/migrations/20261006032821_withdrawal_verified_source_hold.sql",
);

describe("reserved withdrawal source disposition", () => {
  it("leaves the reservation migrations unchanged", () => {
    expect(principalHold).toContain(
      "perform app_private.apply_principal_recovery_newest_first(p_user_id, v_hold_tx);",
    );
    expect(principalHold).not.toContain(
      "reserve_verified_mining_reward_newest_first",
    );
    expect(rewardReservation).toContain(
      "order by movement.effective_at desc, movement.recorded_at desc, movement.id desc",
    );
    expect(rewardReservation).toContain(
      "release, finalize, reverse 출처 행은 만들지 않는다.",
    );
    expect(rewardReservation).not.toMatch(
      /insert into public\.money_source_movements/i,
    );
    expect(rewardReservation).not.toMatch(/public\.record_mining_settlement/i);
  });

  it("records one finalize or release source row from the existing commands", () => {
    expect(migration).toContain(
      "order by movement.effective_at desc, movement.recorded_at desc, movement.id desc",
    );
    expect(migration).toContain(
      "perform app_private.record_principal_recovery_release(",
    );
    expect(migration).toContain("MINING_REWARD_WITHDRAWAL_FINALIZE");
    expect(migration).toContain("MINING_REWARD_WITHDRAWAL_RELEASE");
    expect(migration).toContain("PRINCIPAL_RECOVERY_FINALIZE");
    expect(migration).toContain("insert into public.money_source_movements");
    expect(migration).toContain(
      "execute function app_private.record_reserved_withdrawal_source_disposition()",
    );
    expect(migration).not.toMatch(
      /create or replace function public\.finalize_withdrawal_ledger/i,
    );
    expect(migration).not.toMatch(
      /create or replace function public\.release_withdrawal_hold/i,
    );
    expect(migration).not.toMatch(/insert into public\.ledger_entries/i);
    expect(migration).not.toMatch(/insert into public\.wallet_ledger/i);
    expect(migration).not.toMatch(/public\.record_mining_settlement/i);
    expect(migration).not.toMatch(
      /create or replace function app_private\.request_withdrawal_with_hold/i,
    );
    expect(migration).toContain("new.fee_atomic is distinct from 0");
    expect(migration).toContain("WITHDRAWAL_SOURCE_DISPOSITION_CONFLICT");
    expect(migration.trim()).toMatch(/^begin;[\s\S]*commit;$/);
  });
});
