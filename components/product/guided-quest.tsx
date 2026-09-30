"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  placeCoachMark,
  visibleSpotlight,
  type QuestRect,
} from "@/lib/motion/coach-position";
import {
  scrollQuestTarget,
  stopDecorativeScroll,
  useMotionPreference,
} from "@/lib/motion/motion-preference";

import styles from "./guided-quest.module.css";

type QuestStep = { body: string; id: string; target: string; title: string };
const QUEST_VERSION = "start-v1";
const STEPS: readonly QuestStep[] = [
  {
    id: "world",
    target: "[data-quest-target='world']",
    title: "한국 월드에서 첫 여정을 시작해요",
    body: "이 화면의 값은 무료 체험 기록입니다. 실제 원화 지갑과는 분리되어 있어요.",
  },
  {
    id: "progress",
    target: "[data-quest-target='progress']",
    title: "진행 상황은 돌아와도 이어져요",
    body: "시작한 채굴은 앱을 닫아도 이어져요. 화면을 켜 둔다고 보상이 늘어나지는 않아요.",
  },
  {
    id: "action",
    target: "[data-quest-target='action']",
    title: "다음 행동은 여기에서 확인해요",
    body: "현재 상태에 맞는 다음 행동을 확인해 주세요.",
  },
  {
    id: "boundary",
    target: "[data-quest-target='boundary']",
    title: "체험과 실제 잔액을 구분해 주세요",
    body: "자격 확인과 전환이 완료되기 전의 체험 결과는 실제 돈으로 출금할 수 없어요.",
  },
];

function readDismissedStage(key: string | null) {
  if (!key) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persistDismissedStage(key: string | null, stage: string) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, stage);
  } catch {
    // Guidance remains usable for this visit when browser storage is blocked.
  }
}

export function GuidedQuest({
  serverStage,
  ownerId,
}: {
  serverStage: string;
  ownerId?: string;
}) {
  const [active, setActive] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [replaySequence, setReplaySequence] = useState(0);
  const [spotlight, setSpotlight] = useState<QuestRect | null>(null);
  const [coachPosition, setCoachPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const coach = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const replayButton = useRef<HTMLButtonElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const focusReplay = useRef(false);
  const scrollRequested = useRef(false);
  const scrollOwned = useRef(false);
  const reducedMotion = useMotionPreference();
  const id = useId();
  const step = STEPS[stepIndex];
  const storageStage = `${QUEST_VERSION}:${serverStage}`;
  // A local dismiss preference is not domain progress. Never share it across
  // accounts or persist it before an authenticated owner is supplied.
  const storageKey = ownerId
    ? `putduk-guided-quest:${QUEST_VERSION}:${ownerId}`
    : null;

  const positionSpotlight = useCallback(() => {
    if (!active || !step) return;
    const target = document.querySelector<HTMLElement>(step.target);
    if (!target) {
      if (coach.current?.contains(document.activeElement))
        replayButton.current?.focus({ preventScroll: true });
      priorFocus.current = null;
      setSpotlight(null);
      setUnavailable(true);
      setActive(false);
      return;
    }
    if (!coach.current) return;
    const rect = target.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setSpotlight(visibleSpotlight(rect, viewport));
    const coachRect = coach.current.getBoundingClientRect();
    setCoachPosition(placeCoachMark(rect, coachRect, viewport));
  }, [active, step]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setStepIndex(0);
      setUnavailable(false);
      setActive(readDismissedStage(storageKey) !== storageStage);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [storageKey, storageStage]);

  useEffect(() => {
    if (!active || !step) return;
    if (reducedMotion && scrollOwned.current) {
      stopDecorativeScroll();
      scrollOwned.current = false;
    }
    const target = document.querySelector<HTMLElement>(step.target);
    // Automatic guidance never steals scroll or input focus. Navigation is
    // requested only by replay/next/previous; reduced changes cancel movement.
    if (scrollRequested.current) {
      // Consume this explicit request even if its target disappeared. A later
      // automatic stage activation must not replay a previous scroll request.
      scrollRequested.current = false;
      if (target) {
        scrollOwned.current = !reducedMotion;
        scrollQuestTarget(target, reducedMotion);
      }
    }
    let frame = 0;
    let disposed = false;
    const schedulePosition = () => {
      if (disposed) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(positionSpotlight);
    };
    schedulePosition();
    if (focusReplay.current) {
      title.current?.focus({ preventScroll: true });
      focusReplay.current = false;
    }
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedulePosition);
    if (target) resizeObserver?.observe(target);
    if (coach.current) resizeObserver?.observe(coach.current);
    const targetObserver = new MutationObserver(schedulePosition);
    targetObserver.observe(
      replayButton.current?.parentElement ?? document.body,
      { childList: true, subtree: true },
    );
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, true);
    window.visualViewport?.addEventListener("resize", schedulePosition);
    const releaseScroll = () => {
      scrollOwned.current = false;
    };
    document.addEventListener("scrollend", releaseScroll, true);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      targetObserver.disconnect();
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("scroll", schedulePosition, true);
      window.visualViewport?.removeEventListener("resize", schedulePosition);
      document.removeEventListener("scrollend", releaseScroll, true);
      // Only interrupt a scroll requested by this guide. Automatic guidance
      // must not cancel scrolling from another control or the user.
      if (scrollOwned.current) {
        stopDecorativeScroll();
        scrollOwned.current = false;
      }
    };
  }, [active, positionSpotlight, reducedMotion, replaySequence, step]);

  const finish = useCallback(() => {
    const focusWasInside = coach.current?.contains(document.activeElement);
    persistDismissedStage(storageKey, storageStage);
    setActive(false);
    setStepIndex(0);
    if (focusWasInside) {
      const returnTarget = priorFocus.current?.isConnected
        ? priorFocus.current
        : replayButton.current;
      returnTarget?.focus({ preventScroll: true });
    }
    priorFocus.current = null;
  }, [storageKey, storageStage]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        finish();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, finish]);

  function replay() {
    priorFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : replayButton.current;
    focusReplay.current = true;
    scrollRequested.current = true;
    setUnavailable(false);
    setReplaySequence((value) => value + 1);
    setStepIndex(0);
    setActive(true);
  }

  return (
    <>
      <button
        ref={replayButton}
        className={styles.replay}
        type="button"
        onClick={replay}
        aria-expanded={active}
        aria-controls={`${id}-coach`}
      >
        <PutdukIcon name="spark" size={17} />
        처음 안내 다시 보기
      </button>
      {unavailable ? (
        <p className={styles.unavailable} role="status">
          안내할 항목을 확인할 수 없어요. 화면을 다시 연 뒤 안내를 켜 주세요.
        </p>
      ) : null}
      {active && step ? (
        <div className={styles.overlay} data-guided-quest>
          {spotlight ? (
            <div
              className={styles.spotlight}
              aria-hidden="true"
              style={spotlight}
            />
          ) : null}
          <motion.section
            ref={coach}
            id={`${id}-coach`}
            className={styles.coach}
            data-guided-quest-coach
            role="dialog"
            aria-modal="false"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-body`}
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.14 }}
            style={coachPosition ?? {}}
          >
            <div className={styles.mascot} aria-hidden="true">
              <PutdukIcon name="spark" size={23} />
            </div>
            <div className={styles.copy} aria-live="polite" aria-atomic="true">
              <p className={styles.step}>
                처음 안내 · {stepIndex + 1}/{STEPS.length}
              </p>
              <h2 ref={title} id={`${id}-title`} tabIndex={-1}>
                {step.title}
              </h2>
              <p id={`${id}-body`}>{step.body}</p>
            </div>
            <div className={styles.actions}>
              <button type="button" onClick={finish}>
                나중에 보기
              </button>
              {stepIndex > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    scrollRequested.current = true;
                    setStepIndex((value) => value - 1);
                  }}
                >
                  이전
                </button>
              ) : null}
              <button
                className="button button--primary"
                type="button"
                onClick={() => {
                  if (stepIndex === STEPS.length - 1) finish();
                  else {
                    scrollRequested.current = true;
                    setStepIndex((value) => value + 1);
                  }
                }}
              >
                {stepIndex === STEPS.length - 1 ? "안내 마치기" : "다음"}
                <PutdukIcon name="arrow-right" size={16} />
              </button>
            </div>
          </motion.section>
        </div>
      ) : null}
    </>
  );
}
