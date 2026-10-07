import { describe, expect, it } from "vitest";
import { buildTodaySnapshot } from "@/app/(control)/_lib/today-snapshot";
import { buildDailyBrief } from "@/lib/operations/daily-brief";

const ready = (count: number) => ({ count, error: null });
const base = {
  krwDeposits: ready(0),
  usdtDeposits: ready(0),
  krwWithdrawals: ready(0),
  usdtWithdrawals: ready(0),
  kyc: ready(0),
  mismatches: ready(0),
  failedJobs: ready(0),
  safePaused: ready(0),
  users: ready(0),
  trials: ready(0),
  audits: { data: [], error: null },
};
describe("operator recommendations", () => {
  it("puts unknown reads ahead of financial work", () => {
    const brief = buildDailyBrief(
      buildTodaySnapshot({
        ...base,
        krwDeposits: { count: null, error: { message: "denied" } },
        krwWithdrawals: ready(5),
      }),
    );
    expect(brief.next?.code).toBe("KRW_DEPOSIT");
    expect(brief.fact).toContain("아직 알 수 없어요");
  });
  it("counts KRW deposits and prioritizes safety before processing", () => {
    const snapshot = buildTodaySnapshot({
      ...base,
      krwDeposits: ready(2),
      safePaused: ready(1),
      mismatches: ready(1),
    });
    expect(snapshot.attentionTotal).toEqual({ kind: "ready", count: 4 });
    expect(buildDailyBrief(snapshot).next?.code).toBe("SAFE");
  });
  it("does not claim an empty inbox proves service health or payment completion", () => {
    const brief = buildDailyBrief(buildTodaySnapshot(base));
    expect(brief.next).toBeUndefined();
    expect(brief.inference).toContain("서비스 전체가 정상이라는 뜻은 아니에요");
    expect(brief.unknownText).toContain("이체 진위");
  });
});
