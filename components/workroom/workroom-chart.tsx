"use client";

import { useId } from "react";
import {
  simulationValue,
  type WorkroomConfig,
  type WorkroomSession,
} from "@/domain/workroom/contracts";
import styles from "./workroom-chart.module.css";

const patterns = { wave: "웨이브", slow: "슬로우", balanced: "밸런스" };
const formatIndex = (value: number) => value.toFixed(2);
const formatTime = (seconds: number) =>
  seconds < 120
    ? `${Math.round(seconds)}초`
    : seconds < 7200
      ? `${Math.round(seconds / 60)}분`
      : `${Number((seconds / 3600).toFixed(1))}시간`;

export interface WorkroomChartProps {
  config: WorkroomConfig | WorkroomSession;
  progress: number;
  active?: boolean;
}

/** A display-only curve from the configured practice formula, never market data. */
export function WorkroomChart({
  config,
  progress,
  active = false,
}: WorkroomChartProps) {
  const id = useId().replace(/:/g, "");
  const elapsed =
    active && Number.isFinite(progress)
      ? Math.max(0, Math.min(1, progress))
      : 0;
  const current = simulationValue(config, elapsed);
  const direction =
    current > 100 ? "positive" : current < 100 ? "negative" : "neutral";
  // Keep the scale stable throughout a session. Only the elapsed curve is drawn.
  const values = Array.from({ length: 241 }, (_, i) =>
    active ? simulationValue(config, i / 240) : 100,
  );
  const low = Math.min(100, ...values);
  const high = Math.max(100, ...values);
  const padding = Math.max((high - low) * 0.15, 0.6);
  const min = low - padding;
  const max = high + padding;
  const x = (time: number) => 8 + time * 784;
  const y = (value: number) => 16 + ((max - value) / (max - min)) * 228;
  const samples = Array.from(
    { length: Math.floor(elapsed * 240) + 1 },
    (_, i) => ({
      x: x(i / 240),
      y: y(values[i] ?? 100),
    }),
  );
  if ((elapsed * 240) % 1 !== 0) samples.push({ x: x(elapsed), y: y(current) });
  // Dense formula samples and rounded joins preserve the actual curve without
  // interpolation overshoot or an invented price movement between updates.
  const path = samples
    .map((point, i) => `${i === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const endpointX = x(elapsed);
  const endpointY = y(current);
  const baselineY = y(100);
  const ticks = Array.from(
    { length: 5 },
    (_, i) => max - ((max - min) * i) / 4,
  );

  return (
    <figure
      className={styles.chart}
      data-direction={direction}
      data-active={active && elapsed < 1}
    >
      <div className={styles.heading}>
        <div className={styles.readout}>
          <span className={styles.eyebrow}>모의 지수</span>
          <strong>{formatIndex(current)}</strong>
          <span className={styles.change}>
            {current >= 100 ? "+" : ""}
            {(current - 100).toFixed(2)}%
          </span>
        </div>
        <span className={styles.state}>
          <i aria-hidden="true" />
          {active
            ? elapsed < 1
              ? "연습 진행 중"
              : "결과 확인 중"
            : "시작 대기"}
        </span>
      </div>
      <div className={styles.graph}>
        <div className={styles.yAxis} aria-hidden="true">
          {ticks.map((value, i) => (
            <span key={i} style={{ top: `${(y(value) / 260) * 100}%` }}>
              {value.toFixed(1)}
            </span>
          ))}
        </div>
        <div className={styles.plot}>
          <svg
            data-testid="workroom-chart"
            data-current-value={current}
            data-progress={elapsed}
            viewBox="0 0 800 260"
            preserveAspectRatio="none"
            role="img"
            aria-label={`사전 설정된 ${patterns[config.pattern]} 모의 지수 차트. 비현금 연습이며 실제 시세와 다릅니다.`}
            aria-describedby={`${id}-description`}
          >
            <title
              id={`${id}-title`}
            >{`${patterns[config.pattern]} 모의 지수 차트`}</title>
            <desc id={`${id}-description`}>
              사전 설정된 비현금 연습입니다. 실제 시세와 다릅니다. 시작 지수
              100, 현재 {formatIndex(current)}, 진행률{" "}
              {Math.round(elapsed * 100)}%. 연습 결과는 출금할 수 없습니다.
            </desc>
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                <stop
                  offset="100%"
                  stopColor="currentColor"
                  stopOpacity="0.015"
                />
              </linearGradient>
              <radialGradient id={`${id}-halo`}>
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </radialGradient>
            </defs>
            {ticks.map((value, i) => (
              <line
                className={styles.grid}
                key={`h${i}`}
                x1="8"
                x2="792"
                y1={y(value)}
                y2={y(value)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((time) => (
              <line
                className={styles.grid}
                key={time}
                x1={x(time)}
                x2={x(time)}
                y1="16"
                y2="244"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path
              d={`${path} L${endpointX},244 L8,244 Z`}
              fill={`url(#${id}-fill)`}
            />
            <line
              className={styles.baseline}
              x1="8"
              x2="792"
              y1={baselineY}
              y2={baselineY}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className={styles.cursor}
              x1={endpointX}
              x2={endpointX}
              y1="16"
              y2="244"
              vectorEffect="non-scaling-stroke"
            />
            <path
              className={styles.lineGlow}
              d={path}
              vectorEffect="non-scaling-stroke"
            />
            <path
              className={styles.line}
              d={path}
              vectorEffect="non-scaling-stroke"
            />
            <ellipse
              cx={endpointX}
              cy={endpointY}
              rx="18"
              ry="18"
              fill={`url(#${id}-halo)`}
            />
          </svg>
          <span
            className={styles.endpoint}
            style={{ left: `${endpointX / 8}%`, top: `${endpointY / 2.6}%` }}
            aria-hidden="true"
          />
          <span
            className={styles.baselineLabel}
            style={{ top: `${baselineY / 2.6}%` }}
            aria-hidden="true"
          >
            시작 100
          </span>
          <div className={styles.xAxis} aria-hidden="true">
            {[0, 0.25, 0.5, 0.75, 1].map((time) => (
              <span key={time}>{formatTime(config.duration * time)}</span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className={styles.caption}>
        <span>
          <i aria-hidden="true" />
          사전 설정된 모의 지수 · 실제 시세와 다릅니다
        </span>
      </figcaption>
    </figure>
  );
}
