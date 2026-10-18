import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  planWelcomePolicySeed,
  WELCOME_POLICY_CAP_KRW,
} from "../../scripts/lib/welcome-policy-seed.mjs";

const NOW = new Date("2026-10-19T00:00:00.000Z");
const APPROVER = "11111111-1111-4111-8111-111111111111";
const root = resolve(__dirname, "../..");

describe("welcome withdrawal policy seed plan", () => {
  it("plans both rails on an empty database with the same values as the migration seed", () => {
    const rows = planWelcomePolicySeed([], APPROVER, NOW);
    expect(rows.map((row) => row.destination_type)).toEqual([
      "KRW_BANK",
      "USDT_ADDRESS",
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        currency: "KRW",
        version: 1,
        is_enabled: true,
        minimum_amount_atomic: 1,
        fee_atomic: 0,
        allows_welcome_reward: true,
        approved_by: APPROVER,
        destination_config: {
          welcome_cap_atomic: WELCOME_POLICY_CAP_KRW,
          funding_required: false,
        },
      });
      // 시계 오차로 아직 효력이 없는 정책이 되지 않는다.
      expect(Date.parse(row.effective_at)).toBeLessThan(NOW.getTime());
    }
    expect(WELCOME_POLICY_CAP_KRW).toBe(5000);
    const seed = readFileSync(
      resolve(
        root,
        "supabase/migrations/20260927120500_ws04_kyc_admin_session_welcome_seed.sql",
      ),
      "utf8",
    );
    expect(seed).toContain("'welcome_cap_atomic', 5000, 'funding_required', false");
  });

  it("is idempotent for a rail that already has a welcome policy", () => {
    const rows = planWelcomePolicySeed(
      [
        { destination_type: "KRW_BANK", version: 1, allows_welcome_reward: true },
        {
          destination_type: "USDT_ADDRESS",
          version: 1,
          allows_welcome_reward: true,
        },
      ],
      APPROVER,
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it("uses the next version when only a general policy exists", () => {
    const rows = planWelcomePolicySeed(
      [
        { destination_type: "KRW_BANK", version: 3, allows_welcome_reward: false },
        { destination_type: "KRW_BANK", version: 2, allows_welcome_reward: false },
      ],
      APPROVER,
      NOW,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ destination_type: "KRW_BANK", version: 4 });
    expect(rows[1]).toMatchObject({
      destination_type: "USDT_ADDRESS",
      version: 1,
    });
  });

  it("refuses invalid input", () => {
    expect(() => planWelcomePolicySeed(null as never, APPROVER, NOW)).toThrow(
      "POLICY_READ_INVALID",
    );
    expect(() => planWelcomePolicySeed([], "", NOW)).toThrow("APPROVER_REQUIRED");
    expect(() =>
      planWelcomePolicySeed([], APPROVER, new Date("invalid")),
    ).toThrow("CLOCK_INVALID");
  });

  it("keeps the one-time script locked to the authorized project and a confirmation", () => {
    const script = readFileSync(
      resolve(root, "scripts/seed-welcome-withdrawal-policies.mjs"),
      "utf8",
    );
    expect(script).toContain('EXPECTED_PROJECT_REF = "osrmyjgmpdspdcwqjwuv"');
    expect(script).toContain("SEED_WELCOME_WITHDRAWAL_POLICIES");
    expect(script).toContain('role", "SUPER_ADMIN"');
  });
});
