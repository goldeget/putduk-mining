import { SupportInbox } from "../../../../../components/workroom-app/support-inbox";
import { requireAdminPage } from "@/lib/auth/principal";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { z } from "zod";
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const params = await searchParams;
  const thread = z.uuid().safeParse(params.thread);
  const principal = await requireAdminPage(
    thread.success ? `/support?thread=${thread.data}` : "/support",
  );
  if (!HIGH_IMPACT_ROLES.includes(principal.role))
    return (
      <section role="alert">
        <h1>문의 관리 권한이 필요합니다.</h1>
        <p>운영 권한을 확인해 주세요.</p>
      </section>
    );
  return (
    <SupportInbox
      key={principal.adminSessionId}
      admin
      actorId={principal.userId}
      initialThread={thread.success ? thread.data : null}
    />
  );
}
