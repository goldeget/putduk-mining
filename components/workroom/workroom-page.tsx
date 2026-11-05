import { requirePageUser } from "@/lib/auth/session";
import { WorkroomClient } from "./workroom-client";
export async function WorkroomPage({
  page = "room",
}: {
  page?: "room" | "history" | "points" | "guide";
}) {
  const identity = await requirePageUser();
  return <WorkroomClient page={page} ownerUserId={identity.userId} />;
}
