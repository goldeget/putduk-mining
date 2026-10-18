import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StartPage from "@/app/(product)/start/page";

const reads = vi.hoisted(() => ({
  owner: "ab125100-0000-4000-8000-000000000001",
  rows: {} as Record<
    string,
    { data: Record<string, unknown> | null; error: null | { message: string } }
  >,
}));
vi.mock("@/lib/auth/session", () => ({
  requirePageUser: async () => ({
    userId: reads.owner,
    supabase: {
      from: (name: string) => {
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => reads.rows[name],
        };
        return query;
      },
    },
  }),
}));
vi.mock("@/components/foundation/mining-core", () => ({
  MiningCore: () => null,
}));
vi.mock("@/components/product/trial-synchronizer", () => ({
  TrialSynchronizer: () => null,
}));
vi.mock("@/components/product/route-reload-button", () => ({
  RouteReloadButton: () => null,
}));
vi.mock("@/components/product/start-trial-button", () => ({
  StartTrialButton: () => createElement("button", null, "first-start-command"),
}));
vi.mock("@/components/product/welcome-reward-action", () => ({
  WelcomeRewardAction: () =>
    createElement(
      "div",
      { "data-welcome-next-action": true },
      "reward-kyc-withdrawal-next-action",
    ),
}));

beforeEach(() => {
  reads.rows = {
    trial_account_snapshots: {
      data: { user_id: reads.owner, status: "READY", completed_at: null },
      error: null,
    },
    trial_reward_conversions: { data: null, error: null },
    member_lifecycle_states: {
      data: {
        user_id: reads.owner,
        stage: "SIGNED_UP",
        first_funding_at: null,
        welcome_withdrawal_completed_at: null,
      },
      error: null,
    },
  };
});
async function html() {
  return renderToStaticMarkup(await StartPage());
}
describe("START server page gates first guidance without removing subsequent actions", () => {
  it.each(["COMPLETED", "EXPIRED"])(
    "never renders first-guide replay after %s; reward/KYC/withdrawal action survives",
    async (status) => {
      reads.rows.trial_account_snapshots!.data!.status = status;
      const markup = await html();
      expect(markup).not.toContain("처음 안내 다시 보기");
      expect(markup).toContain("reward-kyc-withdrawal-next-action");
      expect(markup).not.toContain("first-start-command");
    },
  );
  it.each([
    "trial_account_snapshots",
    "trial_reward_conversions",
    "member_lifecycle_states",
  ])("renders no temporary tour when %s fails", async (name) => {
    reads.rows[name]!.error = { message: "synthetic read failure" };
    expect(await html()).not.toContain("처음 안내 다시 보기");
  });
  it("keeps the completed reward read recovery instead of first guidance", async () => {
    reads.rows.trial_account_snapshots!.data!.status = "COMPLETED";
    reads.rows.trial_reward_conversions!.error = {
      message: "synthetic read failure",
    };
    const markup = await html();
    expect(markup).not.toContain("처음 안내 다시 보기");
    expect(markup).toContain("환영 보상 상태를 확인하지 못했어요");
  });
  it("admits confirmed READY first guidance and existing start action", async () => {
    const markup = await html();
    expect(markup).toContain("처음 안내 다시 보기");
    expect(markup).toContain("first-start-command");
  });
  it("suppresses guidance for conversion history even if the trial snapshot says READY", async () => {
    reads.rows.trial_reward_conversions!.data = {
      user_id: reads.owner,
      status: "CONVERTED",
    };
    expect(await html()).not.toContain("처음 안내 다시 보기");
  });
});
