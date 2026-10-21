import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactNode } from "react";
import { EventParticipation } from "@/components/product/event-participation";
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
let cashTerms: Record<string, unknown> | null;
let cashTermsError: boolean;
let cashSelection: string;
const validTerms = {
  event_id: eventId,
  content_revision_id: revisionId,
  terms_version: 1,
  terms_ko: "공개된 실제 정산 조건에 동의해야 현금 보상을 받을 수 있어요.",
  cash_terms_digest: "a".repeat(64),
  reward_krw: "1000",
  starts_at: "2026-10-01T00:00:00Z",
  ends_at: "2026-11-01T00:00:00Z",
};

// The external DB boundary projects only requested columns, as Supabase does.
// Otherwise returning every fixture field would hide a missing mode selection.
function from(table: string) {
  let columns: string[] = [];
  const query = {
    select(selection: string) {
      columns = selection.split(",").map((column) => column.trim());
      if (table === "member_cash_event_terms") cashSelection = selection;
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
      if (table === "member_cash_event_terms")
        return {
          data:
            cashTerms === null
              ? null
              : Object.fromEntries(
                  columns
                    .filter((key) => key in cashTerms!)
                    .map((key) => [key, cashTerms![key]]),
                ),
          error: cashTermsError ? { code: "DB" } : null,
        };
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
  cashTerms = null;
  cashTermsError = false;
  cashSelection = "";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
  vi.mocked(requirePageUser).mockResolvedValue({
    userId: "member-owner",
    supabase: { from },
  } as unknown as Awaited<ReturnType<typeof requirePageUser>>);
});
afterEach(() => vi.useRealTimers());

describe("event detail participation authority", () => {
  it("isolates participation state by verified member and event while retaining same-member terms recovery", async () => {
    function participationKey(node: ReactNode): string | null {
      if (Array.isArray(node)) {
        for (const child of node) {
          const found = participationKey(child);
          if (found !== null) return found;
        }
        return null;
      }
      if (!isValidElement<{ children?: ReactNode }>(node)) return null;
      if (node.type === EventParticipation) return node.key;
      return participationKey(node.props.children);
    }
    const first = participationKey(
      await EventsDetailPage({
        params: Promise.resolve({ slug: "safe-event" }),
      }),
    );
    cashTerms = validTerms;
    const sameMember = participationKey(
      await EventsDetailPage({
        params: Promise.resolve({ slug: "safe-event" }),
      }),
    );
    vi.mocked(requirePageUser).mockResolvedValue({
      userId: "another-verified-member",
      supabase: { from },
    } as unknown as Awaited<ReturnType<typeof requirePageUser>>);
    const nextMember = participationKey(
      await EventsDetailPage({
        params: Promise.resolve({ slug: "safe-event" }),
      }),
    );
    expect(first).not.toBeNull();
    expect(sameMember).toBe(first);
    expect(nextMember).not.toBe(first);
  });
  it("renders only the eight published cash terms fields and explicit consent instead of a false no-cash claim", async () => {
    cashTerms = validTerms;
    const html = await renderPage();
    expect(html).toContain(validTerms.terms_ko);
    expect(html).toContain("1,000원");
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("현금 보상이 없는 이벤트예요");
    expect(cashSelection.split(",").sort()).toEqual(
      [
        "event_id",
        "content_revision_id",
        "terms_version",
        "terms_ko",
        "cash_terms_digest",
        "reward_krw",
        "starts_at",
        "ends_at",
      ].sort(),
    );
  });
  it("does not turn a failed terms read into a NONE join", async () => {
    cashTermsError = true;
    const html = await renderPage();
    expect(html).toContain("참여 약관을 확인하지 못했어요");
    expect(html).not.toContain("이벤트 참여</button>");
    expect(html).not.toContain("현금 보상이 없는 이벤트예요");
  });
  it.each([
    { event_id: "73100000-0000-4000-8000-000000000009" },
    { content_revision_id: "73100000-0000-4000-8000-000000000009" },
    { terms_version: 0 },
    { terms_ko: "" },
    { cash_terms_digest: "A".repeat(64) },
    { reward_krw: "0" },
    { reward_krw: "1.5" },
    { reward_krw: "9223372036854775808" },
    { starts_at: "2026-10-21T00:00:00Z" },
    { ends_at: "2026-10-20T00:00:00Z" },
  ])("fails closed on invalid or unbound cash terms %j", async (patch) => {
    cashTerms = { ...validTerms, ...patch };
    const html = await renderPage();
    expect(html).toContain("참여 약관을 확인하지 못했어요");
    expect(html).not.toContain("이벤트 참여</button>");
    expect(html).not.toContain("현금 보상이 없는 이벤트예요");
  });
  it("never acquires a cash consent command for informational GUIDE content", async () => {
    mode = "GUIDE";
    cashTerms = validTerms;
    const html = await renderPage();
    expect(html).not.toContain('type="checkbox"');
    expect(cashSelection).toBe("");
    expect(html).toContain('href="/faq"');
  });
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
