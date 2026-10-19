import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EventsDetailPage from "@/app/(product)/events/[slug]/page";
import { requirePageUser } from "@/lib/auth/session";

vi.mock("@/lib/auth/session", () => ({ requirePageUser: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh() {} }),
}));

const eventId = "73100000-0000-4000-8000-000000000001";
const revisionId = "73100000-0000-4000-8000-000000000002";
let mode: unknown;
let contentError: boolean;
let participantsError: boolean;
let missingContent: boolean;

// The external DB boundary projects only requested columns, as Supabase does.
// Otherwise returning every fixture field would hide a missing mode selection.
function from(table: string) {
  let columns: string[] = [];
  const query = {
    select(selection: string) {
      columns = selection.split(",").map((column) => column.trim());
      return query;
    },
    eq() {
      return query;
    },
    in() {
      return query;
    },
    not() {
      return query;
    },
    lte() {
      return query;
    },
    async maybeSingle() {
      if (table === "event_participants")
        return { data: null, error: participantsError ? { code: "DB" } : null };
      if (table === "event_member_content" && (contentError || missingContent))
        return { data: null, error: contentError ? { code: "DB" } : null };
      const row: Record<string, unknown> =
        table === "events"
          ? {
              id: eventId,
              slug: "safe-event",
              title_ko: "이벤트 안내",
              summary_ko: "참여 조건을 확인하세요.",
              status: "LIVE",
              starts_at: "2026-10-01T00:00:00Z",
              ends_at: "2026-11-01T00:00:00Z",
              published_at: "2026-10-01T00:00:00Z",
            }
          : {
              event_id: eventId,
              revision_id: revisionId,
              body_ko: "내용을 읽은 뒤 안내 화면으로 이동하세요.",
              participation_ko: "이벤트 안내를 확인하세요.",
              exclusion_ko: "기간 밖에는 참여할 수 없어요.",
              cta_label: "안내 확인",
              cta_route: "/faq",
              reward_mode: "NONE",
              ...(mode === undefined ? {} : { participation_mode: mode }),
            };
      if (!["events", "event_member_content"].includes(table))
        throw new Error("UNEXPECTED_TABLE");
      return {
        data: Object.fromEntries(
          columns
            .filter((column) => column in row)
            .map((column) => [column, row[column]]),
        ),
        error: null,
      };
    },
  };
  return query;
}

async function renderPage() {
  return renderToStaticMarkup(
    await EventsDetailPage({ params: Promise.resolve({ slug: "safe-event" }) }),
  );
}

beforeEach(() => {
  mode = "JOIN";
  contentError = participantsError = missingContent = false;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
  vi.mocked(requirePageUser).mockResolvedValue({
    userId: "member-owner",
    supabase: { from },
  } as unknown as Awaited<ReturnType<typeof requirePageUser>>);
});
afterEach(() => vi.useRealTimers());

describe("event detail participation authority", () => {
  it("shows the published GUIDE action without offering an impossible participation command", async () => {
    mode = "GUIDE";
    const html = await renderPage();
    expect(html).toContain('href="/faq"');
    expect(html).toContain("안내 확인");
    expect(html).not.toContain("이벤트 참여</button>");
  });

  it.each(["JOIN", undefined])(
    "retains the existing %s join contract and published action",
    async (value) => {
      mode = value;
      const html = await renderPage();
      expect(html).toContain("이벤트 참여</button>");
      expect(html).toContain('href="/faq"');
    },
  );

  it.each([null, "guide", "CASH_REWARD"])(
    "does not turn invalid mode %s into permission to join",
    async (value) => {
      mode = value;
      const html = await renderPage();
      expect(html).not.toContain("이벤트 참여</button>");
      expect(html).toContain("참여 안내를 확인할 수 없어요");
      expect(html).not.toContain('href="/faq"');
    },
  );

  it.each(["error", "missing"])(
    "does not infer legacy permission from %s content",
    async (value) => {
      contentError = value === "error";
      missingContent = value === "missing";
      const html = await renderPage();
      expect(html).not.toContain("이벤트 참여</button>");
      expect(html).toContain("참여 안내를 확인할 수 없어요");
    },
  );

  it("keeps a failed participant read closed while preserving the approved action", async () => {
    participantsError = true;
    const html = await renderPage();
    expect(html).not.toContain("이벤트 참여</button>");
    expect(html).toContain("참여 상태를 확인하지 못했어요");
    expect(html).toContain('href="/faq"');
  });
});
