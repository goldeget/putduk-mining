import { notFound } from "next/navigation";
import { z } from "zod";
import { WorkroomPage } from "@/components/workroom/workroom-page";
import { requirePageUser } from "@/lib/auth/session";
import {
  ParticipationResult,
  ParticipationResultError,
} from "@/components/workroom/participation-history";

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
      <ParticipationResultError
        retryHref={`/workroom/history?round=${round}`}
      />
    );
  return <ParticipationResult result={parsed.data.round} />;
}
