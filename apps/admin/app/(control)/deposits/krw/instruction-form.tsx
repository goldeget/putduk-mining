"use client";
import { useState } from "react";
import type { KrwDepositSettings } from "../../../../../../domain/wallet/krw-deposit-settings";
import {
  MoneyOperationFields,
  MoneyOfflineNote,
  bindMoneyFormSubmit,
  useLogicalOperationKey,
} from "@/components/money-operation-form";
import {
  ConfirmCheckbox,
  ReasonField,
  SubmitButton,
} from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";
import {
  useReviewConfirmation,
  useReviewedAction,
} from "@/components/review-confirmation";
import { StepUpTokenField } from "@/components/step-up-token-field";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { setKrwDepositSettingsAction } from "./instruction-actions";

export function KrwInstructionForm({
  settings,
}: {
  settings: KrwDepositSettings;
}) {
  const [mode, setMode] = useState(settings.mode);
  const [bank, setBank] = useState(settings.bank_name);
  const [number, setNumber] = useState(settings.account_number);
  const [holder, setHolder] = useState(settings.account_holder);
  const [message, setMessage] = useState(settings.contact_message);
  const review = useReviewConfirmation([
    "mode",
    "bank_name",
    "account_number",
    "account_holder",
    "contact_message",
    "reason",
  ]);
  const response = useReviewedAction(
    setKrwDepositSettingsAction,
    review.revision,
  );
  const operationKey = useLogicalOperationKey("krw_instruction");
  const [offline, setOffline] = useState<string | null>(null);
  return (
    <form
      action={response.action}
      className="operator-form"
      onChange={review.onChange}
      onReset={(event) => event.preventDefault()}
      onSubmit={(event) => bindMoneyFormSubmit(event, setOffline)}
    >
      <input {...response.revisionField} />
      <MoneyOperationFields operationKey={operationKey} />
      <input type="hidden" name="version" value={settings.version} />
      <label className="operator-field">
        <span>회원에게 표시할 방식</span>
        <select
          name="mode"
          value={mode}
          onChange={(e) =>
            setMode(e.target.value as KrwDepositSettings["mode"])
          }
        >
          <option value="CONTACT">상담 후 계좌 안내</option>
          <option value="ACCOUNT">회사 입금 계좌 표시</option>
        </select>
      </label>
      {mode === "ACCOUNT" ? (
        <>
          <label className="operator-field">
            <span>은행명</span>
            <input
              name="bank_name"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              required
              minLength={2}
              maxLength={30}
            />
          </label>
          <label className="operator-field">
            <span>계좌번호</span>
            <input
              name="account_number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              inputMode="numeric"
              required
              maxLength={30}
            />
          </label>
          <label className="operator-field">
            <span>예금주</span>
            <input
              name="account_holder"
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              required
              minLength={2}
              maxLength={40}
            />
          </label>
        </>
      ) : null}
      <label className="operator-field">
        <span>상담 안내 문구</span>
        <input
          name="contact_message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          minLength={2}
          maxLength={200}
        />
      </label>
      <aside className="detail-panel" aria-label="회원 화면 미리보기">
        <p className="eyebrow">회원 화면 미리보기</p>
        {mode === "ACCOUNT" ? (
          <dl className="evidence-grid">
            <div>
              <dt>은행</dt>
              <dd>{bank || "은행명"}</dd>
            </div>
            <div>
              <dt>계좌번호</dt>
              <dd>{number || "계좌번호"}</dd>
            </div>
            <div>
              <dt>예금주</dt>
              <dd>{holder || "예금주"}</dd>
            </div>
          </dl>
        ) : (
          <h3>{message || "1:1 상담 후 계좌 발급"}</h3>
        )}
      </aside>
      <ReasonField label="변경 사유" />
      <ConfirmCheckbox
        key={`confirm-${review.revision}`}
        name="confirmation"
        value="SET_KRW_DEPOSIT_SETTINGS"
        label="회원에게 표시할 계좌 또는 상담 안내를 확인했습니다."
      />
      <StepUpTokenField
        key={`step-${review.revision}`}
        commandFamily={ADMIN_COMMAND_FAMILIES.DEPOSIT_INSTRUCTION}
      />
      <SubmitButton pendingLabel="저장 중…">입금 안내 저장</SubmitButton>
      <MoneyOfflineNote message={offline} />
      <QueueFlash result={response.result} stale={response.stale} />
    </form>
  );
}
