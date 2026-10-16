"use client";

import { useEffect, useRef, useState } from "react";
import { FeedbackMessage } from "@/components/ui/feedback-message";
import type { SupabaseBrowserAuthConfig } from "@/lib/env/public";
import { useMotionPreference } from "@/lib/motion/motion-preference";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  acceptMiningLiveSnapshot,
  canAutomaticallyReadMiningSnapshot,
  formatLiveMicroKrw,
  interpolateServerTarget,
  liveCapacityProgress,
  readMiningLiveEnvelope,
  type MiningLiveSnapshot,
} from "@/lib/product/mining-live-snapshot";
import styles from "./mining-live-summary.module.css";

type Props = {
  ownerId: string;
  initialSnapshot: MiningLiveSnapshot;
  authConfig: SupabaseBrowserAuthConfig;
};
type ReadState = "checking" | "fresh" | "stale" | "paused" | "blocked";
const stopLabels: Record<
  NonNullable<MiningLiveSnapshot["stopReason"]>,
  string
> = {
  NO_ACTIVE_ALLOCATION: "채굴 배분을 확인해 주세요.",
  CAPACITY_USED: "이번 한도를 모두 사용했어요.",
  SAFE_MODE: "안전 점검으로 채굴이 멈췄어요.",
  FUNDING_BELOW_MINIMUM: "채굴 원금 조건을 확인해 주세요.",
};

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
  const [pending, setPending] = useState(initialSnapshot.pendingMicroKrw);
  const reducedMotion = useMotionPreference();
  const pendingRef = useRef(pending);
  const animationContext = useRef(initialSnapshot);
  const refreshRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let disposed = false,
      blocked = false,
      verified = false,
      initialObserved = false;
    let current = initialSnapshot;
    let autoAllowed = canAutomaticallyReadMiningSnapshot(current);
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
        )
          setReopenRequired(true);
        if (
          !envelope.snapshot ||
          !acceptMiningLiveSnapshot(current, envelope.snapshot)
        )
          throw new Error("RECEIPT_UNCONFIRMED");
        current = envelope.snapshot;
        autoAllowed = canAutomaticallyReadMiningSnapshot(current);
        setSnapshot(current);
        setReadState("fresh");
      } catch {
        if (!disposed && !blocked && verified) {
          if (foreground()) autoAllowed = false;
          setReadState(foreground() ? "stale" : "paused");
        }
      } finally {
        clearTimeout(deadline);
        if (controller === activeController) controller = null;
        if (!disposed && !blocked && verified && foreground() && autoAllowed)
          timer = setTimeout(() => void read(), 10_000);
      }
    };
    const visibility = () => {
      stop();
      if (disposed || blocked || !verified) return;
      if (!foreground()) setReadState("paused");
      else if (!controller && autoAllowed) void read();
      else if (!autoAllowed)
        setReadState(current.status === "STOPPED" ? "fresh" : "stale");
    };
    refreshRef.current = () => void read();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", visibility);
    window.addEventListener("offline", visibility);
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
    };
  }, [ownerId, initialSnapshot, authConfig]);

  useEffect(() => {
    let frame: number | undefined;
    let cancelled = false;
    const target = snapshot.pendingMicroKrw;
    const from = pendingRef.current;
    const exact = () => {
      if (!cancelled) {
        pendingRef.current = target;
        setPending(target);
      }
    };
    // Changes of state or conditions are corrections, not visual accrual.
    const previous = animationContext.current;
    animationContext.current = snapshot;
    if (
      !ownerVerified ||
      reducedMotion ||
      readState !== "fresh" ||
      !canAutomaticallyReadMiningSnapshot(snapshot) ||
      previous.conditionRevision !== snapshot.conditionRevision ||
      previous.stateRevision !== snapshot.stateRevision ||
      BigInt(target) <= BigInt(from)
    ) {
      queueMicrotask(exact);
      return () => {
        cancelled = true;
      };
    }
    const started = performance.now();
    const tick = (now: number) => {
      if (cancelled) return;
      const progress = Math.min(
        10_000,
        Math.max(0, Math.floor(((now - started) / 350) * 10_000)),
      );
      const next = interpolateServerTarget(from, target, progress);
      pendingRef.current = next;
      setPending(next);
      if (progress < 10_000) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [snapshot, ownerVerified, readState, reducedMotion]);
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
    >
      <dl className={styles.amounts} aria-live="off">
        <div>
          <dt>정산 전</dt>
          <dd>
            <span aria-hidden="true">{formatLiveMicroKrw(pending)}</span>
            <span className={styles.srOnly}>
              {formatLiveMicroKrw(snapshot.pendingMicroKrw)}
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
