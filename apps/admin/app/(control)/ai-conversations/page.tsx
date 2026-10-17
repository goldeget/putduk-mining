import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/principal";
import { AiConversationConsole } from "./conversation-console";

export default async function AiConversationsPage() {
  const principal = await requireAdminPage("/ai-conversations");
  if (principal.role !== "SUPER_ADMIN") redirect("/unauthorized");
  return <AiConversationConsole />;
}
