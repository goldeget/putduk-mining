import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KycQueuePage from "@/app/(control)/kyc/page";
import { KycReviewForm } from "@/app/(control)/kyc/review-form";

const reads = vi.hoisted(() => ({
  cases: { data: [] as unknown[], error: null as unknown },
  submissions: { data: [] as unknown[], error: null as unknown },
}));
vi.mock("@/lib/auth/principal", () => ({
  requireAdminPage: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: () => ({
    from(table: string) {
      const result = table === "kyc_cases" ? reads.cases : reads.submissions;
      const query = {
        select: () => query,
        in: () => query,
        order: () => query,
        limit: () => Promise.resolve(result),
        then: (resolve: (value: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return query;
    },
  }),
}));
vi.mock("@/app/(control)/kyc/actions", () => ({
  reviewKycCaseFromFields: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeEach(() => {
  reads.cases = { data: [], error: null };
  reads.submissions = { data: [], error: null };
});

describe("KYC read truth", () => {
  it("distinguishes a failed queue from zero cases", async () => {
    reads.cases.error = { message: "timeout" };
    const markup = renderToStaticMarkup(await KycQueuePage());
    expect(markup).toContain('data-ui-state="error"');
    expect(markup).not.toContain("대기 건 없음");
  });
  it("shows an actual empty queue", async () => {
    const markup = renderToStaticMarkup(await KycQueuePage());
    expect(markup).toContain('data-ui-state="empty"');
    expect(markup).toContain("대기 건 없음");
  });
  it("submission failure is unknown evidence, never 0 documents", async () => {
    reads.cases.data = [
      {
        id: "case-1",
        user_id: "user-1",
        status: "PENDING",
        risk_level: "HIGH",
        opened_at: "2026-09-30T00:00:00Z",
        decided_at: null,
        decision_reason: null,
      },
    ];
    reads.submissions.error = { message: "timeout" };
    const markup = renderToStaticMarkup(await KycQueuePage());
    expect(markup).toContain('data-ui-state="partial"');
    expect(markup).toContain("확인 불가");
    expect(markup).toContain("<fieldset disabled");
  });
  it("locks the whole review form while evidence is unavailable", () => {
    const markup = renderToStaticMarkup(
      createElement(KycReviewForm, {
        caseId: "case-1",
        evidenceAvailable: false,
      }),
    );
    expect(markup).toContain("<fieldset disabled");
    expect(markup).toContain('disabled="" type="submit"');
  });
});
