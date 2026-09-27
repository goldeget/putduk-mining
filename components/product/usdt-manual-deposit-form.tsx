"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Feedback = { message: string; tone: "error" | "success" } | null;

type DepositInstructions = {
  address: string;
  network: string;
};

const NETWORK_OPTIONS = ["TRC20", "ERC20", "BEP20"] as const;

/**
 * USDT 수동 입금 안내·접수 UI.
 * 사용자 USDT 잔액이 아니며, 확인 후 KRW 지갑에만 반영된다.
 * 동결 RPC: public.submit_usdt_manual_deposit
 */
export function UsdtManualDepositForm({
  instructions,
}: {
  instructions: DepositInstructions | null;
}) {
  const router = useRouter();
  const [network, setNetwork] = useState(instructions?.network ?? "");
  const [txHash, setTxHash] = useState("");
  const [sentAmount, setSentAmount] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);

  const address = instructions?.address ?? null;
  const canSubmit = Boolean(
    address && network && txHash.trim().length >= 12 && sentAmount,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !address) return;

    setPending(true);
    setFeedback(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setFeedback({
          message: "로그인이 필요해요. 다시 로그인해 주세요.",
          tone: "error",
        });
        return;
      }

      const { error } = await supabase.rpc("submit_usdt_manual_deposit", {
        p_user_id: user.id,
        p_network: network,
        p_tx_hash: txHash.trim(),
        p_sent_usdt_amount: sentAmount,
        p_idempotency_key: crypto.randomUUID(),
      });

      if (error) {
        setFeedback({
          message:
            error.message?.includes("does not exist") ||
            error.code === "PGRST202"
              ? "USDT 입금 접수를 준비하고 있어요. 곧 이용할 수 있어요."
              : "입금 내역을 접수하지 못했어요. 입력값을 확인한 뒤 다시 시도해 주세요.",
          tone: "error",
        });
        return;
      }

      setFeedback({
        message: "입금 내역을 접수했어요. 확인이 끝나면 KRW 지갑에 반영돼요.",
        tone: "success",
      });
      setTxHash("");
      setSentAmount("");
      router.refresh();
    } catch {
      setFeedback({
        message: "인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
        tone: "error",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <header className={styles.stepHeader}>
        <span className={styles.stepNumber}>USDT</span>
        <span>
          <h2>USDT 수동 입금</h2>
          <p>안내된 주소로 보낸 뒤, 거래 정보를 남겨 주세요.</p>
        </span>
      </header>

      <dl className={styles.policySummary} aria-label="입금 안내">
        <div>
          <dt>네트워크</dt>
          <dd>{instructions?.network ?? "안내 준비 중"}</dd>
        </div>
        <div>
          <dt>입금 주소</dt>
          <dd className={styles.monoHint}>
            {address ? maskAddress(address) : "운영 안내 대기"}
          </dd>
        </div>
        <div>
          <dt>반영</dt>
          <dd>확인 후 KRW</dd>
        </div>
      </dl>

      {address ? (
        <div className={styles.formNotice}>
          <PutdukIcon name="shield" size={19} />
          <p>
            전체 주소는 송금 전에만 확인하세요. USDT 잔액은 없으며, 확인된
            금액만 KRW로 반영됩니다.
          </p>
        </div>
      ) : (
        <div className={styles.formNotice}>
          <PutdukIcon name="clock" size={19} />
          <p>입금 주소 안내를 준비하고 있어요. 준비되면 이 화면에 표시됩니다.</p>
        </div>
      )}

      {address ? (
        <button
          type="button"
          className={`button button--secondary ${styles.copyButton}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(address);
              setFeedback({
                message: "입금 주소를 복사했어요.",
                tone: "success",
              });
            } catch {
              setFeedback({
                message: "주소를 복사하지 못했어요. 직접 확인해 주세요.",
                tone: "error",
              });
            }
          }}
        >
          입금 주소 복사
        </button>
      ) : null}

      <label className={styles.field} htmlFor="usdt-deposit-network">
        <span>보낸 네트워크</span>
        <select
          id="usdt-deposit-network"
          name="network"
          required
          value={network}
          onChange={(event) => setNetwork(event.target.value)}
          disabled={pending || !address}
        >
          <option value="" disabled>
            네트워크 선택
          </option>
          {NETWORK_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field} htmlFor="usdt-deposit-tx">
        <span>거래 해시(Tx Hash)</span>
        <input
          id="usdt-deposit-tx"
          name="txHash"
          autoComplete="off"
          minLength={12}
          maxLength={128}
          value={txHash}
          onChange={(event) => setTxHash(event.target.value.trim())}
          disabled={pending || !address}
          required
        />
      </label>

      <label className={styles.field} htmlFor="usdt-deposit-amount">
        <span>보낸 USDT 수량</span>
        <input
          id="usdt-deposit-amount"
          name="sentAmount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={sentAmount}
          onChange={(event) =>
            setSentAmount(event.target.value.replace(/[^0-9.]/g, ""))
          }
          disabled={pending || !address}
          required
        />
      </label>

      <button
        className={`button button--primary ${styles.submitButton}`}
        type="submit"
        disabled={pending || !canSubmit}
      >
        {pending ? "접수 중" : "입금 내역 접수"}
        <PutdukIcon name="arrow-right" size={18} />
      </button>

      {feedback ? (
        <p
          className={`${styles.feedback} ${
            feedback.tone === "success"
              ? styles.feedbackSuccess
              : styles.feedbackError
          }`}
          role="status"
        >
          {feedback.message}
        </p>
      ) : null}
    </form>
  );
}

function maskAddress(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
