import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KycQueuePage from "@/app/(control)/kyc/page";
import { KycReviewForm } from "@/app/(control)/kyc/review-form";
import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

const reads = vi.hoisted(() => ({
  cases: { data: [] as unknown[], error: null as unknown },
  submissions: { data: [] as unknown[], error: null as unknown },
  auditError: null as unknown,
  events: [] as string[],
}));
vi.mock("@/lib/auth/principal", () => ({
  requireAdminPage: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: vi.fn(() => ({
    from(table: string) {
      reads.events.push(table);
      const result = table === "kyc_cases" ? reads.cases : reads.submissions;
      const query = {
        select: () => query,
        insert: () => {
          reads.events.push("audit-insert");
          return Promise.resolve({ error: reads.auditError });
        },
        in: () => query,
        order: () => query,
        limit: () => Promise.resolve(result),
        then: (resolve: (value: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return query;
    },
  })),
}));
vi.mock("@/app/(control)/kyc/actions", () => ({
  reviewKycCaseFromFields: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdminPage).mockResolvedValue({
    role: "ADMIN",
    userId: "operator",
  } as never);
  reads.cases = { data: [], error: null };
  reads.submissions = { data: [], error: null };
  reads.auditError = null;
  reads.events = [];
});

describe("KYC read truth", () => {
  it.each(["VIEWER", "CONTENT_ADMIN", "SUPPORT_ADMIN"])(
    "denies %s before privileged queries",
    async (role) => {
      vi.mocked(requireAdminPage).mockResolvedValue({ role } as never);
      await expect(KycQueuePage()).rejects.toThrow(
        "REDIRECT:/unauthorized?code=ROLE_FORBIDDEN",
      );
      expect(createAdminServiceClient).not.toHaveBeenCalled();
      expect(reads.events).toEqual([]);
    },
  );
  it("records privileged access before reading cases", async () => {
    await KycQueuePage();
    expect(reads.events).toEqual(["audit_logs", "audit-insert", "kyc_cases"]);
  });
  it("cannot read cases or submissions when the read audit fails", async () => {
    reads.auditError = { message: "audit unavailable" };
    const markup = renderToStaticMarkup(await KycQueuePage());
    expect(markup).toContain('data-ui-state="error"');
    expect(markup).toContain("조회 기록을 남기지 못해");
    expect(markup).not.toContain("대기 건 없음");
    expect(reads.events).toEqual(["audit_logs", "audit-insert"]);
  });
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
