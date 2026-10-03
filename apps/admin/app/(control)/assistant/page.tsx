import { formatKst, formatUsdt } from "@/app/(control)/_lib/format";
import {
  OperationsAssistant,
  type AssistantTargetOption,
} from "@/components/assistant/operations-assistant";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

export default async function AssistantPage() {
  const principal = await requireAdminPage("/assistant");
  if (!HIGH_IMPACT_ROLES.includes(principal.role))
    return (
      <div data-ui-ready="/assistant" data-ui-state="unauthorized">
        <h1>운영 도우미</h1>
        <p role="status">이 역할로는 입금 처리 초안을 준비할 수 없습니다.</p>
      </div>
    );
  let options: AssistantTargetOption[] = [];
  let unavailable = false;
  try {
    const result = await createAdminServiceClient()
      .from("usdt_manual_deposits")
      .select("id,network_snapshot,sent_usdt_amount,created_at")
      .eq("status", "SUBMITTED")
      .order("created_at", { ascending: true })
      .limit(40);
    unavailable = Boolean(result.error);
    if (!unavailable)
      options = (result.data ?? []).map((row, index) => ({
        depositId: row.id,
        label: `신청 ${index + 1} · ${row.network_snapshot} · ${formatUsdt(row.sent_usdt_amount)} USDT · ${formatKst(row.created_at)}`,
      }));
  } catch {
    unavailable = true;
  }
  return (
    <div
      data-ui-ready="/assistant"
      data-ui-state={
        unavailable ? "error" : options.length ? "loaded" : "empty"
      }
    >
      <OperationsAssistant options={options} unavailable={unavailable} />
    </div>
  );
}
