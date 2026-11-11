"use client";
import Link from "next/link";
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
import { simulationValue } from "../../../../../domain/workroom/contracts";
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
function Preview({ config }: { config: WorkroomAdminConfig }) {
  const hours = Math.floor(config.duration / 3600);
  const minutes = Math.floor((config.duration % 3600) / 60);
  const seconds = config.duration % 60;
  const durationLabel = [
    hours ? `${hours}시간` : "",
    minutes ? `${minutes}분` : "",
    seconds || (!hours && !minutes) ? `${seconds}초` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const values = Array.from({ length: 121 }, (_, i) =>
    simulationValue(config, i / 120),
  );
  const min = Math.min(...values) - 2,
    max = Math.max(...values) + 2;
  const points = values
    .map(
      (v, i) =>
        `${24 + (i / 120) * 552},${190 - ((v - min) / (max - min)) * 160}`,
    )
    .join(" ");
  return (
    <div className={styles.preview}>
      <div className={styles.endpoint}>
        <span>시작 지수 100.00</span>
        <strong>
          최종 수익률 {config.roi >= 0 ? "+" : ""}
          {config.roi.toFixed(2)}%
        </strong>
      </div>
      <svg
        viewBox="0 0 600 230"
        role="img"
        aria-label={`${patterns[config.pattern]} 모의 경로의 표시용 미리보기. 최종 변동률 ${config.roi}퍼센트.`}
      >
        {[30, 70, 110, 150, 190].map((y) => (
          <line
            key={y}
            x1="24"
            x2="576"
            y1={y}
            y2={y}
            stroke="#2c4055"
            strokeDasharray="3 5"
          />
        ))}
        <polyline
          points={points}
          fill="none"
          stroke="#73efc3"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <text x="24" y="222" fill="#a6b7ca" fontSize="12">
          00:00
        </text>
        <text x="540" y="222" fill="#a6b7ca" fontSize="12">
          {durationLabel}
        </text>
      </svg>
      <p>
        표시용 예상 경로입니다. 실제 체험 계산은 서버가 저장된 조건으로
        처리합니다. 진행 중 회차는 시작 당시 조건을 유지합니다.
      </p>
    </div>
  );
}
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
        setDraft(
          (previous) =>
            state.configs.find(
              (config) => config.instrument === previous.instrument,
            ) ||
            state.configs[0] ||
            previous,
        );
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
        >
          {loading ? "불러오는 중…" : "정보 새로고침"}
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
            {busy ? "확인 중…" : "동일한 요청으로 결과 재확인"}
          </button>
        </section>
      )}
      {!data ? (
        <section className={styles.panel}>
          <h2>
            {loading
              ? "운영 정보를 확인하고 있어요."
              : "운영 정보를 불러오지 못했어요."}
          </h2>
          <p>서버에서 확인된 정보만 표시합니다.</p>
          <button type="button" disabled={loading} onClick={() => void load()}>
            다시 조회
          </button>
        </section>
      ) : (
        <>
          {tab === "config" && (
            <div className={styles.grid}>
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
                  <fieldset disabled={locked}>
                    <label>
                      카테고리 상품
                      <select
                        value={draft.instrument}
                        onChange={(e) =>
                          setDraft(
                            data.configs.find(
                              (c) => c.instrument === e.target.value,
                            ) || draft,
                          )
                        }
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
                    <div className={styles.three}>
                      <label>
                        수익 방향
                        <select
                          value={draft.roi < 0 ? "NEGATIVE" : "POSITIVE"}
                          onChange={(e) => {
                            const sign = e.target.value === "NEGATIVE" ? -1 : 1;
                            setDraft({
                              ...draft,
                              roi: sign * Math.abs(draft.roi),
                            });
                          }}
                        >
                          <option value="POSITIVE">플러스 수익률</option>
                          <option value="NEGATIVE">마이너스 수익률</option>
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
                          onChange={(e) => {
                            const sign = draft.roi < 0 ? -1 : 1;
                            setDraft({
                              ...draft,
                              roi: sign * Number(e.target.value),
                            });
                          }}
                        />
                      </label>
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
                    </div>
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
                    <p className={styles.muted}>
                      현재 버전 v{draft.version} · 다른 운영자가 먼저 저장하면
                      최신 조건을 다시 확인합니다.
                    </p>
                    <button className={styles.primary} type="submit">
                      변경 내용 검토
                    </button>
                  </fieldset>
                </form>
              </section>
              <section className={styles.panel}>
                <span className={styles.eyebrow}>PATH PREVIEW</span>
                <h2>{names[draft.instrument] || draft.instrument}</h2>
                <Preview config={draft} />
              </section>
            </div>
          )}
          {tab === "invites" && (
            <>
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
                            {user.name}
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
