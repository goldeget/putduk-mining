import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  depositStatusLabel,
  formatKrw,
  formatKst,
  shortId,
} from "@/app/(control)/_lib/format";
import { QueueCard, QueueShell } from "@/components/queue-shell";
import {
  loadKrwDeposit,
  loadKrwDepositReceipt,
} from "@/lib/deposits/krw-queue";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { requireAdminPage } from "@/lib/auth/principal";

import { KrwDepositApproveForm } from "./approve-form";

const PENDING = new Set(["REQUESTED", "AWAITING_TRANSFER", "REVIEWING"]);

export default async function KrwDepositDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const principal = await requireAdminPage(`/deposits/krw/${id}`);
  if (!HIGH_IMPACT_ROLES.includes(principal.role)) {
    redirect("/unauthorized?code=ROLE_FORBIDDEN" as Route);
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    notFound();
  }
  const loaded = await loadKrwDeposit(id);
  if (!loaded.ok) {
    return (
      <QueueShell
        backHref={"/deposits/krw" as Route}
        backLabel="원화 입금 확인"
        eyebrow="원화 입금"
        lead="입금 내용을 불러오지 못했습니다. 잠시 후 다시 열어 주세요."
        title="입금을 불러오지 못함"
      />
    );
  }
  if (!loaded.row) notFound();
  const row = loaded.row;
  const receipt =
    row.status === "APPROVED" ? await loadKrwDepositReceipt(id) : null;
  const pending = PENDING.has(row.status);

  return (
    <div data-ui-ready="/deposits/krw/detail" data-ui-state="loaded">
      <QueueShell
        backHref={"/deposits/krw" as Route}
        backLabel="원화 입금 확인"
        eyebrow="원화 입금"
        lead="요청 내용을 확인한 뒤, 반영할 원화만 남깁니다."
        title={depositStatusLabel(row.status)}
      />
      <QueueCard tone={row.status === "APPROVED" ? "done" : "default"}>
        <header className="queue-card__head">
          <div>
            <p className="eyebrow">입금 · {shortId(row.id)}</p>
            <h2>{formatKrw(row.amount_atomic)}</h2>
          </div>
          <time dateTime={row.requested_at}>{formatKst(row.requested_at)}</time>
        </header>
        <dl className="evidence-grid">
          <div>
            <dt>회원</dt>
            <dd>
              <Link
                className="text-link"
                href={`/members?id=${row.user_id}` as Route}
              >
                {shortId(row.user_id)}
              </Link>
            </dd>
          </div>
          {row.approved_amount_atomic !== null ? (
            <div>
              <dt>반영한 원화</dt>
              <dd>{formatKrw(row.approved_amount_atomic)}</dd>
            </div>
          ) : null}
        </dl>
        {row.status === "APPROVED" ? (
          <p className="queue-flash queue-flash--ok" role="status">
            {receipt?.auditRecorded
              ? "원장에 반영되어 있습니다. 확인 기록도 있습니다."
              : "원장에 반영되어 있습니다."}
          </p>
        ) : null}
        {pending ? (
          <KrwDepositApproveForm
            depositRequestId={row.id}
            requestedAmount={String(row.amount_atomic)}
          />
        ) : null}
      </QueueCard>
    </div>
  );
}
