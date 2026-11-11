import { krwDepositSettingsSchema } from "../../../../../../domain/wallet/krw-deposit-settings";
import { createAdminServiceClient } from "@/lib/supabase/service";
import { QueueCard } from "@/components/queue-shell";
import { KrwInstructionForm } from "./instruction-form";

export async function KrwInstructionPanel() {
  const { data, error } = await createAdminServiceClient()
    .from("krw_deposit_settings")
    .select(
      "mode,bank_name,account_number,account_holder,contact_message,version",
    )
    .eq("id", true)
    .maybeSingle();
  const parsed = krwDepositSettingsSchema.safeParse(data);
  return (
    <section className="queue-list" aria-label="회원 입금 안내 설정">
      <QueueCard id="krw-deposit-instruction">
        <header className="queue-card__head">
          <div>
            <p className="eyebrow">입금 안내 관리</p>
            <h2>회원에게 보이는 회사 계좌와 상담 안내</h2>
          </div>
        </header>
        <p className="panel-note">
          계좌 표시와 상담 안내 중 선택할 수 있습니다. 저장한 내용은 회원 입금
          화면에 반영되며 변경 이력이 남습니다.
        </p>
        {error || !parsed.success ? (
          <p role="alert">
            현재 입금 안내를 불러오지 못했습니다. 다시 불러온 뒤 변경해 주세요.
          </p>
        ) : (
          <KrwInstructionForm settings={parsed.data} />
        )}
      </QueueCard>
    </section>
  );
}
