"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestKyc } from "@/lib/kyc/client-request";
import styles from "./kyc-intake.module.css";

const STATUS_COPY = {
  PENDING: "서류 제출 준비",
  IN_REVIEW: "제출 서류를 확인하고 있어요",
  APPROVED: "본인 확인 완료",
  ON_HOLD: "추가 확인 중",
  REJECTED: "다시 확인이 필요해요",
  REQUIRES_RESUBMISSION: "서류를 다시 제출해 주세요",
} as const;
type Case = { id: string; status: keyof typeof STATUS_COPY };
type Submission = { key: string; caseId: string; file: File | null };
type Attempt = {
  requestId: string;
  caseId: string;
  createdAt: string;
  state: "PENDING";
  closed: boolean;
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOOKMARK = "putduk:kyc:pending:v1";
function rememberAttempt(value: { key: string; caseId: string } | null) {
  if (value)
    sessionStorage.setItem(
      BOOKMARK,
      JSON.stringify({ key: value.key, caseId: value.caseId }),
    );
  else sessionStorage.removeItem(BOOKMARK);
}
function rememberedAttempt(): { key: string; caseId: string } | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(BOOKMARK);
  } catch {
    return null;
  }
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !("key" in value) ||
    typeof value.key !== "string" ||
    !UUID.test(value.key) ||
    !("caseId" in value) ||
    typeof value.caseId !== "string" ||
    !UUID.test(value.caseId)
  )
    throw new Error("KYC_RECOVERY_UNCONFIRMED");
  return { key: value.key, caseId: value.caseId };
}
function dataOf(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    !("data" in value) ||
    !value.data ||
    typeof value.data !== "object"
  )
    throw new Error("KYC_RESULT_UNCONFIRMED");
  return value.data as Record<string, unknown>;
}
function caseOf(value: unknown): Case | null {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    !("status" in value) ||
    typeof value.status !== "string" ||
    !Object.hasOwn(STATUS_COPY, value.status)
  )
    throw new Error("KYC_STATE_UNCONFIRMED");
  return { id: value.id, status: value.status as Case["status"] };
}

/** Cloud intake restored, with independent durable-receipt and cancellation recovery. */
export function KycIntake() {
  const [current, setCurrent] = useState<Case | null>(null);
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [incomplete, setIncomplete] = useState(false);
  const [submissionIdentity, setSubmissionIdentity] = useState<Pick<
    Submission,
    "key" | "caseId"
  > | null>(null);
  const mounted = useRef(false);
  const active = useRef<AbortController | null>(null);
  const operation = useRef(false);
  const openKey = useRef<string | null>(null);
  const submission = useRef<Submission | null>(null);
  const updateSubmission = useCallback((value: Submission | null) => {
    submission.current = value;
    setSubmissionIdentity(
      value ? { key: value.key, caseId: value.caseId } : null,
    );
  }, []);

  const readCurrent = useCallback(
    async (signal: AbortSignal) => {
      const [result, recovery] = await Promise.all([
        requestKyc("/api/v1/kyc", { cache: "no-store", signal }),
        requestKyc("/api/v1/kyc/documents", { cache: "no-store", signal }),
      ]);
      if (!result.response.ok || !recovery.response.ok)
        throw new Error("KYC_READ_FAILED");
      const row = caseOf(dataOf(result.payload).case);
      const recovered = dataOf(recovery.payload);
      if (
        !Array.isArray(recovered.attempts) ||
        typeof recovered.incomplete !== "boolean"
      )
        throw new Error("KYC_RECOVERY_UNCONFIRMED");
      const pending = recovered.attempts.map((value: unknown): Attempt => {
        if (
          !value ||
          typeof value !== "object" ||
          !("requestId" in value) ||
          typeof value.requestId !== "string" ||
          !UUID.test(value.requestId) ||
          !("caseId" in value) ||
          typeof value.caseId !== "string" ||
          !UUID.test(value.caseId) ||
          !("createdAt" in value) ||
          typeof value.createdAt !== "string" ||
          !("state" in value) ||
          value.state !== "PENDING" ||
          !("closed" in value) ||
          typeof value.closed !== "boolean"
        )
          throw new Error("KYC_RECOVERY_UNCONFIRMED");
        return {
          requestId: value.requestId,
          caseId: value.caseId,
          createdAt: value.createdAt,
          state: "PENDING",
          closed: value.closed,
        };
      });
      if (!signal.aborted && mounted.current) {
        setCurrent(row);
        setReadFailed(false);
        setAttempts(pending);
        setIncomplete(recovered.incomplete);
        const bookmark = rememberedAttempt();
        if (!submission.current && (pending.length || bookmark)) {
          const previous = bookmark
            ? { requestId: bookmark.key, caseId: bookmark.caseId }
            : (pending.find((item) => item.caseId === row?.id) ?? pending[0]);
          if (!previous) throw new Error("KYC_RECOVERY_UNCONFIRMED");
          updateSubmission({
            key: previous.requestId,
            caseId: previous.caseId,
            file: null,
          });
          setUncertain(true);
          setFile(null);
          setMessage(
            "확인하지 못한 제출 요청이 있어요. 먼저 결과를 확인하거나 같은 원본 서류를 선택해 주세요.",
          );
        }
      }
    },
    [updateSubmission],
  );
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    active.current = controller;
    void readCurrent(controller.signal)
      .catch(() => {
        if (!controller.signal.aborted && mounted.current) {
          setReadFailed(true);
          setMessage(
            "본인 확인 상태를 불러오지 못했어요. 연결을 확인하고 다시 불러와 주세요.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
      active.current?.abort();
    };
  }, [readCurrent]);

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (operation.current || loading) return;
    operation.current = true;
    setPending(true);
    const controller = new AbortController();
    active.current = controller;
    try {
      await work(controller.signal);
    } finally {
      operation.current = false;
      if (mounted.current) setPending(false);
      if (active.current === controller) active.current = null;
    }
  }
  async function open() {
    if (
      readFailed ||
      incomplete ||
      attempts.length ||
      submission.current ||
      (current && current.status !== "REJECTED")
    )
      return;
    await run(async (signal) => {
      setMessage("");
      openKey.current ??= crypto.randomUUID();
      try {
        const { response, payload } = await requestKyc("/api/v1/kyc", {
          method: "POST",
          headers: { "Idempotency-Key": openKey.current },
          signal,
        });
        const id = dataOf(payload).caseId;
        if (!response.ok || typeof id !== "string" || !UUID.test(id))
          throw new Error("KYC_OPEN_UNCONFIRMED");
        await readCurrent(signal);
        if (mounted.current && !signal.aborted) openKey.current = null;
      } catch {
        if (mounted.current && !signal.aborted)
          setMessage(
            "시작 결과를 확인하지 못했어요. 현재 상태를 확인한 뒤 다시 시도해 주세요.",
          );
      }
    });
  }
  async function receiptConfirmed(signal: AbortSignal) {
    const attempt = submission.current;
    if (!attempt) return false;
    const { response, payload } = await requestKyc("/api/v1/kyc/documents", {
      headers: {
        "Idempotency-Key": attempt.key,
        "Kyc-Case-Id": attempt.caseId,
      },
      cache: "no-store",
      signal,
    });
    if (
      response.status === 404 &&
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "code" in payload.error &&
      payload.error.code === "KYC_REQUEST_NOT_OWNED"
    ) {
      // A bookmark from another signed-in account is never an admission for this owner.
      if (mounted.current && !signal.aborted) {
        rememberAttempt(null);
        updateSubmission(null);
        setUncertain(false);
        setFile(null);
      }
      return true;
    }
    if (!response.ok) throw new Error("KYC_RECEIPT_UNCONFIRMED");
    const receipt = dataOf(payload).receipt;
    if (receipt === null) return false;
    if (
      !receipt ||
      typeof receipt !== "object" ||
      !("caseId" in receipt) ||
      receipt.caseId !== attempt.caseId
    )
      throw new Error("KYC_RECEIPT_UNCONFIRMED");
    const closed = "state" in receipt && receipt.state === "CLOSED";
    if (
      !closed &&
      (!("submissionId" in receipt) ||
        typeof receipt.submissionId !== "string" ||
        !UUID.test(receipt.submissionId))
    )
      throw new Error("KYC_RECEIPT_UNCONFIRMED");
    if (mounted.current && !signal.aborted) {
      rememberAttempt(null);
      updateSubmission(null);
      setUncertain(false);
      setFile(null);
      setAttempts((rows) =>
        rows.filter((row) => row.requestId !== attempt.key),
      );
      setMessage(
        closed
          ? "이전 요청은 서류가 접수되지 않은 채 종료됐어요. 현재 상태에서 다시 진행할 수 있어요."
          : "서류 제출을 확인했어요. 검토가 끝나면 상태가 바뀌어요.",
      );
    }
    return true;
  }
  async function submit() {
    if (!file || (!current && !submission.current) || readFailed || incomplete)
      return;
    if (!navigator.onLine) {
      setMessage("연결이 끊겼어요. 다시 연결한 뒤 제출해 주세요.");
      return;
    }
    await run(async (signal) => {
      setMessage("");
      if (!submission.current) {
        if (!current || attempts.length) return;
        updateSubmission({
          key: crypto.randomUUID(),
          caseId: current.id,
          file,
        });
      }
      const attempt = submission.current;
      if (!attempt) return;
      try {
        try {
          rememberAttempt(attempt);
        } catch {
          // A fresh mutation is never dispatched without reload recovery.
          if (!uncertain) updateSubmission(null);
          setMessage(
            "브라우저 설정을 확인한 뒤 다시 시도해 주세요. 서류를 새로 보내지 않았어요.",
          );
          return;
        }
        if (uncertain && (await receiptConfirmed(signal))) {
          await readCurrent(signal);
          return;
        }
        if (!attempt.file) throw new Error("KYC_ORIGINAL_FILE_REQUIRED");
        const body = new FormData();
        body.set("caseId", attempt.caseId);
        body.set("documentKind", "IDENTITY_DOCUMENT");
        body.set("file", attempt.file);
        const { response, payload } = await requestKyc(
          "/api/v1/kyc/documents",
          {
            method: "POST",
            headers: { "Idempotency-Key": attempt.key },
            body,
            signal,
          },
        );
        if (response.status === 400) {
          if (mounted.current && !signal.aborted) {
            if (!uncertain) {
              rememberAttempt(null);
              updateSubmission(null);
              setUncertain(false);
            } else if (submission.current)
              updateSubmission({ ...submission.current, file: null });
            setFile(null);
            setMessage("5MB 이하의 사진(JPG·PNG) 또는 PDF를 선택해 주세요.");
          }
          return;
        }
        if (
          response.status === 409 &&
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          payload.error &&
          typeof payload.error === "object" &&
          "code" in payload.error &&
          payload.error.code === "KYC_IDEMPOTENCY_CONFLICT"
        ) {
          if (mounted.current && !signal.aborted && submission.current) {
            // Keep the opaque operation identity, but allow choosing its original
            // bytes after an accidental different-file selection on reload.
            updateSubmission({ ...submission.current, file: null });
            setFile(null);
            setUncertain(true);
            setMessage(
              "이 요청의 원본 서류와 달라요. 처음 보낸 원본 서류를 다시 선택해 주세요.",
            );
          }
          return;
        }
        const id = dataOf(payload).submissionId;
        if (!response.ok || typeof id !== "string" || !UUID.test(id))
          throw new Error("KYC_SUBMIT_UNCONFIRMED");
        if (mounted.current && !signal.aborted) {
          rememberAttempt(null);
          updateSubmission(null);
          setUncertain(false);
          setFile(null);
          setMessage("서류를 제출했어요. 검토가 끝나면 상태가 바뀌어요.");
        }
        await readCurrent(signal);
      } catch {
        if (mounted.current && !signal.aborted) {
          // A successful submission followed by a failed status read remains confirmed.
          if (submission.current) {
            setUncertain(true);
            setMessage(
              "제출 결과를 확인하지 못했어요. 같은 서류로 결과를 다시 확인해 주세요.",
            );
          } else {
            setReadFailed(true);
            setMessage(
              "서류 제출은 확인했어요. 현재 상태를 다시 불러와 주세요.",
            );
          }
        }
      }
    });
  }
  async function refresh() {
    await run(async (signal) => {
      try {
        if (submission.current) {
          const confirmed = await receiptConfirmed(signal);
          if (!confirmed && submission.current) {
            const body = new FormData();
            body.set("requestId", submission.current.key);
            body.set("caseId", submission.current.caseId);
            const result = await requestKyc("/api/v1/kyc/documents/reconcile", {
              method: "POST",
              body,
              signal,
            });
            if (!result.response.ok)
              throw new Error("KYC_RECONCILE_UNCONFIRMED");
            const state = dataOf(result.payload).state;
            if (state === "CONFIRMED" || state === "CLOSED")
              await receiptConfirmed(signal);
            else if (state !== "PENDING")
              throw new Error("KYC_RECONCILE_UNCONFIRMED");
          }
        }
        await readCurrent(signal);
      } catch {
        if (mounted.current && !signal.aborted) {
          setReadFailed(true);
          setMessage(
            "현재 결과를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
          );
        }
      }
    });
  }
  const canSubmit =
    uncertain ||
    (current &&
      ["PENDING", "REQUIRES_RESUBMISSION", "ON_HOLD"].includes(current.status));
  return (
    <section
      className={styles.panel}
      aria-labelledby="kyc-intake-title"
      aria-busy={loading || pending}
    >
      <div>
        <h2 id="kyc-intake-title">출금 전 본인 확인</h2>
        <p>
          환영 보상을 출금하려면 본인 확인이 필요해요. 입금 없이 진행할 수
          있어요.
        </p>
      </div>
      {loading ? (
        <p role="status">본인 확인 상태를 불러오고 있어요.</p>
      ) : readFailed ? (
        <p role="alert">현재 본인 확인 상태를 확인하지 못했어요.</p>
      ) : current ? (
        <p className={styles.status}>{STATUS_COPY[current.status]}</p>
      ) : (
        <p>아직 제출한 본인 확인 서류가 없어요.</p>
      )}
      {incomplete ? (
        <p role="alert">
          확인할 요청을 모두 불러오지 못했어요. 새 서류를 제출하지 말고
          고객센터에 확인해 주세요.
        </p>
      ) : null}
      {!loading &&
      !readFailed &&
      !incomplete &&
      !attempts.length &&
      !uncertain &&
      (!current || current.status === "REJECTED") ? (
        <button
          type="button"
          className="button button--secondary"
          disabled={pending}
          onClick={() => void open()}
        >
          본인 확인 시작
        </button>
      ) : null}
      {attempts.length > 1 ? (
        <label>
          확인할 제출 요청
          <select
            disabled={pending}
            value={submissionIdentity?.key ?? ""}
            onChange={(event) => {
              const selected = attempts.find(
                (item) => item.requestId === event.target.value,
              );
              if (selected) {
                try {
                  rememberAttempt({
                    key: selected.requestId,
                    caseId: selected.caseId,
                  });
                  updateSubmission({
                    key: selected.requestId,
                    caseId: selected.caseId,
                    file: null,
                  });
                  setFile(null);
                  setUncertain(true);
                  setMessage("");
                } catch {
                  setMessage(
                    "브라우저 설정으로 요청 선택을 저장하지 못했어요. 현재 요청부터 확인해 주세요.",
                  );
                }
              }
            }}
          >
            {attempts.map((item, index) => (
              <option key={item.requestId} value={item.requestId}>
                미확인 요청 {index + 1}
                {item.caseId !== current?.id ? " · 이전 신청" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {uncertain && submissionIdentity?.caseId !== current?.id ? (
        <p role="status">
          이전 본인 확인 신청의 제출 결과를 확인하고 있어요. 새 요청을 만들지
          않습니다.
        </p>
      ) : null}
      {canSubmit ? (
        <div className={styles.form}>
          <label htmlFor="kyc-document">본인 확인 서류</label>
          <p id="kyc-file-help">
            5MB 이하의 사진(JPG·PNG) 또는 PDF를 제출해 주세요. 서류는 본인 확인
            담당자만 확인합니다.
          </p>
          <input
            id="kyc-document"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            aria-describedby="kyc-file-help"
            disabled={
              pending ||
              (uncertain && file !== null) ||
              readFailed ||
              incomplete
            }
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              if (next && (!next.size || next.size > 5 * 1024 * 1024)) {
                setFile(null);
                setMessage("5MB 이하의 서류를 선택해 주세요.");
                return;
              }
              setFile(next);
              if (uncertain && submission.current)
                updateSubmission({ ...submission.current, file: next });
              else updateSubmission(null);
              setMessage("");
            }}
          />
          <button
            type="button"
            className="button button--primary"
            disabled={pending || !file || readFailed || incomplete}
            onClick={() => void submit()}
          >
            {pending
              ? "결과 확인 중"
              : uncertain
                ? "같은 서류 결과 확인"
                : "서류 제출"}
          </button>
        </div>
      ) : null}
      {message ? (
        <p role="status" className={styles.message}>
          {message}
        </p>
      ) : null}
      {!loading ? (
        <button
          type="button"
          className={styles.refresh}
          disabled={pending}
          onClick={() => void refresh()}
        >
          현재 상태 확인
        </button>
      ) : null}
    </section>
  );
}
