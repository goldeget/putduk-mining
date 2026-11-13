"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { WorkroomAdminConfig } from "../../../lib/workroom/types";
import { simulationValue } from "../../../../../domain/workroom/contracts";
import styles from "./config-preview.module.css";

const names = { wave: "웨이브", slow: "슬로우", balanced: "밸런스" };
const signed = (value: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export function WorkroomConfigPreview({
  config,
}: {
  config: WorkroomAdminConfig;
}) {
  const id = useId().replace(/:/g, "");
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const position = useRef(1);
  const valid =
    ["wave", "slow", "balanced"].includes(config.pattern) &&
    Number.isFinite(config.roi) &&
    config.roi >= -50 &&
    config.roi <= 50 &&
    Number.isFinite(config.amplitude) &&
    config.amplitude >= 0 &&
    config.amplitude <= 15 &&
    Number.isFinite(config.duration) &&
    Number.isInteger(config.duration) &&
    config.duration >= 30 &&
    config.duration <= 86400;

  useEffect(() => {
    if (!playing || !valid) return;
    const started = performance.now() - position.current * 10000;
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.max(0, Math.min(1, (now - started) / 10000));
      position.current = next;
      setProgress(next);
      if (next === 1) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    const pauseWhenHidden = () => {
      if (document.hidden) setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", pauseWhenHidden);
    };
  }, [playing, valid]);

  const seek = (value: number) => {
    const bounded = Math.max(0, Math.min(1, value));
    position.current = bounded;
    setProgress(bounded);
  };
  const current = valid ? simulationValue(config, progress) : 100;
  const values = Array.from({ length: 241 }, (_, i) =>
    valid ? simulationValue(config, i / 240) : 100,
  );
  const low = Math.min(100, ...values),
    high = Math.max(100, ...values);
  const padding = Math.max((high - low) * 0.15, 0.6);
  const min = low - padding,
    max = high + padding;
  const x = (value: number) => 8 + value * 784;
  const y = (value: number) => 16 + ((max - value) / (max - min)) * 208;
  const points = Array.from(
    { length: Math.floor(progress * 240) + 1 },
    (_, i) => `${x(i / 240)},${y(values[i] ?? 100)}`,
  );
  if ((progress * 240) % 1 !== 0) points.push(`${x(progress)},${y(current)}`);
  const path = points
    .map((point, i) => `${i === 0 ? "M" : "L"}${point}`)
    .join(" ");
  const direction =
    current > 100 ? "positive" : current < 100 ? "negative" : "neutral";
  const ticks = Array.from(
    { length: 5 },
    (_, i) => max - ((max - min) * i) / 4,
  );

  return (
    <section
      className={styles.preview}
      data-direction={direction}
      aria-label="모의 경로 미리보기"
    >
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>설정 경로 미리보기</span>
          <h3>{valid ? names[config.pattern] : "설정 확인 필요"}</h3>
        </div>
        <span className={styles.badge}>10초 미리보기</span>
      </div>
      <div className={styles.metrics}>
        <div>
          <span>현재 모의 지수</span>
          <strong>{valid ? current.toFixed(2) : "—"}</strong>
          <small className={styles.change}>
            {valid ? signed(current - 100) : "입력값 확인"}
          </small>
        </div>
        <div>
          <span>설정 종료 변동률</span>
          <strong>{valid ? signed(config.roi) : "—"}</strong>
          <small>시작 지수 100</small>
        </div>
        <div>
          <span>실제 설정 시간</span>
          <strong>
            {Number.isFinite(config.duration) &&
            config.duration >= 30 &&
            config.duration <= 86400
              ? `${config.duration.toLocaleString("ko-KR")}초`
              : "—"}
          </strong>
          <small>재생 속도와 별도</small>
        </div>
      </div>
      {!valid && (
        <p className={styles.invalid} role="status">
          변동률·변동폭·시간을 허용 범위로 입력하면 경로를 볼 수 있습니다.
        </p>
      )}
      <div className={styles.graph}>
        <div className={styles.yAxis} aria-hidden="true">
          {ticks.map((value, i) => (
            <span key={i} style={{ top: `${y(value) / 2.4}%` }}>
              {value.toFixed(1)}
            </span>
          ))}
        </div>
        <div className={styles.plot}>
          <svg
            data-testid="admin-workroom-preview"
            data-start-value={100}
            data-end-value={valid ? 100 + config.roi : undefined}
            data-current-value={current}
            data-progress={progress}
            viewBox="0 0 800 240"
            preserveAspectRatio="none"
            role="img"
            aria-label={
              valid
                ? `사전 설정된 ${names[config.pattern]} 모의 지수 차트. 현재 ${current.toFixed(2)}, 설정 종료 변동률 ${signed(config.roi)}. 실제 시세와 다릅니다.`
                : "입력값 확인이 필요한 모의 지수 미리보기. 실제 시세와 다릅니다."
            }
          >
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                <stop
                  offset="100%"
                  stopColor="currentColor"
                  stopOpacity="0.015"
                />
              </linearGradient>
            </defs>
            {ticks.map((value, i) => (
              <line
                className={styles.grid}
                key={i}
                x1="8"
                x2="792"
                y1={y(value)}
                y2={y(value)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line
              className={styles.baseline}
              x1="8"
              x2="792"
              y1={y(100)}
              y2={y(100)}
              vectorEffect="non-scaling-stroke"
            />
            {valid && (
              <>
                <path
                  d={`${path} L${x(progress)},224 L8,224 Z`}
                  fill={`url(#${id}-fill)`}
                />
                <path
                  className={styles.line}
                  d={path}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  className={styles.cursor}
                  x1={x(progress)}
                  x2={x(progress)}
                  y1="16"
                  y2="224"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}
          </svg>
          {valid && (
            <span
              className={styles.endpoint}
              style={{
                left: `${x(progress) / 8}%`,
                top: `${y(current) / 2.4}%`,
              }}
              aria-hidden="true"
            />
          )}
          <span
            className={styles.baselineLabel}
            style={{ top: `${y(100) / 2.4}%` }}
            aria-hidden="true"
          >
            시작 100
          </span>
        </div>
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              if (position.current >= 1) seek(0);
              setPlaying(true);
            }
          }}
        >
          {playing ? "일시정지" : progress >= 1 ? "10초 재생" : "이어서 재생"}
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            setPlaying(false);
            seek(0);
          }}
        >
          처음으로
        </button>
        <span className={styles.position}>{Math.round(progress * 100)}%</span>
      </div>
      <label className={styles.scrub}>
        <span>경로 탐색</span>
        <input
          type="range"
          min="0"
          max="1000"
          step="1"
          value={Math.round(progress * 1000)}
          disabled={!valid}
          aria-label="모의 경로 진행 위치"
          aria-valuetext={`${Math.round(progress * 100)}%`}
          onChange={(event) => {
            setPlaying(false);
            seek(Number(event.target.value) / 1000);
          }}
        />
      </label>
      <progress
        className={styles.progress}
        max="1"
        value={progress}
        aria-label="미리보기 경로 진행률"
      />
      <p className={styles.caption}>
        10초로 압축한 표시용 경로입니다. 실제 시세와 다르며 저장 전에는 회원에게
        적용되지 않습니다.
      </p>
    </section>
  );
}
