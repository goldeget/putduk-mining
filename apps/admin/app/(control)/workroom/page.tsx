import { requireAdminPage } from "@/lib/auth/principal";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { WorkroomConsole } from "./console";
export default async function WorkroomAdminPage() {
  const principal = await requireAdminPage("/workroom");
  if (!HIGH_IMPACT_ROLES.includes(principal.role))
    return (
      <section role="alert">
        <h1>워크룸 운영 권한이 필요합니다.</h1>
        <p>현재 보안 계정에는 체험 조건과 포인트를 관리할 권한이 없습니다.</p>
      </section>
    );
  return <WorkroomConsole actorId={principal.userId} />;
}
