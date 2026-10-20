"use client";

import { useEffect, useRef, useState } from "react";
import { FeedbackMessage } from "@/components/ui/feedback-message";
import {
  useMiningLiveStatusPublisher,
  type MiningLiveReadState,
} from "@/components/mining-live/mining-live-state";
import type { SupabaseBrowserAuthConfig } from "@/lib/env/public";
import { useMotionPreference } from "@/lib/motion/motion-preference";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  createServerClock,
  elapsedServerMicros,
  formatLiveAmountFixed,
  projectPendingMicroKrw,
  settlementCueKrw,
  type ServerClock,
} from "@/lib/product/mining-live-projection";
import {
  acceptMiningLiveSnapshot,
  canAutomaticallyReadMiningSnapshot,
  formatLiveMicroKrw,
  liveCapacityProgress,
  readMiningLiveEnvelope,
  type MiningLiveSnapshot,
} from "@/lib/product/mining-live-snapshot";
import { LiveAmountText } from "./live-amount-text";
import styles from "./mining-live-summary.module.css";

type Props = {
  ownerId: string;
  initialSnapshot: MiningLiveSnapshot;
  authConfig: SupabaseBrowserAuthConfig;
};
type ReadState = MiningLiveReadState;
const stopLabels: Record<
  NonNullable<MiningLiveSnapshot["stopReason"]>,
  string
> = {
  NO_ACTIVE_ALLOCATION: "채굴 배분을 확인해 주세요.",
  CAPACITY_USED: "이번 한도를 모두 사용했어요.",
  SAFE_MODE: "안전 점검으로 채굴이 멈췄어요.",
  FUNDING_BELOW_MINIMUM: "채굴 원금 조건을 확인해 주세요.",
};

/** Normal foreground refresh. Each receipt replaces the on-screen estimate. */
const READ_INTERVAL_MS = 10_000;
/** Bounded retries after a failed read; a fourth consecutive failure stops automatic reads. */
const RETRY_BACKOFF_MS = [5_000, 15_000, 30_000] as const;
/** Focus and page-show events do not re-read a receipt that is this fresh. */
const FOCUS_REREAD_GUARD_MS = 3_000;
/** The on-screen estimate repaints at most this often (10 Hz). */
const PAINT_INTERVAL_MS = 100;
const SETTLEMENT_CUE_MS = 8_000;

export function MiningLiveSummary(props: Props) {
  // A different account or replacement server receipt gets no previous state.
  return (
    <OwnedMiningSummary
      key={`${props.ownerId}:${props.initialSnapshot.cycleStartedAt}:${props.initialSnapshot.evaluatedAt}`}
      {...props}
    />
  );
}

function OwnedMiningSummary({ ownerId, initialSnapshot, authConfig }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [ownerVerified, setOwnerVerified] = useState(false);
  const [readState, setReadState] = useState<ReadState>("checking");
  const [reopenRequired, setReopenRequired] = useState(false);
  // Only a receipt fetched in this page session has a known arrival time.
  const [clock, setClock] = useState<ServerClock | null>(null);
  const [tick, setTick] = useState<{ key: string; value: string } | null>(null);
  const [settled, setSettled] = useState<{ key: string; krw: string } | null>(
    null,
  );
  const reducedMotion = useMotionPreference();
  const refreshRef = useRef<(() => void) | null>(null);
  const publishStatus = useMiningLiveStatusPublisher();

  useEffect(() => {
    publishStatus?.({
      status: snapshot.status,
      stopReason: snapshot.stopReason,
      ownerVerified,
      readState,
      reopenRequired,
    });
  }, [
    publishStatus,
    snapshot.status,
    snapshot.stopReason,
    ownerVerified,
    readState,
    reopenRequired,
  ]);

  useEffect(() => {
    let disposed = false,
      blocked = false,
      verified = false,
      initialObserved = false;
    let current = initialSnapshot;
    let autoAllowed = canAutomaticallyReadMiningSnapshot(current);
    let failures = 0;
    let reopen = false;
    let lastReceiptAt = Number.NEGATIVE_INFINITY;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let unsubscribe: (() => void) | undefined;
    const foreground = () =>
      document.visibilityState === "visible" && navigator.onLine;
    const stop = () => {
      clearTimeout(timer);
      controller?.abort();
    };
    const invalidate = () => {
      blocked = true;
      verified = false;
      stop();
      setOwnerVerified(false);
      setReadState("blocked");
    };
    const nextDelay = () =>
      failures > 0
        ? RETRY_BACKOFF_MS[Math.min(failures, RETRY_BACKOFF_MS.length) - 1]!
        : READ_INTERVAL_MS;
    const read = async () => {
      if (disposed || blocked || !verified || controller || !foreground())
        return;
      clearTimeout(timer);
      const activeController = new AbortController();
      controller = activeController;
      const deadline = setTimeout(() => activeController.abort(), 8_000);
      try {
        const response = await fetch("/api/v1/mining/display", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: { "X-Putduk-Mining-Owner": ownerId },
          signal: activeController.signal,
        });
        if (disposed || blocked || !verified || activeController.signal.aborted)
          return;
        if (response.status === 401 || response.status === 409) {
          invalidate();
          return;
        }
        if (!response.ok) throw new Error("READ_UNCONFIRMED");
        const envelope = readMiningLiveEnvelope(await response.json(), ownerId);
        if (disposed || blocked || !verified || activeController.signal.aborted)
          return;
        if (!envelope.ok) {
          if (envelope.reason === "OWNER_MISMATCH") {
            invalidate();
            return;
          }
          throw new Error("READ_UNCONFIRMED");
        }
        if (
          envelope.snapshot &&
          (envelope.snapshot.cycleStartedAt !== current.cycleStartedAt ||
            envelope.snapshot.cycleEnd !== current.cycleEnd)
        ) {
          // A new cycle needs a fresh page; retrying cannot help.
          reopen = true;
          autoAllowed = false;
          setReopenRequired(true);
        }
        if (
          !envelope.snapshot ||
          !acceptMiningLiveSnapshot(current, envelope.snapshot)
        )
          throw new Error("RECEIPT_UNCONFIRMED");
        const increase = settlementCueKrw(current, envelope.snapshot);
        // Arrival time is taken after the body is accepted, so elapsed time
        // since the server evaluation can only be under-stated.
        const arrivedAt = performance.now();
        current = envelope.snapshot;
        lastReceiptAt = arrivedAt;
        failures = 0;
        autoAllowed = canAutomaticallyReadMiningSnapshot(current);
        setClock(createServerClock(current.evaluatedAt, arrivedAt));
        setSnapshot(current);
        if (increase) setSettled({ key: current.evaluatedAt, krw: increase });
        setReadState("fresh");
      } catch {
        if (!disposed && !blocked && verified) {
          if (foreground()) {
            failures += 1;
            if (failures > RETRY_BACKOFF_MS.length) autoAllowed = false;
          }
          setReadState(foreground() ? "stale" : "paused");
        }
      } finally {
        clearTimeout(deadline);
        if (controller === activeController) controller = null;
        if (!disposed && !blocked && verified && foreground() && autoAllowed)
          timer = setTimeout(() => void read(), nextDelay());
      }
    };
    const resync = (guard: boolean) => {
      stop();
      if (disposed || blocked || !verified || reopen) return;
      if (!foreground()) {
        setReadState("paused");
        return;
      }
      if (guard && performance.now() - lastReceiptAt < FOCUS_REREAD_GUARD_MS) {
        if (autoAllowed) timer = setTimeout(() => void read(), nextDelay());
        return;
      }
      if (!controller && (autoAllowed || failures > 0)) {
        // A recovery attempt after earlier failures re-opens automatic reads
        // only when the server snapshot itself permits them.
        autoAllowed = canAutomaticallyReadMiningSnapshot(current);
        if (autoAllowed || failures > 0) void read();
      } else if (!autoAllowed)
        setReadState(current.status === "STOPPED" ? "fresh" : "stale");
    };
    const visibility = () => resync(false);
    const returned = () => resync(true);
    refreshRef.current = () => void read();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", visibility);
    window.addEventListener("offline", visibility);
    window.addEventListener("focus", returned);
    window.addEventListener("pageshow", returned);
    try {
      const browser = createSupabaseBrowserClient(authConfig);
      const { data } = browser.auth.onAuthStateChange((event, session) => {
        if (disposed || blocked) return;
        const browserOwner = event === "SIGNED_OUT" ? null : session?.user.id;
        if (browserOwner !== ownerId) {
          invalidate();
          return;
        }
        if (event === "INITIAL_SESSION") initialObserved = true;
        if (!initialObserved || verified) return;
        verified = true;
        setOwnerVerified(true);
        setReadState(foreground() ? "fresh" : "paused");
        if (foreground() && autoAllowed) void read();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      queueMicrotask(() => {
        if (!disposed) invalidate();
      });
    }
    return () => {
      disposed = true;
      verified = false;
      stop();
      refreshRef.current = null;
      unsubscribe?.();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", visibility);
      window.removeEventListener("offline", visibility);
      window.removeEventListener("focus", returned);
      window.removeEventListener("pageshow", returned);
    };
  }, [ownerId, initialSnapshot, authConfig]);

  const projection = snapshot.projection ?? null;
  // The estimate only continues from a fetched, fresh, running receipt. Any
  // other state shows the last server value and never advances it.
  const live =
    ownerVerified &&
    !reducedMotion &&
    readState === "fresh" &&
    clock !== null &&
    projection !== null &&
    canAutomaticallyReadMiningSnapshot(snapshot);

  useEffect(() => {
    if (!live || !clock || !projection) return;
    const key = snapshot.evaluatedAt;
    const horizon = BigInt(projection.horizonMicros);
    let frame: number | undefined;
    let cancelled = false;
    let lastPaint = Number.NEGATIVE_INFINITY;
    const loop = () => {
      if (cancelled) return;
      const now = performance.now();
      if (now - lastPaint >= PAINT_INTERVAL_MS) {
        lastPaint = now;
        const elapsed = elapsedServerMicros(clock, now);
        const value = projectPendingMicroKrw(
          snapshot.pendingMicroKrw,
          projection,
          elapsed,
        );
        setTick((previous) =>
          previous?.key === key && previous.value === value
            ? previous
            : { key, value },
        );
        // Past the horizon the value is flat; stop spending frames until the
        // next receipt replaces it.
        if (elapsed >= horizon) return;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [live, clock, projection, snapshot.evaluatedAt, snapshot.pendingMicroKrw]);

  useEffect(() => {
    if (!settled) return;
    const timer = setTimeout(() => setSettled(null), SETTLEMENT_CUE_MS);
    return () => clearTimeout(timer);
  }, [settled]);

  const shownPending =
    live && tick?.key === snapshot.evaluatedAt
      ? tick.value
      : snapshot.pendingMicroKrw;
  const progress = liveCapacityProgress(snapshot);
  const message =
    readState === "blocked"
      ? "로그인 상태가 바뀌었어요. 화면을 다시 열어 주세요."
      : !ownerVerified
        ? "로그인 상태를 확인하고 있어요."
        : readState === "paused"
          ? "자동 확인을 잠시 멈췄어요. 마지막으로 확인한 기록이에요."
          : readState === "stale"
            ? "최신 기록을 확인하지 못했어요. 마지막으로 확인한 금액이에요. 최신 기록 확인을 눌러 주세요."
            : snapshot.stopReason
              ? stopLabels[snapshot.stopReason]
              : !canAutomaticallyReadMiningSnapshot(snapshot)
                ? "이번 한도의 남은 금액이 없어 자동 확인을 멈췄어요."
                : live
                  ? "서버가 확인한 속도로 이어서 보여 드려요."
                  : "서버에서 확인한 기록만 표시해요.";
  if (!ownerVerified)
    return (
      <FeedbackMessage tone={readState === "blocked" ? "warning" : "info"}>
        {message}
      </FeedbackMessage>
    );
  return (
    <div
      className={styles.summary}
      data-mining-live-summary
      data-read-state={readState}
      data-live={live ? "true" : "false"}
    >
      <dl className={styles.amounts} aria-live="off">
        <div className={styles.pending}>
          <dt>
            정산 전
            {live ? (
              <small className={styles.livePill}>
                <span className={styles.liveDot} aria-hidden="true" />
                이어서 보는 중
              </small>
            ) : null}
          </dt>
          <dd>
            <span aria-hidden="true">
              <LiveAmountText
                text={formatLiveAmountFixed(shownPending)}
                animate={live}
              />
            </span>
            <span className={styles.srOnly}>
              {formatLiveAmountFixed(snapshot.pendingMicroKrw)}
            </span>
          </dd>
        </div>
        <div>
          <dt>확정 채굴 누계</dt>
          <dd>
            {formatLiveMicroKrw(
              (BigInt(snapshot.committedKrw) * 1_000_000n).toString(),
            )}
          </dd>
        </div>
        <div>
          <dt>이번 한도</dt>
          <dd>{formatLiveMicroKrw(snapshot.capacityMicroKrw)}</dd>
        </div>
        <div>
          <dt>사용한 한도</dt>
          <dd>{formatLiveMicroKrw(snapshot.usedMicroKrw)}</dd>
        </div>
        <div className={styles.remaining}>
          <dt>남은 한도</dt>
          <dd>{formatLiveMicroKrw(snapshot.remainingMicroKrw)}</dd>
        </div>
      </dl>
      {settled ? (
        <p
          className={styles.settled}
          role="status"
          data-settlement-cue
          key={settled.key}
        >
          {BigInt(settled.krw).toLocaleString("ko-KR")}원이 확정 채굴에
          반영됐어요.
        </p>
      ) : null}
      {progress ? (
        <div className={styles.progress}>
          <progress
            aria-label="채굴 한도 사용률"
            aria-valuetext={progress.usedLabel}
            max={10_000}
            value={progress.usedBps}
          />
          <small>{progress.usedLabel}</small>
        </div>
      ) : null}
      <p className={styles.note}>
        이번 채굴 기간에 함께 적용하는 한도예요. 정산 전 금액은 사용 가능 잔액과
        달라요.
      </p>
      <p className={styles.checked}>
        마지막 확인{" "}
        <time dateTime={snapshot.evaluatedAt}>
          {new Date(snapshot.evaluatedAt).toLocaleString("ko-KR", {
            timeZone: "Asia/Seoul",
            hour12: false,
          })}
        </time>
      </p>
      <FeedbackMessage tone={readState === "stale" ? "warning" : "info"}>
        {reopenRequired
          ? "채굴 기간이 바뀌었어요. 마지막으로 확인한 기록이에요. 화면을 다시 열어 주세요."
          : message}
      </FeedbackMessage>
      <button
        className="button button--secondary"
        type="button"
        disabled={reopenRequired}
        onClick={() => refreshRef.current?.()}
      >
        최신 기록 확인
      </button>
    </div>
  );
}
