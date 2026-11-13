import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { WorkroomPage } from "@/components/workroom/workroom-page";
import { requirePageUser } from "@/lib/auth/session";
import { WORKROOM_INSTRUMENTS } from "@/domain/workroom/contracts";
import styles from "@/components/workroom/workroom.module.css";

export const dynamic = "force-dynamic";
const completed = z.object({
  round: z.object({
    id: z.uuid(),
    instrument: z.string(),
    stake: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    profit: z.number().int(),
    closedAt: z.number().finite(),
    status: z.literal("completed"),
  }),
});
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ round?: string | string[] }>;
}) {
  const { round } = await searchParams;
  if (round === undefined) return <WorkroomPage page="history" />;
  if (!z.uuid().safeParse(round).success) notFound();
  const identity = await requirePageUser(`/workroom/history?round=${round}`);
  const response = await identity.supabase.rpc("workroom_app_member", {
    p_operation: "ROUND_READ",
    p_request_key: null,
    p_input: { roundId: round },
  });
  if (response.error?.message.includes("NOT_FOUND")) notFound();
  const parsed = completed.safeParse(response.data);
  if (response.error || !parsed.success)
    return (
      <section className={styles.panel}>
        <h1>참여 결과</h1>
        <p role="alert">
          결과를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.
        </p>
        <Link href="/workroom/history">참여 내역으로</Link>
      </section>
    );
  const result = parsed.data.round;
  const amount = (n: number) => n.toLocaleString("ko-KR") + " P";
  return (
    <section className={styles.panel} aria-labelledby="round-result-title">
      <h1 id="round-result-title">참여 결과</h1>
      <h2>
        {WORKROOM_INSTRUMENTS.find((i) => i.id === result.instrument)?.name ??
          result.instrument}
      </h2>
      <p>
        {new Date(result.closedAt).toLocaleString("ko-KR", {
          timeZone: "Asia/Seoul",
        })}{" "}
        종료
      </p>
      <dl>
        <dt>참여 포인트</dt>
        <dd>{amount(result.stake)}</dd>
        <dt>종료 포인트</dt>
        <dd>{amount(result.returned)}</dd>
        <dt>포인트 변동</dt>
        <dd className={result.profit >= 0 ? styles.positive : styles.negative}>
          {result.profit >= 0 ? "+" : ""}
          {amount(result.profit)}
        </dd>
      </dl>
      <Link href="/workroom/history">전체 참여 내역 보기 →</Link>
    </section>
  );
}
