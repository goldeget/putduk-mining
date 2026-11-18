import { requirePageUserOrRedirect } from "@/lib/auth/session";
import { ClientRedirect } from "@/components/auth/client-redirect";
import { WorkroomClient } from "./workroom-client";
export async function WorkroomPage({
  page = "room",
}: {
  page?: "room" | "history" | "points" | "guide";
}) {
  const gate = await requirePageUserOrRedirect();
  if (gate.status === "redirect") {
    return <ClientRedirect to={gate.redirectUrl} />;
  }
  return <WorkroomClient page={page} ownerUserId={gate.identity.userId} />;
}
