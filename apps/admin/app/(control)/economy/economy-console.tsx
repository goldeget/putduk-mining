"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useAdminPublicBrowserConfig } from "../../../components/assistant/operator-draft-provider";
import { StepUpTokenField } from "../../../components/step-up-token-field";
import { useReviewConfirmation } from "../../../components/review-confirmation";
import {
  createAdminBrowserClient,
  type AdminPublicBrowserConfig,
} from "../../../lib/supabase/browser";
import {
  formatPolicyBps,
  readPolicySettings,
} from "../../../lib/economy/editor-input";
import {
  ECONOMY_STATE_LABELS,
  type EconomyConsoleView,
  type EconomyOperation,
  type EconomySettings,
} from "../../../lib/economy/types";
import { PolicyReadPanel } from "./policy-read-panel";
import styles from "./economy.module.css";

const campaignLabels: Record<keyof EconomySettings["campaign"], string> = {
  defaultCapacityBoostBps: "기본 한도 추가 (%)",
  maximumSingleCapacityBoostBps: "캠페인 한 건 한도 추가 (%)",
  maximumCombinedCapacityBoostBps: "동시 캠페인 한도 추가 (%)",
  defaultSpeedMultiplierBps: "기본 속도 배율",
  maximumSingleSpeedMultiplierBps: "캠페인 한 건 속도 배율",
  maximumCombinedSpeedMultiplierBps: "동시 캠페인 속도 배율",
};
const feeLabels: Record<keyof EconomySettings["platformFeesKrw"], string> = {
  krwDeposit: "원화 입금",
  usdtDepositConversion: "USDT 입금 환산",
  mining: "채굴",
  krwMiningRewardWithdrawal: "채굴 수익 출금",
  principalRecovery: "원금 회수",
};
function formatDate(value: string | null) {
  if (!value) return "아직 지정하지 않음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
function formatMoney(value: string) {
  return `${BigInt(value).toLocaleString("ko-KR")}원`;
}
function Field({
  label,
  name,
  value,
  suffix,
}: {
  label: string;
  name: string;
  value: string | number;
  suffix?: string;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <span className={styles.inputRow}>
        <input
          name={name}
          defaultValue={value}
          inputMode={name === "policyVersion" ? "text" : "decimal"}
          required
          autoComplete="off"
          pattern={
            name === "policyVersion" ? "[A-Z][A-Z0-9._\\-]{2,99}" : undefined
          }
          maxLength={name === "policyVersion" ? 100 : undefined}
          onInvalid={(event) => {
            const details = event.currentTarget.closest("details");
            if (details) details.open = true;
          }}
        />
        <small>{suffix}</small>
      </span>
    </label>
  );
}
function Proof({ busy, revision }: { busy: boolean; revision: number }) {
  return (
    <div className={styles.proof}>
      <label className={styles.field}>
        <span>작업 사유</span>
        <textarea
          name="reason"
          minLength={10}
          maxLength={500}
          required
          placeholder="변경 목적과 검토한 내용을 적어 주세요."
          rows={3}
        />
      </label>
      <label className={styles.confirm} key={`confirm-${revision}`}>
        <input type="checkbox" name="confirmation" required />
        <span>정책 값과 적용 시간을 확인했습니다.</span>
      </label>
      <StepUpTokenField
        key={`step-up-${revision}`}
        commandFamily="ECONOMY_POLICY"
        submissionPending={busy}
      />
    </div>
  );
}

type PendingRequest = {
  key: string;
  body: string;
  policyVersion: string;
  operation: EconomyOperation;
};
export function EconomyConsole({
  initial,
  publicConfig: initialPublicConfig,
}: {
  initial: EconomyConsoleView;
  publicConfig: AdminPublicBrowserConfig;
}) {
  const publicConfig = useAdminPublicBrowserConfig() ?? initialPublicConfig;
  const selectedReview = useReviewConfirmation(["effectiveFrom", "reason"]);
  const createReview = useReviewConfirmation();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false);
  const [attemptedVersion, setAttemptedVersion] = useState(
    initial.selectedVersion.policyVersion,
  );
  const inFlight = useRef(false);
  const request = useRef<PendingRequest | null>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const status = useRef<HTMLParagraphElement>(null);
  const selected = view.selectedVersion;
  const settings = selected.settings;
  const revision = selected.latestRevision;
  const next = {
    DRAFT: "PREVIEW",
    PREVIEWED: "APPROVE",
    APPROVED: "PUBLISH",
    PUBLISHED: null,
  }[revision.state] as Exclude<EconomyOperation, "CREATE"> | null;

  useEffect(() => {
    alive.current = true;
    let unsubscribe: (() => void) | undefined;
    function invalidateSession() {
      controller.current?.abort();
      controller.current = null;
      request.current = null;
      setSessionChanged(true);
      setUncertain(false);
      setMessage(
        "로그인 정보가 바뀌었습니다. 저장된 결과를 다시 열어 확인해 주세요.",
      );
    }
    try {
      const listener = createAdminBrowserClient(
        publicConfig,
      ).auth.onAuthStateChange((event) => {
        if (event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
        invalidateSession();
      });
      unsubscribe = () => listener.data.subscription.unsubscribe();
    } catch {
      invalidateSession();
    }
    return () => {
      alive.current = false;
      controller.current?.abort();
      request.current = null;
      unsubscribe?.();
    };
  }, [publicConfig]);

  async function send(job: PendingRequest) {
    if (inFlight.current || sessionChanged) return;
    if (!navigator.onLine) {
      setMessage("연결이 끊겼습니다. 다시 연결된 뒤 직접 눌러 주세요.");
      return;
    }
    inFlight.current = true;
    setAttemptedVersion(job.policyVersion);
    setBusy(true);
    setMessage("작업 결과를 확인하고 있습니다.");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 20_000);
    try {
      const result = await fetch("/api/v1/admin/economy/command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": job.key,
          "x-putduk-client-online": "1",
        },
        body: job.body,
        signal: abort.signal,
      });
      const payload = (await result.json().catch(() => null)) as {
        data?: { confirmed?: boolean; console?: EconomyConsoleView };
        error?: { message?: string; code?: string };
      } | null;
      if (!alive.current || controller.current !== abort) return;
      if (
        result.ok &&
        payload?.data?.confirmed === true &&
        payload.data.console?.selectedVersion.policyVersion ===
          job.policyVersion
      ) {
        setView(payload.data.console);
        setMessage("저장된 정책과 검토 기록을 확인했습니다.");
        setUncertain(false);
        request.current = null;
        setEditing(false);
      } else if (result.status >= 400 && result.status < 500) {
        setMessage(
          payload?.error?.message ??
            "입력값과 현재 정책 상태를 다시 확인해 주세요.",
        );
        request.current = null;
        setUncertain(false);
        if (
          result.status === 401 ||
          /ADMIN_ACCESS_EXPIRED|ADMIN_SESSION|MFA_REQUIRED|ROLE_FORBIDDEN|ROLE_REQUIRED/.test(
            payload?.error?.code ?? "",
          )
        )
          setSessionChanged(true);
      } else {
        setMessage(
          payload?.error?.message ??
            "결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
        );
        setUncertain(true);
      }
    } catch {
      if (alive.current && controller.current === abort) {
        setMessage(
          "결과를 받지 못했습니다. 새 요청을 만들지 않고 같은 요청으로 확인해 주세요.",
        );
        setUncertain(true);
      }
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = false;
      if (alive.current) {
        setBusy(false);
        status.current?.focus();
      }
      if (controller.current === abort) controller.current = null;
    }
  }

  function submit(
    event: FormEvent<HTMLFormElement>,
    operation: EconomyOperation,
  ) {
    event.preventDefault();
    if (busy || uncertain || sessionChanged || inFlight.current) return;
    const form = new FormData(event.currentTarget);
    if (form.get("confirmation") !== "on") {
      setMessage("입력 내용과 적용 시간을 확인한 뒤 체크해 주세요.");
      return;
    }
    const token = String(form.get("stepUpToken") ?? "");
    if (token.length < 16) {
      setMessage("인증 앱 코드로 작업 확인을 먼저 완료해 주세요.");
      status.current?.focus();
      return;
    }
    try {
      const policyVersion =
        operation === "CREATE"
          ? String(form.get("policyVersion") ?? "").trim()
          : selected.policyVersion;
      const common = {
        operation,
        policyVersion,
        reason: String(form.get("reason") ?? "").trim(),
        stepUpToken: token,
        confirmation: "CONFIRM_ECONOMY_POLICY",
      };
      const input =
        operation === "CREATE"
          ? { ...common, settings: readPolicySettings(form, settings) }
          : {
              ...common,
              expectedRevision: revision.revisionId,
              expectedDigest: selected.configDigest,
              effectiveFrom:
                operation === "PREVIEW"
                  ? new Date(
                      `${String(form.get("effectiveFrom") ?? "")}:00+09:00`,
                    ).toISOString()
                  : revision.effectiveFrom,
            };
      const job = {
        key: `economy_${crypto.randomUUID()}`,
        body: JSON.stringify(input),
        policyVersion,
        operation,
      };
      request.current = job;
      void send(job);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "입력 내용을 확인해 주세요.",
      );
      status.current?.focus();
    }
  }

  const label =
    next === "PREVIEW"
      ? "적용 전 검토"
      : next === "APPROVE"
        ? "정책 승인"
        : "발행 예약";
  const disabled = busy || uncertain || sessionChanged;
  return (
    <>
      <section className={styles.notice} aria-label="정책 적용 안내">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path
            d="M16 3 28 8v8c0 7-7 11-12 13C11 27 4 23 4 16V8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M16 10v8m0 4h.01"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <div>
          <strong>정책 발행과 실제 정산은 별개입니다</strong>
          <p>
            예약한 정책은 채굴·정산에 아직 반영되지 않습니다. 완료된 정산과 기존
            원금은 이 화면에서 바뀌지 않습니다.
          </p>
        </div>
      </section>
      <p
        ref={status}
        className={styles.result}
        role="status"
        aria-live="polite"
        tabIndex={-1}
      >
        {message || "저장된 정책을 확인한 뒤 새 버전으로 작성해 주세요."}
      </p>
      {sessionChanged ? (
        <Link href={"/economy" as Route} className="ghost-button">
          저장된 정책 다시 열기
        </Link>
      ) : null}
      {uncertain ? (
        <div className={styles.recovery}>
          <button
            type="button"
            className="gold-button"
            disabled={busy}
            onClick={() => {
              if (request.current) void send(request.current);
            }}
          >
            결과 다시 확인
          </button>
          <Link
            href={
              `/economy?version=${encodeURIComponent(attemptedVersion)}` as Route
            }
          >
            저장된 정책 보기
          </Link>
        </div>
      ) : null}
      <div className={styles.columns}>
        <section className={styles.panel} aria-label="선택한 정책">
          <div className={styles.panelHead}>
            <div>
              <p className="eyebrow">저장된 버전</p>
              <h2>{selected.policyVersion}</h2>
            </div>
            <span className={styles.badge}>
              {ECONOMY_STATE_LABELS[revision.state]}
            </span>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>최소 원금</dt>
              <dd>{formatMoney(settings.minimumPrincipalKrw)}</dd>
            </div>
            <div>
              <dt>정산 주기</dt>
              <dd>{settings.cycleDays}일</dd>
            </div>
            <div>
              <dt>기본 비율</dt>
              <dd>{formatPolicyBps(settings.baseCycleRateBps, 2)}%</dd>
            </div>
            <div>
              <dt>적용 예정 · 한국 시간</dt>
              <dd>{formatDate(revision.effectiveFrom)}</dd>
            </div>
          </dl>
          <ol className={styles.history} aria-label="검토 및 발행 기록">
            {selected.history.map((item) => (
              <li key={item.revisionId}>
                <span className={styles.historyDot} aria-hidden="true" />
                <div>
                  <strong>{ECONOMY_STATE_LABELS[item.state]}</strong>
                  <p>
                    <time dateTime={item.createdAt}>
                      {formatDate(item.createdAt)}
                    </time>
                  </p>
                  <p>
                    {item.effectiveFrom
                      ? `적용 예정 ${formatDate(item.effectiveFrom)}`
                      : "새 버전으로 저장"}
                  </p>
                </div>
                <span>{item.revision}차</span>
              </li>
            ))}
          </ol>
          {next ? (
            <form
              key={revision.revisionId}
              onSubmit={(event) => submit(event, next)}
              onChange={selectedReview.onChange}
              aria-label={label}
            >
              <fieldset disabled={disabled}>
                <legend>{label}</legend>
                {next === "PREVIEW" ? (
                  <label className={styles.field}>
                    <span>적용 예정 시간 (한국 시간)</span>
                    <input
                      type="datetime-local"
                      name="effectiveFrom"
                      required
                    />
                    <small>마지막 예약 이후의 미래 시간을 지정해 주세요.</small>
                  </label>
                ) : (
                  <p className={styles.note}>
                    검토한 정책 값과 {formatDate(revision.effectiveFrom)}을
                    그대로 확인합니다.
                  </p>
                )}
                <Proof busy={busy} revision={selectedReview.revision} />
                <button className="gold-button" type="submit">
                  {busy ? "결과 확인 중" : label}
                </button>
              </fieldset>
            </form>
          ) : (
            <p className={styles.note}>
              발행된 버전은 수정하지 않습니다. 변경하려면 새 버전을 작성해
              주세요.
            </p>
          )}
        </section>
        <section className={styles.panel} aria-label="저장된 정책 목록">
          <div className={styles.panelHead}>
            <h2>정책 목록</h2>
            <span className={styles.badge}>{view.versions.length}개</span>
          </div>
          <p className={styles.note}>
            최근 100개 버전입니다. 적용 시간을 지난 정책만 현재 정책으로
            조회됩니다.
          </p>
          <ul className={styles.versionList}>
            {view.versions.map((item) => (
              <li key={item.policyId}>
                <Link
                  href={
                    `/economy?version=${encodeURIComponent(item.policyVersion)}` as Route
                  }
                  aria-current={
                    item.policyVersion === selected.policyVersion
                      ? "page"
                      : undefined
                  }
                >
                  <strong>{item.policyVersion}</strong>
                  <span>{ECONOMY_STATE_LABELS[item.state]}</span>
                  <small>{formatDate(item.effectiveFrom)}</small>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <PolicyReadPanel view={view} />
      <section className={styles.panel} aria-label="새 정책 버전 작성">
        <div className={styles.panelHead}>
          <div>
            <p className="eyebrow">변경은 새 버전으로</p>
            <h2>새 정책 작성</h2>
          </div>
          <button
            className="ghost-button"
            type="button"
            disabled={disabled}
            onClick={() => setEditing(!editing)}
            aria-expanded={editing}
          >
            {editing ? "입력 접기" : "새 버전 작성"}
          </button>
        </div>
        <p className={styles.note}>
          선택한 버전을 바탕으로 작성합니다. 기존 값과 발행 기록은 보존합니다.
        </p>
        {editing ? (
          <form
            key={`new:${revision.revisionId}`}
            onSubmit={(event) => submit(event, "CREATE")}
            onChange={createReview.onChange}
            aria-label="새 정책 저장"
          >
            <fieldset disabled={disabled}>
              <legend>새 버전 값</legend>
              <p className={styles.note}>
                영문 대문자로 시작해 주세요. 대문자·숫자·점·밑줄·하이픈으로
                3~100자까지 입력합니다.
              </p>
              <div className={styles.fieldGrid}>
                <Field label="새 버전 이름" name="policyVersion" value="" />
                <Field
                  label="최소 원금"
                  name="minimumPrincipalKrw"
                  value={settings.minimumPrincipalKrw}
                  suffix="원"
                />
                <Field
                  label="정산 주기"
                  name="cycleDays"
                  value={settings.cycleDays}
                  suffix="일"
                />
                <Field
                  label="기본 비율"
                  name="baseCycleRateBps"
                  value={formatPolicyBps(settings.baseCycleRateBps, 2)}
                  suffix="%"
                />
              </div>
              <h3>원금 등급</h3>
              <p className={styles.note}>
                금액은 쉼표 없이 입력합니다. 다음 등급은 이전 상한의 다음 원에서
                시작합니다.
              </p>
              <div className={styles.tiers}>
                {settings.tiers.map((row, index) => (
                  <section className={styles.tier} key={row.code}>
                    <h4>
                      {row.code} <span>{row.name}</span>
                    </h4>
                    <div className={styles.fieldGrid}>
                      <Field
                        label={`${row.code} 원금 하한`}
                        name={`tier.${index}.minimum`}
                        value={row.minimumPrincipalKrw}
                        suffix="원"
                      />
                      {row.maximumPrincipalKrw === null ? (
                        <p className={styles.note}>원금 상한 없음</p>
                      ) : (
                        <Field
                          label={`${row.code} 원금 상한`}
                          name={`tier.${index}.maximum`}
                          value={row.maximumPrincipalKrw}
                          suffix="원"
                        />
                      )}
                      <Field
                        label={`${row.code} 유지 혜택 비율`}
                        name={`tier.${index}.retention`}
                        value={formatPolicyBps(row.retentionBonusBps, 2)}
                        suffix="%"
                      />
                      <Field
                        label={`${row.code} 동시 상품 수`}
                        name={`tier.${index}.slots`}
                        value={row.slots}
                        suffix="개"
                      />
                    </div>
                  </section>
                ))}
              </div>
              <details className={styles.details}>
                <summary>상품 배율과 배분</summary>
                <p className={styles.note}>
                  배율 1.0000은 기본 값입니다. 전체 상품 배분은 100%를 넘을 수
                  없습니다.
                </p>
                <div className={styles.fieldGrid}>
                  {(["minimumBps", "defaultBps", "maximumBps"] as const).map(
                    (key, index) => (
                      <Field
                        key={key}
                        label={`상품 ${["최소", "기본", "최대"][index]} 배율`}
                        name={`product.${key}`}
                        value={formatPolicyBps(
                          settings.productMultiplier[key],
                          4,
                        )}
                        suffix="배"
                      />
                    ),
                  )}
                  <Field
                    label="전체 상품 배분 상한"
                    name="allocation.maximumTotalBps"
                    value={formatPolicyBps(
                      settings.allocation.maximumTotalBps,
                      2,
                    )}
                    suffix="%"
                  />
                  <Field
                    label="상품 한 개 배분 상한"
                    name="allocation.maximumPerProductBps"
                    value={formatPolicyBps(
                      settings.allocation.maximumPerProductBps,
                      2,
                    )}
                    suffix="%"
                  />
                </div>
              </details>
              <details className={styles.details}>
                <summary>캠페인과 개별 조정</summary>
                <div className={styles.fieldGrid}>
                  {(
                    Object.keys(
                      campaignLabels,
                    ) as (keyof EconomySettings["campaign"])[]
                  ).map((key) => (
                    <Field
                      key={key}
                      label={campaignLabels[key]}
                      name={`campaign.${key}`}
                      value={formatPolicyBps(
                        settings.campaign[key],
                        key.includes("Speed") ? 4 : 2,
                      )}
                      suffix={key.includes("Speed") ? "배" : "%"}
                    />
                  ))}
                  {(
                    [
                      "minimumMultiplierBps",
                      "defaultMultiplierBps",
                      "maximumMultiplierBps",
                    ] as const
                  ).map((key, index) => (
                    <Field
                      key={key}
                      label={`개별 조정 ${["최소", "기본", "최대"][index]} 배율`}
                      name={`override.${key}`}
                      value={formatPolicyBps(settings.userOverride[key], 4)}
                      suffix="배"
                    />
                  ))}
                </div>
              </details>
              <details className={styles.details}>
                <summary>작업별 수수료</summary>
                <p className={styles.note}>
                  수수료는 해당 작업의 자금에서만 사용합니다. 원금·채굴
                  수익·혜택을 대신 사용하지 않습니다.
                </p>
                <div className={styles.fieldGrid}>
                  {(
                    Object.keys(
                      feeLabels,
                    ) as (keyof EconomySettings["platformFeesKrw"])[]
                  ).map((key) => (
                    <Field
                      key={key}
                      label={feeLabels[key]}
                      name={`fee.${key}`}
                      value={settings.platformFeesKrw[key]}
                      suffix="원"
                    />
                  ))}
                </div>
              </details>
              <Proof busy={busy} revision={createReview.revision} />
              <button className="gold-button" type="submit">
                새 정책 저장
              </button>
            </fieldset>
          </form>
        ) : null}
      </section>
    </>
  );
}
