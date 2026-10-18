import { FeedbackMessage } from "../../../../../../components/ui/feedback-message";

import { formatKst } from "@/app/(control)/_lib/format";
import { QueueCard } from "@/components/queue-shell";
import { createAdminServiceClient } from "@/lib/supabase/service";
import { USDT_INSTRUCTION_NETWORKS } from "@/lib/deposits/usdt-instruction-input";

import { UsdtInstructionForm } from "./instruction-form";

type ActiveRow = {
  network: string;
  deposit_address: string;
  version: number;
  created_at: string;
};

/**
 * 회원 입금 화면이 보여 주는 USDT 입금 주소를 설정한다.
 * 현재 주소는 service 읽기로 확인하고, 저장은 서버 명령만 한다.
 * 주소는 회원에게 공개되는 안내이며 비밀 값이 아니다.
 */
export async function UsdtInstructionPanel() {
  const db = createAdminServiceClient();
  const { data, error } = await db
    .from("usdt_deposit_instructions")
    .select("network,deposit_address,version,created_at")
    .eq("is_active", true)
    .order("network", { ascending: true });
  const rows = (data ?? []) as ActiveRow[];

  return (
    <section
      className="queue-list"
      aria-label="USDT 입금 주소 설정"
      data-instruction-state={error ? "error" : rows.length ? "set" : "empty"}
    >
      <QueueCard id="usdt-deposit-instruction">
        <header className="queue-card__head">
          <div>
            <p className="eyebrow">입금 주소</p>
            <h2>회원에게 보이는 USDT 입금 주소</h2>
          </div>
        </header>

        {error ? (
          <FeedbackMessage className="queue-flash" role="alert">
            현재 주소를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.
          </FeedbackMessage>
        ) : null}

        <dl className="evidence-grid">
          {USDT_INSTRUCTION_NETWORKS.map((network) => {
            const row = rows.find((item) => item.network === network);
            return (
              <div key={network}>
                <dt>{network}</dt>
                <dd className="mono">
                  {row
                    ? `${row.deposit_address} (버전 ${row.version}, ${formatKst(row.created_at)})`
                    : "설정 안 됨"}
                </dd>
              </div>
            );
          })}
        </dl>

        <p className="panel-note">
          주소가 없는 네트워크는 회원 화면에 보이지 않습니다. 저장하면 이전
          주소는 비활성이 되고, 변경 기록과 감사 기록이 남습니다. 이 주소로 받은
          USDT는 회원 잔액이 아니며, 확인한 금액만 원화로 반영합니다.
        </p>

        <UsdtInstructionForm />
      </QueueCard>
    </section>
  );
}
