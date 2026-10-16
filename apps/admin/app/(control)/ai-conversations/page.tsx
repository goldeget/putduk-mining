import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/principal";
import { AiConversationConsole } from "./conversation-console";

export const metadata = {
  title: "회원 AI 대화 | 퍼뜩 운영",
  robots: { index: false, follow: false },
};

export default async function AiConversationsPage() {
  const principal = await requireAdminPage("/ai-conversations");
  if (principal.role !== "SUPER_ADMIN") redirect("/unauthorized");
  return <AiConversationConsole />;
}
