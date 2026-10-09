"use client";

import { useState } from "react";
import { useOperatorDraft } from "@/components/assistant/operator-draft-provider";
import {
  usableOperatorDraft,
  type UsdtOperatorDraft,
} from "@/lib/assistant/draft";

import {
  bindMoneyFormSubmit,
  MoneyOfflineNote,
  MoneyOperationFields,
  useLogicalOperationKey,
} from "@/components/money-operation-form";
import {
  ConfirmCheckbox,
  ReasonField,
  SubmitButton,
  TextField,
} from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";
import { StepUpTokenField } from "@/components/step-up-token-field";
import {
  useReviewConfirmation,
  useReviewedAction,
} from "@/components/review-confirmation";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";

import { confirmUsdtManualDepositAction } from "./actions";

export function ConfirmUsdtDepositForm({ depositId }: { depositId: string }) {
  const drafts = useOperatorDraft();
  const [applied, setApplied] = useState<UsdtOperatorDraft | null>(null);
  const [appliedRevision, setAppliedRevision] = useState(0);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const available =
    drafts.draft?.input.depositId === depositId ? drafts.draft : null;
  function applyDraft() {
    const valid = usableOperatorDraft(available);
    if (!valid) {
      drafts.clear();
      setDraftNote("초안이 만료됐습니다. 다시 준비해 주세요.");
      return;
    }
    setApplied(valid);
    setAppliedRevision((value) => value + 1);
    drafts.clear();
    setDraftNote(
      "초안을 불러왔습니다. 이체 증빙과 입력 내용을 다시 확인해 주세요.",
    );
  }
  return (
    <div>
      {available ? (
        <div className="queue-flash">
          <p>도우미가 준비한 초안이 있습니다.</p>
          <button className="ghost-button" type="button" onClick={applyDraft}>
            초안 불러오기
          </button>
        </div>
      ) : null}
      {draftNote ? (
        <p className="panel-note" role="status">
          {draftNote}
        </p>
      ) : null}
      <ConfirmUsdtDepositFields
        key={appliedRevision}
        depositId={depositId}
        initial={applied?.input}
      />
    </div>
  );
}

function ConfirmUsdtDepositFields({
  depositId,
  initial,
}: {
  depositId: string;
  initial?: UsdtOperatorDraft["input"] | undefined;
}) {
  const review = useReviewConfirmation(["creditedKrw", "reason"]);
  const operationKey = useLogicalOperationKey("usdt_dep");
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const response = useReviewedAction(
    confirmUsdtManualDepositAction,
    review.revision,
  );

  return (
    <form
      action={response.action}
      className="operator-form"
      onReset={(event) => event.preventDefault()}
      onSubmit={(event) => bindMoneyFormSubmit(event, setOfflineNote)}
      onChange={review.onChange}
    >
      <input name="depositId" type="hidden" value={depositId} />
      <input {...response.revisionField} />
      <MoneyOperationFields operationKey={operationKey} />
      <TextField
        inputMode="numeric"
        label="반영할 원화 금액"
        name="creditedKrw"
        placeholder="예: 50000"
        defaultValue={initial?.creditedKrw}
      />
      <ReasonField label="확인 사유" defaultValue={initial?.reason} />
      <ConfirmCheckbox
        key={`confirm-${review.revision}`}
        label="외부 이체를 확인했고, 원화 입금만 반영합니다. 출금과는 별개입니다."
        name="confirmation"
        value="CONFIRM_USDT_DEPOSIT"
      />
      <StepUpTokenField
        key={`step-up-${review.revision}`}
        commandFamily={ADMIN_COMMAND_FAMILIES.DEPOSIT_CONFIRM}
      />
      <SubmitButton pendingLabel="확인 중…">입금 확인 · 원화 반영</SubmitButton>
      <MoneyOfflineNote message={offlineNote} />
      <QueueFlash result={response.result} stale={response.stale} />
    </form>
  );
}
