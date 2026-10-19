"use client";

import { useState } from "react";

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
import {
  useReviewConfirmation,
  useReviewedAction,
} from "@/components/review-confirmation";
import { StepUpTokenField } from "@/components/step-up-token-field";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { USDT_INSTRUCTION_NETWORKS } from "@/lib/deposits/usdt-instruction-input";

import { setUsdtDepositInstructionAction } from "./instruction-actions";

export function UsdtInstructionForm() {
  const review = useReviewConfirmation([
    "network",
    "address",
    "addressRepeat",
    "reason",
  ]);
  const operationKey = useLogicalOperationKey("usdt_addr");
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const response = useReviewedAction(
    setUsdtDepositInstructionAction,
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
      <input {...response.revisionField} />
      <MoneyOperationFields operationKey={operationKey} />
      <label className="operator-field">
        <span>네트워크</span>
        <select name="network" defaultValue="TRC20" required>
          {USDT_INSTRUCTION_NETWORKS.map((network) => (
            <option key={network} value={network}>
              {network}
            </option>
          ))}
        </select>
      </label>
      <TextField
        label="새 입금 주소"
        name="address"
        placeholder="주소를 붙여 넣어 주세요"
      />
      <TextField
        label="새 입금 주소 다시 입력"
        name="addressRepeat"
        placeholder="같은 주소를 한 번 더 입력해 주세요"
      />
      <ReasonField label="변경 사유" />
      <ConfirmCheckbox
        key={`confirm-${review.revision}`}
        label="네트워크와 주소를 직접 확인했습니다. 회원 화면에 바로 보입니다."
        name="confirmation"
        value="SET_USDT_DEPOSIT_ADDRESS"
      />
      <StepUpTokenField
        key={`step-up-${review.revision}`}
        commandFamily={ADMIN_COMMAND_FAMILIES.DEPOSIT_INSTRUCTION}
      />
      <SubmitButton pendingLabel="저장 중…">입금 주소 저장</SubmitButton>
      <MoneyOfflineNote message={offlineNote} />
      <QueueFlash result={response.result} stale={response.stale} />
    </form>
  );
}
