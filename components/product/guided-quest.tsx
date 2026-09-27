"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { PutdukIcon } from "@/components/icons/putduk-icon";

type QuestStep = {
  body: string;
  id: string;
  target: string;
  title: string;
};

type SpotlightRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

const QUEST_VERSION = "start-v1";
const STORAGE_KEY = `putduk-guided-quest:${QUEST_VERSION}`;

const STEPS: readonly QuestStep[] = [
  {
    id: "world",
    target: "[data-quest-target='world']",
    title: "KOREA에서 첫 여정을 시작해요",
    body: "이 화면의 값은 무료 체험 기록입니다. 실제 KRW 지갑과는 분리되어 있어요.",
  },
  {
    id: "progress",
    target: "[data-quest-target='progress']",
    title: "진행 상황은 돌아와도 이어져요",
    body: "앱을 닫아도 서버 시간을 기준으로 상태가 이어집니다. 화면을 켜 둔다고 보상이 늘어나지는 않아요.",
  },
  {
    id: "action",
    target: "[data-quest-target='action']",
    title: "다음 행동은 여기에서 확인해요",
    body: "현재 상태에 맞는 시작, 자격 확인 또는 첫 출금 행동만 표시합니다.",
  },
  {
    id: "boundary",
    target: "[data-quest-target='boundary']",
    title: "체험과 실제 잔액의 경계를 기억해 주세요",
    body: "자격 확인과 전환이 완료되기 전의 체험 결과는 출금할 수 있는 실제 돈이 아닙니다.",
  },
] as const;

function readDismissedStage() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistDismissedStage(stage: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, stage);
  } catch {
    // The quest still works for this visit when storage is unavailable.
  }
}

export function GuidedQuest({ serverStage }: { serverStage: string }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const step = STEPS[stepIndex];

  const storageStage = useMemo(
    () => `${QUEST_VERSION}:${serverStage}`,
    [serverStage],
  );

  const positionSpotlight = useCallback(() => {
    if (!active || !step) {
      setSpotlight(null);
      return;
    }

    const target = document.querySelector<HTMLElement>(step.target);
    if (!target) {
      setSpotlight(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    const padding = 10;
    setSpotlight({
      height: rect.height + padding * 2,
      left: Math.max(8, rect.left - padding),
      top: Math.max(8, rect.top - padding),
      width: Math.min(window.innerWidth - 16, rect.width + padding * 2),
    });
  }, [active, step]);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      setActive(readDismissedStage() !== storageStage);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [storageStage]);

  useEffect(() => {
    if (!active || !step) {
      return;
    }

    const target = document.querySelector<HTMLElement>(step.target);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });

    const animationFrame = window.requestAnimationFrame(positionSpotlight);
    window.addEventListener("resize", positionSpotlight);
    window.addEventListener("scroll", positionSpotlight, true);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", positionSpotlight);
      window.removeEventListener("scroll", positionSpotlight, true);
    };
  }, [active, positionSpotlight, step]);

  function finish() {
    persistDismissedStage(storageStage);
    setActive(false);
    setStepIndex(0);
  }

  function replay() {
    setStepIndex(0);
    setActive(true);
  }

  return (
    <>
      <button className="guided-quest__replay" type="button" onClick={replay}>
        <PutdukIcon name="spark" size={17} />
        처음 안내 다시 보기
      </button>

      {active && step ? (
        <div className="guided-quest" aria-live="polite">
          {spotlight ? (
            <div
              className="guided-quest__spotlight"
              aria-hidden="true"
              style={{
                height: spotlight.height,
                left: spotlight.left,
                top: spotlight.top,
                width: spotlight.width,
              }}
            />
          ) : null}
          <section
            className="guided-quest__coach"
            role="dialog"
            aria-modal="false"
            aria-labelledby="guided-quest-title"
          >
            <div className="guided-quest__mascot" aria-hidden="true">
              <PutdukIcon name="spark" size={23} />
            </div>
            <div>
              <p className="eyebrow">
                GUIDED START · {stepIndex + 1}/{STEPS.length}
              </p>
              <h2 id="guided-quest-title">{step.title}</h2>
              <p>{step.body}</p>
            </div>
            <div className="guided-quest__actions">
              <button type="button" onClick={finish}>
                나중에 보기
              </button>
              {stepIndex > 0 ? (
                <button
                  type="button"
                  onClick={() => setStepIndex((value) => value - 1)}
                >
                  이전
                </button>
              ) : null}
              <button
                className="button button--primary"
                type="button"
                onClick={() =>
                  stepIndex === STEPS.length - 1
                    ? finish()
                    : setStepIndex((value) => value + 1)
                }
              >
                {stepIndex === STEPS.length - 1 ? "안내 마치기" : "다음"}
                <PutdukIcon name="arrow-right" size={16} />
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
