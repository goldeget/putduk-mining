import { PageHeading } from "@/components/product/page-heading";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { requirePageUser } from "@/lib/auth/session";

export default async function MiningPage() {
  const identity = await requirePageUser();
  const [{ data: sessions }, { data: worlds }] = await Promise.all([
    identity.supabase
      .from("mining_active_session_snapshots")
      .select("*")
      .eq("user_id", identity.userId),
    identity.supabase
      .from("asset_worlds")
      .select("code, display_name_ko")
      .order("sort_order"),
  ]);

  return (
    <>
      <PageHeading
        eyebrow="MINING SYSTEM"
        title="월드는 다섯, 정산 원칙은 하나."
        lead="채굴량은 화면이 아니라 서버의 유효 규칙 버전과 경과 시간으로 계산됩니다."
      />
      {sessions?.length ? (
        <div className="data-list">
          {sessions.map((session) => (
            <Surface
              as="article"
              className="data-row"
              key={session.mining_session_id}
            >
              <div>
                <span>{session.world_code}</span>
                <h2>{session.world_name_ko}</h2>
              </div>
              <dl>
                <div>
                  <dt>상태</dt>
                  <dd>{session.status}</dd>
                </div>
                <div>
                  <dt>미정산 시간</dt>
                  <dd>{session.unsettled_seconds}초</dd>
                </div>
                <div>
                  <dt>활성 장비</dt>
                  <dd>{session.active_equipment_count}</dd>
                </div>
              </dl>
            </Surface>
          ))}
        </div>
      ) : (
        <StatePanel
          title="실제 채굴 세션이 없습니다"
          description="PUTDUK START를 완료하고 운영 승인된 경제 규칙이 연결되면 실제 채굴을 시작할 수 있습니다."
        />
      )}
      <section className="world-rail" aria-label="지원 월드">
        {worlds?.map((world, index) => (
          <span key={world.code}>
            <small>{String(index + 1).padStart(2, "0")}</small>
            {world.display_name_ko}
          </span>
        ))}
      </section>
    </>
  );
}
