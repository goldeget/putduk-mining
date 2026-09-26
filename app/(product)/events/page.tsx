import { PageHeading } from "@/components/product/page-heading";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { requirePageUser } from "@/lib/auth/session";

export default async function EventsPage() {
  const identity = await requirePageUser();
  const [{ data: events }, { data: notices }] = await Promise.all([
    identity.supabase
      .from("events")
      .select("id, slug, title_ko, summary_ko, status, starts_at, ends_at")
      .order("starts_at", { ascending: false }),
    identity.supabase
      .from("notices")
      .select("id, slug, title_ko, summary_ko, published_at, is_pinned")
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false }),
  ]);

  return (
    <>
      <PageHeading
        eyebrow="LIVE OPERATIONS"
        title="이벤트도 규칙의 적용 시점부터."
        lead="이벤트 보상은 승인된 버전과 유효 시간에 따라 한 번만 적용됩니다."
      />
      {events?.length ? (
        <div className="data-list">
          {events.map((event) => (
            <Surface as="article" className="data-row" key={event.id}>
              <div>
                <span>{event.status}</span>
                <h2>{event.title_ko}</h2>
                <p>{event.summary_ko}</p>
              </div>
            </Surface>
          ))}
        </div>
      ) : (
        <StatePanel
          title="진행 중인 이벤트가 없습니다"
          description="운영자가 검토하고 공개한 이벤트만 이곳에 표시됩니다."
        />
      )}
      <section className="notice-section" aria-labelledby="notice-title">
        <h2 id="notice-title">공지</h2>
        {notices?.length ? (
          notices.map((notice) => <p key={notice.id}>{notice.title_ko}</p>)
        ) : (
          <p>현재 공개된 공지가 없습니다.</p>
        )}
      </section>
    </>
  );
}
