"use client";
import Link from "next/link";
import { WorkroomLoading } from "../../../../../components/ui/workroom-loading";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  reviewedSubmission,
  type ReviewedSubmission,
} from "@/lib/workroom/submission";
import type {
  WorkroomAdminConfig,
  WorkroomAdminState,
} from "@/lib/workroom/types";
import styles from "./workroom.module.css";
import { WorkroomConfigPreview } from "./config-preview";
const names: Record<string, string> = {
  usd: "미국 달러",
  cny: "중국 위안",
  jpy: "일본 엔 · 100 JPY",
  nvda: "엔비디아",
  tsla: "테슬라",
  msft: "마이크로소프트",
  ndx: "나스닥 100 · POINT",
  skh: "SK하이닉스",
  samsung: "삼성전자",
  lg: "LG전자",
};
const patterns = { wave: "웨이브", slow: "슬로우", balanced: "밸런스" };
const operationLabels: Record<string, string> = {
  CONFIG_SAVE: "모의 조건 변경",
  INVITE_CREATE: "추천인 코드 발급",
  INVITE_STATUS: "추천인 코드 상태 변경",
  POINT_ADJUST: "체험 포인트 조정",
};
const tabs = [
  ["config", "종목별 설정"],
  ["invites", "추천인 코드"],
  ["users", "회원·포인트"],
  ["audit", "변경 기록"],
] as const;
type Tab = (typeof tabs)[number][0];
const format = (n: number) => new Intl.NumberFormat("ko-KR").format(n);
const date = (n: number) =>
  new Date(n).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
  });
const draftDefault: WorkroomAdminConfig = {
  instrument: "nvda",
  pattern: "wave",
  roi: 5,
  duration: 120,
  amplitude: 2,
  version: 1,
};
function Pager({
  page,
  total,
  onPage,
  disabled,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.pager}>
      <span>
        총 {format(total)}건 · {page} / {Math.max(1, Math.ceil(total / 20))}{" "}
        페이지
      </span>
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        이전
      </button>
      <button
        type="button"
        disabled={disabled || page * 20 >= total}
        onClick={() => onPage(page + 1)}
      >
        다음
      </button>
    </div>
  );
}
async function readResponse(response: Response) {
  const value = (await response.json()) as {
    data?: unknown;
    error?: { code: string; message: string };
  };
  if (!response.ok)
    throw Object.assign(
      new Error(value.error?.message || "응답을 확인하지 못했습니다."),
      { status: response.status, code: value.error?.code },
    );
  return value.data;
}
export function WorkroomConsole({ actorId }: { actorId: string }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: Tab = tabs.some(([key]) => key === requested)
    ? (requested as Tab)
    : "config";
  const [data, setData] = useState<WorkroomAdminState | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pages, setPages] = useState({ users: 1, invites: 1, audit: 1 }),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [draft, setDraft] = useState(draftDefault),
    [configReason, setConfigReason] = useState("");
  const [roiDirection, setRoiDirection] = useState<"POSITIVE" | "NEGATIVE">(
    "POSITIVE",
  );
  const configInstrument = useRef(draftDefault.instrument);
  const [inviteLabel, setInviteLabel] = useState(""),
    [maxUses, setMaxUses] = useState(20),
    [expiry, setExpiry] = useState(""),
    [inviteReason, setInviteReason] = useState("");
  const [userId, setUserId] = useState(""),
    [amount, setAmount] = useState(10000),
    [direction, setDirection] = useState<"CREDIT" | "DEBIT">("CREDIT"),
    [pointReason, setPointReason] = useState("");
  const [pending, setPending] = useState<ReviewedSubmission | null>(null),
    [review, setReview] = useState<ReviewedSubmission | null>(null);
  const pendingRef = useRef<ReviewedSubmission | null>(null);
  const serial = useRef(0);
  const initializedDraft = useRef(false);
  const reviewRef = useRef<HTMLElement>(null);
  const [readAt, setReadAt] = useState(0);
  const storageKey = `workroom-admin-reviewed-submission:${actorId}`;
  const locked = busy || pending !== null || review !== null;
  const load = useCallback(async () => {
    const current = ++serial.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        usersPage: String(pages.users),
        invitesPage: String(pages.invites),
        auditPage: String(pages.audit),
        pageSize: "20",
        search: query,
      });
      const value = await readResponse(
        await fetch(`/api/v1/admin/workroom/state?${params}`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
      );
      if (current !== serial.current) return;
      setData(value as WorkroomAdminState);
      setReadAt(Date.now());
      if (!initializedDraft.current) {
        const state = value as WorkroomAdminState;
        const selectedConfig =
          state.configs.find(
            (config) => config.instrument === configInstrument.current,
          ) || state.configs[0];
        if (selectedConfig) {
          configInstrument.current = selectedConfig.instrument;
          setDraft(selectedConfig);
          setRoiDirection(selectedConfig.roi < 0 ? "NEGATIVE" : "POSITIVE");
        }
        initializedDraft.current = true;
      }
      setError("");
    } catch (e) {
      if (current === serial.current)
        setError(
          e instanceof Error ? e.message : "운영 정보를 조회하지 못했습니다.",
        );
    } finally {
      if (current === serial.current) setLoading(false);
    }
  }, [pages, query]);
  const invalidateRead = useCallback(() => {
    serial.current++;
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      invalidateRead();
    };
  }, [load, invalidateRead]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const saved = JSON.parse(raw) as ReviewedSubmission;
          if (saved.key && saved.operation && saved.input && saved.signature) {
            pendingRef.current = saved;
            setPending(saved);
          }
        }
      } catch {
        setError(
          "저장된 요청을 확인하지 못했습니다. 변경 기록을 먼저 확인해주세요.",
        );
      }
    });
    return () => {
      active = false;
    };
  }, [storageKey]);
  useEffect(() => {
    if (review) {
      reviewRef.current?.scrollIntoView({
        block: "center",
        behavior: "instant",
      });
      reviewRef.current?.focus();
    }
  }, [review]);
  function remember(value: ReviewedSubmission | null) {
    pendingRef.current = value;
    setPending(value);
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* In-memory snapshot remains available for retry. */
    }
  }
  function prepare(operation: string, input: Record<string, unknown>) {
    setError("");
    try {
      setReview(reviewedSubmission(pendingRef.current, operation, input));
    } catch {
      setError(
        "결과 미확인 요청이 있습니다. 먼저 같은 요청으로 다시 확인해주세요.",
      );
    }
  }
  async function execute(submission: ReviewedSubmission) {
    if (busy) return;
    setBusy(true);
    setError("");
    setReview(null);
    remember(submission);
    try {
      const result = await readResponse(
        await fetch("/api/v1/admin/workroom/command", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": submission.key,
          },
          body: JSON.stringify({
            operation: submission.operation,
            input: submission.input,
          }),
        }),
      );
      remember(null);
      initializedDraft.current = false;
      setNotice(
        submission.operation === "INVITE_CREATE" &&
          result &&
          typeof result === "object" &&
          "code" in result
          ? `추천인 코드가 발급됐어요: ${String(result.code)}`
          : "변경 내용이 서버에 기록됐어요.",
      );
      await load();
    } catch (e) {
      const status =
        e && typeof e === "object" && "status" in e ? Number(e.status) : 0;
      if (status >= 400 && status < 500) {
        remember(null);
        initializedDraft.current = false;
        await load();
      }
      setError(
        e instanceof Error
          ? e.message
          : "결과를 확인하지 못했습니다. 같은 요청으로 재확인해주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setNotice("추천인 코드를 복사했어요.");
    } catch {
      setNotice("복사하지 못했습니다. 화면의 코드를 선택해 복사해주세요.");
    }
  }
  return (
    <div className={styles.console} data-ui-ready="/workroom">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>ADMIN WORKSPACE</span>
          <h1>워크룸 운영</h1>
          <p>모의 조건과 회원별 체험 포인트를 관리하세요.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy}
          aria-busy={loading}
        >
          {loading ? (
            <WorkroomLoading label="불러오는 중…" variant="inline" />
          ) : (
            "정보 새로고침"
          )}
        </button>
      </header>
      <div className={styles.disclosure}>
        <span>SIMULATION ONLY</span> 체험 포인트는 출금할 수 없으며 실제
        입출금과 별도 원장으로 관리됩니다. 실제 입금 승인·출금 처리는 금융
        메뉴에서 기존 절차로 진행합니다.
      </div>
      <nav className={styles.tabs} aria-label="워크룸 운영 메뉴">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`/workroom?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {pending && (
        <section className={styles.recovery}>
          <h2>이전 요청의 결과를 확인해주세요.</h2>
          <p>
            내용과 요청 번호를 그대로 유지했습니다. 같은 요청을 다시 보내면
            서버가 최초 결과를 확인합니다.
          </p>
          <small>
            {pending.operation} · {pending.key}
          </small>
          <button
            type="button"
            disabled={busy}
            onClick={() => void execute(pending)}
          >
            {busy ? (
              <WorkroomLoading label="확인 중…" variant="inline" />
            ) : (
              "동일한 요청으로 결과 재확인"
            )}
          </button>
        </section>
      )}
      {!data ? (
        <section className={styles.panel}>
          {loading ? (
            <WorkroomLoading
              label="운영 정보를 불러오고 있어요"
              announce={false}
            />
          ) : (
            <h2>운영 정보를 불러오지 못했어요.</h2>
          )}
          <p>서버에서 확인된 정보만 표시합니다.</p>
          <button type="button" disabled={loading} onClick={() => void load()}>
            다시 조회
          </button>
        </section>
      ) : (
        <>
          {tab === "config" && (
            <div className={`${styles.grid} ${styles.configGrid}`}>
              <section className={styles.panel}>
                <span className={styles.eyebrow}>SIMULATION SETTINGS</span>
                <h2>다음 회차의 모의 조건</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    prepare("CONFIG_SAVE", {
                      instrument: draft.instrument,
                      pattern: draft.pattern,
                      roi: draft.roi,
                      duration: draft.duration,
                      amplitude: draft.amplitude,
                      expectedVersion: draft.version,
                      reason: configReason,
                    });
                  }}
                >
                  <fieldset disabled={locked} className={styles.configFields}>
                    <div className={styles.settingsGroup}>
                      <h3>
                        <span>01</span> 적용할 종목과 경로
                      </h3>
                      <label>
                        카테고리 상품
                        <select
                          value={draft.instrument}
                          onChange={(e) => {
                            const next = data.configs.find(
                              (c) => c.instrument === e.target.value,
                            );
                            if (!next) return;
                            configInstrument.current = next.instrument;
                            setDraft(next);
                            setRoiDirection(
                              next.roi < 0 ? "NEGATIVE" : "POSITIVE",
                            );
                          }}
                        >
                          {data.configs.map((c) => (
                            <option key={c.instrument} value={c.instrument}>
                              {names[c.instrument] || c.instrument}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        움직임 패턴
                        <select
                          value={draft.pattern}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              pattern: e.target
                                .value as WorkroomAdminConfig["pattern"],
                            })
                          }
                        >
                          {Object.entries(patterns).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div
                        className={styles.patternCards}
                        role="group"
                        aria-label="모의 경로 패턴 선택"
                      >
                        {(
                          [
                            [
                              "wave",
                              "웨이브",
                              "반복되는 굴곡",
                              "M2 20 Q8 2 14 15 T26 14 T38 10 T50 5",
                            ],
                            [
                              "slow",
                              "슬로우",
                              "완만하게 이어지는 흐름",
                              "M2 22 C10 22 18 20 26 15 S40 6 50 4",
                            ],
                            [
                              "balanced",
                              "밸런스",
                              "고르게 이어지는 흐름",
                              "M2 22 Q10 18 18 17 T34 10 T50 4",
                            ],
                          ] as const
                        ).map(([key, label, description, path]) => (
                          <button
                            type="button"
                            key={key}
                            className={styles.patternCard}
                            aria-pressed={draft.pattern === key}
                            onClick={() => setDraft({ ...draft, pattern: key })}
                          >
                            <svg
                              viewBox="0 0 52 28"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path
                                d={path}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                            <strong>{label}</strong>
                            <small>{description}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={styles.settingsGroup}>
                      <h3>
                        <span>02</span> 종료 방향과 변동률
                      </h3>
                      <div className={styles.two}>
                        <label>
                          수익 방향
                          <select
                            className={
                              roiDirection === "NEGATIVE"
                                ? styles.directionNegative
                                : styles.directionPositive
                            }
                            value={roiDirection}
                            onChange={(e) => {
                              const next = e.target.value as
                                "POSITIVE" | "NEGATIVE";
                              setRoiDirection(next);
                              setDraft({
                                ...draft,
                                roi:
                                  (next === "NEGATIVE" ? -1 : 1) *
                                  Math.abs(draft.roi),
                              });
                            }}
                          >
                            <option value="POSITIVE">＋ 플러스 수익률</option>
                            <option value="NEGATIVE">− 마이너스 수익률</option>
                          </select>
                        </label>
                        <label>
                          수익률 크기 (%)
                          <input
                            type="number"
                            required
                            min={0}
                            max={50}
                            step="0.1"
                            value={Math.abs(draft.roi)}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                roi:
                                  (roiDirection === "NEGATIVE" ? -1 : 1) *
                                  Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                      <p className={styles.fieldHint}>
                        크기는 0~50%로 입력하세요. 선택한 방향은 0%에서도
                        유지됩니다.
                      </p>
                      <div
                        className={`${styles.roiSummary} ${roiDirection === "NEGATIVE" ? styles.directionNegative : styles.directionPositive}`}
                      >
                        <span>설정할 종료 변동률</span>
                        <strong>
                          {roiDirection === "NEGATIVE" ? "−" : "+"}
                          {Math.abs(draft.roi).toFixed(2)}%
                        </strong>
                      </div>
                    </div>
                    <div className={styles.settingsGroup}>
                      <h3>
                        <span>03</span> 진행 시간과 중간 움직임
                      </h3>
                      <label>
                        진행 시간 (초 · 최대 24시간)
                        <input
                          type="number"
                          required
                          min={30}
                          max={86400}
                          step={1}
                          value={draft.duration}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              duration: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <div
                        className={styles.timePresets}
                        role="group"
                        aria-label="진행 시간 빠른 선택"
                      >
                        {(
                          [
                            [30, "30초"],
                            [60, "1분"],
                            [120, "2분"],
                            [300, "5분"],
                          ] as const
                        ).map(([seconds, label]) => (
                          <button
                            type="button"
                            key={seconds}
                            aria-pressed={draft.duration === seconds}
                            onClick={() =>
                              setDraft({ ...draft, duration: seconds })
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className={styles.fieldHint}>
                        30~86,400초 사이에서 1초 단위로 설정합니다.
                      </p>
                      <label>
                        중간 변동 폭 (0~15)
                        <input
                          type="number"
                          required
                          min={0}
                          max={15}
                          step="0.1"
                          value={draft.amplitude}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              amplitude: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <p className={styles.fieldHint}>
                        경로 중간의 움직임 크기입니다. 종료 변동률과 별도로
                        설정합니다.
                      </p>
                    </div>
                    <div className={styles.settingsGroup}>
                      <h3>
                        <span>04</span> 변경 내용 기록
                      </h3>
                      <label>
                        변경 사유
                        <input
                          required
                          minLength={2}
                          maxLength={160}
                          value={configReason}
                          onChange={(e) => setConfigReason(e.target.value)}
                          placeholder="변경 목적을 기록해주세요"
                        />
                      </label>
                      <p className={styles.fieldHint}>
                        현재 버전 v{draft.version} · 저장한 조건은 다음 회차부터
                        적용됩니다. 진행 중인 회차의 조건은 유지됩니다.
                      </p>
                      <button className={styles.primary} type="submit">
                        변경 내용 검토
                      </button>
                    </div>
                  </fieldset>
                </form>
              </section>
              <section className={styles.panel}>
                <span className={styles.eyebrow}>PATH PREVIEW</span>
                <h2>{names[draft.instrument] || draft.instrument}</h2>
                <WorkroomConfigPreview
                  key={`${draft.instrument}:${draft.version}:${draft.pattern}:${draft.roi}:${draft.duration}:${draft.amplitude}`}
                  config={draft}
                />
              </section>
            </div>
          )}
          {tab === "invites" && (
            <>
              <div className={styles.createGrid}>
                <section className={styles.panel}>
                  <span className={styles.eyebrow}>INVITATION</span>
                  <h2>추천인 코드 발급</h2>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      prepare("INVITE_CREATE", {
                        label: inviteLabel,
                        maxUses,
                        expiresAt: new Date(expiry).toISOString(),
                        reason: inviteReason,
                      });
                    }}
                  >
                    <fieldset disabled={locked}>
                      <div className={styles.three}>
                        <label>
                          담당자·구분명
                          <input
                            maxLength={60}
                            value={inviteLabel}
                            onChange={(e) => setInviteLabel(e.target.value)}
                            placeholder="예: 11월 체험 초대"
                          />
                        </label>
                        <label>
                          가입 가능 인원
                          <input
                            type="number"
                            required
                            min={1}
                            max={1000}
                            step={1}
                            value={maxUses}
                            onChange={(e) => setMaxUses(Number(e.target.value))}
                          />
                        </label>
                        <label>
                          만료일시 (기기 현지 시간)
                          <input
                            type="datetime-local"
                            required
                            value={expiry}
                            onChange={(e) => setExpiry(e.target.value)}
                          />
                        </label>
                      </div>
                      <label>
                        발급 사유
                        <input
                          required
                          minLength={2}
                          maxLength={160}
                          value={inviteReason}
                          onChange={(e) => setInviteReason(e.target.value)}
                        />
                      </label>
                      <button className={styles.primary} type="submit">
                        코드 발급 검토
                      </button>
                    </fieldset>
                  </form>
                </section>
                <aside className={styles.createGuide}>
                  <span className={styles.eyebrow}>INVITATION GUIDE</span>
                  <h2>발급 전 확인하세요</h2>
                  <ol>
                    <li>
                      <div>
                        <strong>담당자와 사용 범위</strong>
                        <p>
                          구분명을 기록하면 발급한 코드를 나중에 구별하기
                          쉽습니다.
                        </p>
                      </div>
                    </li>
                    <li>
                      <div>
                        <strong>인원과 만료일시</strong>
                        <p>가입 가능 인원과 코드의 유효 기간을 확인하세요.</p>
                      </div>
                    </li>
                    <li>
                      <div>
                        <strong>검토 후 최종 발급</strong>
                        <p>
                          발급 사유를 입력하고 검토 화면에서 확인한 뒤
                          실행합니다.
                        </p>
                      </div>
                    </li>
                  </ol>
                </aside>
              </div>
              <section className={styles.panel}>
                <h2>발급한 추천인 코드</h2>
                <div className={styles.table}>
                  <table>
                    <thead>
                      <tr>
                        <th>코드 / 담당자</th>
                        <th>사용 인원</th>
                        <th>만료일시 (한국)</th>
                        <th>상태</th>
                        <th>관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.invites.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <button
                              type="button"
                              className={styles.code}
                              onClick={() => void copy(row.code)}
                              aria-label={`${row.code} 복사`}
                            >
                              {row.code} ↗
                            </button>
                            <small>{row.label || "구분명 없음"}</small>
                          </td>
                          <td>
                            {row.used} / {row.maxUses}
                          </td>
                          <td>{date(row.expiresAt)}</td>
                          <td>
                            {!row.enabled
                              ? "중지"
                              : row.expiresAt <= readAt
                                ? "만료"
                                : row.used >= row.maxUses
                                  ? "한도 소진"
                                  : "사용 가능"}
                          </td>
                          <td>
                            <button
                              type="button"
                              disabled={locked}
                              onClick={() =>
                                prepare("INVITE_STATUS", {
                                  id: row.id,
                                  enabled: !row.enabled,
                                  reason: row.enabled
                                    ? "운영자 검토 후 초대 코드 사용 중지"
                                    : "운영자 검토 후 초대 코드 다시 활성화",
                                })
                              }
                            >
                              {row.enabled ? "중지 검토" : "활성화 검토"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.invites.length === 0 && (
                    <p className={styles.empty}>발급한 코드가 없습니다.</p>
                  )}
                </div>
                <Pager
                  {...data.pagination.invites}
                  disabled={loading || busy}
                  onPage={(page) => setPages({ ...pages, invites: page })}
                />
              </section>
            </>
          )}
          {tab === "users" && (
            <>
              <section className={styles.panel}>
                <span className={styles.eyebrow}>PRACTICE POINTS</span>
                <h2>체험 포인트 지급·차감</h2>
                <p className={styles.muted}>
                  모의거래 포인트만 조정합니다. 실제 입금·출금 원장에는 영향을
                  주지 않습니다.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    prepare("POINT_ADJUST", {
                      userId,
                      direction,
                      amount,
                      reason: pointReason,
                    });
                  }}
                >
                  <fieldset disabled={locked}>
                    <div className={styles.three}>
                      <label>
                        대상 회원
                        <select
                          required
                          value={userId}
                          onChange={(e) => setUserId(e.target.value)}
                        >
                          <option value="">현재 조회한 회원에서 선택</option>
                          {data.users.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name} · {user.email}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        조정 구분
                        <select
                          required
                          value={direction}
                          onChange={(e) =>
                            setDirection(e.target.value as "CREDIT" | "DEBIT")
                          }
                        >
                          <option value="CREDIT">지급</option>
                          <option value="DEBIT">차감</option>
                        </select>
                      </label>
                      <label>
                        포인트 (P)
                        <input
                          type="number"
                          required
                          min={1}
                          max={
                            direction === "DEBIT"
                              ? (data.users.find((user) => user.id === userId)
                                  ?.balance ?? 0)
                              : 1000000
                          }
                          step={1}
                          value={amount}
                          onChange={(e) => setAmount(Number(e.target.value))}
                        />
                      </label>
                    </div>
                    <label>
                      {direction === "DEBIT" ? "차감 사유" : "지급 사유"}
                      <input
                        required
                        minLength={2}
                        maxLength={160}
                        value={pointReason}
                        onChange={(e) => setPointReason(e.target.value)}
                        placeholder={
                          direction === "DEBIT"
                            ? "예: 중복 지급 정정"
                            : "예: 추가 체험 포인트"
                        }
                      />
                    </label>
                    <button className={styles.primary} type="submit">
                      변경 내용 검토
                    </button>
                  </fieldset>
                </form>
              </section>
              <section className={styles.panel}>
                <h2>회원 조회</h2>
                <p>
                  <Link href="/members">전체 회원 가입 정보 보기 →</Link>
                </p>
                <form
                  className={styles.search}
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPages({ ...pages, users: 1 });
                    setQuery(search);
                  }}
                >
                  <label>
                    이름·이메일·회원 ID
                    <input
                      value={search}
                      maxLength={100}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="회원 검색"
                    />
                  </label>
                  <button type="submit" disabled={loading}>
                    조회
                  </button>
                </form>
                <div className={styles.table}>
                  <table>
                    <thead>
                      <tr>
                        <th>회원 / 이메일</th>
                        <th>체험 포인트</th>
                        <th>워크룸</th>
                        <th>가입 코드</th>
                        <th>시작 일시 (한국)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.users.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <Link href={`/members?id=${user.id}`}>
                              {user.name}
                            </Link>
                            <small>{user.email}</small>
                            <small>{user.id}</small>
                          </td>
                          <td>{format(user.balance)} P</td>
                          <td>{user.room}</td>
                          <td>{user.referral || "기존 회원"}</td>
                          <td>{date(user.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.users.length === 0 && (
                    <p className={styles.empty}>
                      조회된 워크룸 회원이 없습니다.
                    </p>
                  )}
                </div>
                <Pager
                  {...data.pagination.users}
                  disabled={loading || busy}
                  onPage={(page) => setPages({ ...pages, users: page })}
                />
              </section>
            </>
          )}
          {tab === "audit" && (
            <section className={styles.panel}>
              <span className={styles.eyebrow}>AUDIT TRAIL</span>
              <h2>운영 변경 기록</h2>
              <p className={styles.muted}>
                저장된 변경 내용과 실행 계정을 확인합니다.
              </p>
              <div className={styles.table}>
                <table>
                  <thead>
                    <tr>
                      <th>일시 (한국)</th>
                      <th>작업 / 대상</th>
                      <th>실행 계정</th>
                      <th>내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.audit.map((row) => (
                      <tr key={row.id}>
                        <td>{date(row.createdAt)}</td>
                        <td>
                          {row.operation === "POINT_ADJUST"
                            ? row.input.direction === "DEBIT"
                              ? "체험 포인트 차감"
                              : "체험 포인트 지급"
                            : operationLabels[row.operation] || row.operation}
                          <small>{names[row.target] || row.target}</small>
                        </td>
                        <td>{row.actor}</td>
                        <td>
                          <details>
                            <summary>
                              {String(row.input.reason || "변경 내용 보기")}
                            </summary>
                            <pre>{JSON.stringify(row.input, null, 2)}</pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.audit.length === 0 && (
                  <p className={styles.empty}>아직 변경 기록이 없습니다.</p>
                )}
              </div>
              <Pager
                {...data.pagination.audit}
                disabled={loading || busy}
                onPage={(page) => setPages({ ...pages, audit: page })}
              />
            </section>
          )}
        </>
      )}
      <footer className={styles.footer}>
        <span>WORKROOM · 무료 모의 체험 운영</span>
        <Link href="/members">회원·입출금 관리 ↗</Link>
      </footer>
      {review && (
        <section
          className={styles.review}
          ref={reviewRef}
          tabIndex={-1}
          role="region"
          aria-label="운영 변경 검토"
        >
          <div>
            <span className={styles.eyebrow}>REVIEW BEFORE SAVE</span>
            <h2>변경 내용을 확인해주세요.</h2>
            <p>이 작업은 체험 전용이며 변경 사유와 함께 기록됩니다.</p>
            <dl>
              <dt>작업</dt>
              <dd>
                {review.operation === "POINT_ADJUST"
                  ? "체험 포인트 지급·차감"
                  : review.operation}
              </dd>
              {Object.entries(review.input).map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {(
                      {
                        instrument: "상품",
                        pattern: "패턴",
                        roi: "최종 수익률",
                        duration: "진행 시간 (초)",
                        amplitude: "변동 폭",
                        expectedVersion: "현재 버전",
                        reason: "사유",
                        userId: "대상 회원",
                        direction: "조정 구분",
                        amount: "포인트",
                        label: "구분명",
                        maxUses: "가입 가능 인원",
                        expiresAt: "만료 일시",
                        id: "코드 ID",
                        enabled: "사용 허용",
                      } as Record<string, string>
                    )[key] || key}
                  </dt>
                  <dd>
                    {key === "roi"
                      ? `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`
                      : key === "direction"
                        ? value === "CREDIT"
                          ? "지급"
                          : "차감"
                        : typeof value === "boolean"
                          ? value
                            ? "허용"
                            : "중지"
                          : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
            <div className={styles.actions}>
              <button type="button" onClick={() => setReview(null)}>
                돌아가서 수정
              </button>
              <button
                className={styles.primary}
                type="button"
                onClick={() => void execute(review)}
              >
                확인하고 저장
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
