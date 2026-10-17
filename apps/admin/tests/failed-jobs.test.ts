import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FailedJobs,
  type FailedJobRecord,
} from "@/app/(control)/exceptions/failed-jobs";
import ExceptionsPage from "@/app/(control)/exceptions/page";

const reads = vi.hoisted(() => ({
  authorize: vi.fn(),
  service: vi.fn(),
  selectJobs: vi.fn(),
  jobs: { data: [] as unknown[], error: null as unknown },
}));

vi.mock("@/lib/auth/principal", () => ({
  requireAdminPage: reads.authorize,
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: reads.service,
}));
vi.mock("@/app/(control)/exceptions/ack-form", () => ({
  ExceptionAckForm: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const job: FailedJobRecord = {
  id: "73d9044c-a4a1-4aef-a2c4-0ce1b4be3984",
  job_type: "FINANCIAL_RECONCILIATION",
  status: "FAILED",
  attempts: 3,
  updated_at: "2026-10-06T01:02:00Z",
  dead_lettered_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  reads.jobs = { data: [], error: null };
  reads.authorize.mockResolvedValue({ role: "ADMIN" });
  reads.service.mockReturnValue({
    from(table: string) {
      const result =
        table === "system_jobs" ? reads.jobs : { data: [], error: null };
      const query = {
        select: (fields: string) => {
          if (table === "system_jobs") reads.selectJobs(fields);
          return query;
        },
        in: () => query,
        or: () => query,
        order: () => query,
        limit: () => query,
        then: (resolve: (value: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return query;
    },
  });
});

function render(
  jobs: readonly FailedJobRecord[],
  options: { unavailable?: boolean; canUseAssistant?: boolean } = {},
) {
  return renderToStaticMarkup(
    createElement(FailedJobs, {
      jobs,
      unavailable: options.unavailable ?? false,
      canUseAssistant: options.canUseAssistant ?? true,
      observedAt: "2026-10-06T02:00:00Z",
    }),
  );
}

describe("beginner failed-job evidence and safe next steps", () => {
  it("explains financial comparison in Korean and links only to the existing review", () => {
    const html = render([job]);
    expect(html).toContain("금액 기록 비교");
    expect(html).toContain("처리 실패");
    expect(html).toContain("처리 시도");
    expect(html).toContain("3회");
    expect(html).toMatch(/<time\s+datetime="2026-10-06T01:02:00Z"/i);
    expect(html).toContain('href="/exceptions#reconciliation-exceptions"');
    expect(html).toContain("실제 입출금 결과와 함께 검토하세요");
    expect(html).toContain("재시도 시점은 이 목록에서 확인할 수 없어요");
    expect(html).not.toContain(job.job_type);
    expect(html).not.toContain(job.id);
  });

  it.each([
    { status: "DEAD_LETTER", dead_lettered_at: null },
    { status: "FAILED", dead_lettered_at: "2026-10-06T01:02:00Z" },
  ])(
    "shows stopped evidence without inventing replay or a funded result: %j",
    (state) => {
      const html = render([
        { ...job, ...state, job_type: "FUNDING_MINING_TICK_V1" },
      ]);
      expect(html).toContain("유료 채굴 갱신");
      expect(html).toContain("자동 처리 중단");
      expect(html).toContain('href="/members"');
      expect(html).toContain("문의를 받은 회원이 있다면");
      expect(html).toContain("원금·보류 금액과 채굴 결과를 따로 확인하세요");
      expect(html).toContain(
        "관련 회원과 복구 결과는 이 목록에서 확인할 수 없어요",
      );
      expect(html).toContain("작업을 다시 실행할 수 없어요");
      expect(html).not.toContain("다시 실행</button>");
      expect(html).not.toContain("<form");
      expect(html).not.toContain("지급 완료");
      expect(html).not.toContain("복구 완료");
    },
  );

  it("does not treat contradictory historical markers as a proven current stop or success", () => {
    const html = render([
      { ...job, status: "SUCCEEDED", dead_lettered_at: job.updated_at },
    ]);
    expect(html).toContain("현재 상태 확인 필요");
    expect(html).not.toContain("자동 처리 중단");
    expect(html).not.toContain("SUCCEEDED");
    expect(html).not.toContain("복구 완료");
  });

  it("unknown job names stay unknown and do not leak arbitrary private text", () => {
    const html = render([
      { ...job, job_type: "PRIVATE_PROVIDER_TOKEN<script>secret</script>" },
    ]);
    expect(html).toContain("작업 종류 확인 필요");
    expect(html).toContain("처리 내용을 추정하지 않아요");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("PRIVATE_PROVIDER_TOKEN");
    expect(html).not.toContain("secret");
    expect(html).not.toContain("금액 기록 비교");
    expect(html).not.toContain("유료 채굴 갱신");
  });

  it("a failed read hides residual rows and cannot look like an empty or recovered queue", () => {
    const html = render([job], { unavailable: true });
    expect(html).toContain('role="alert"');
    expect(html).toContain("현재 작업 상태는 확인되지 않았어요");
    expect(html).toContain("목록 다시 불러오기");
    expect(html).not.toContain("금액 기록 비교");
    expect(html).not.toContain("불러온 작업 1건");
    expect(html).not.toContain("실패한 작업 기록이 없어요");
  });

  it("an empty read reports only this queue and does not fabricate global health", () => {
    const html = render([]);
    expect(html).toContain("실패한 작업 기록이 없어요");
    expect(html).toContain(
      "이 조회에서 실패하거나 중단된 작업을 찾지 못했어요",
    );
    expect(html).not.toContain("정상 운영");
    expect(html).not.toContain("모든 작업 완료");
    expect(html).not.toContain("지금 확인할 순서");
  });

  it("keeps assistant navigation absent when the current role cannot use that page", () => {
    expect(render([job], { canUseAssistant: false })).not.toContain(
      'href="/assistant"',
    );
    expect(render([job], { canUseAssistant: true })).toContain(
      'href="/assistant"',
    );
    expect(render([job], { canUseAssistant: false })).toContain(
      'href="/exceptions#reconciliation-exceptions"',
    );
  });
});

describe("failed-job page integration preserves the read boundary", () => {
  it("authorization denial stops before privileged reads", async () => {
    reads.authorize.mockRejectedValue(new Error("PAGE_ACCESS_DENIED"));
    await expect(ExceptionsPage()).rejects.toThrow("PAGE_ACCESS_DENIED");
    expect(reads.authorize).toHaveBeenCalledExactlyOnceWith("/exceptions");
    expect(reads.service).not.toHaveBeenCalled();
  });

  it.each([
    ["SUPER_ADMIN", true],
    ["ADMIN", true],
    ["SUPPORT_ADMIN", false],
  ])("%s keeps its existing assistant capability", async (role, allowed) => {
    reads.authorize.mockResolvedValue({ role });
    const html = renderToStaticMarkup(await ExceptionsPage());
    expect(html.includes('href="/assistant"')).toBe(allowed);
    expect(reads.selectJobs).toHaveBeenCalledExactlyOnceWith(
      "id, job_type, status, attempts, updated_at, dead_lettered_at",
    );
  });

  it("a partial job read cannot expose residual rows as current evidence", async () => {
    reads.jobs = {
      data: [job],
      error: { message: "private provider failure" },
    };
    const html = renderToStaticMarkup(await ExceptionsPage());
    expect(html).toContain('data-ui-state="partial"');
    expect(html).toContain("작업 목록을 확인하지 못했어요");
    expect(html).not.toContain("금액 기록 비교");
    expect(html).not.toContain("private provider failure");
    expect(html).not.toContain("실패한 작업 기록이 없어요");
  });
});
