"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  sessionValue,
  type WorkroomSession,
  type WorkroomState,
} from "@/domain/workroom/contracts";
import {
  WorkroomCommandQueue,
  isValidWorkroomStake,
  type WorkroomOperation,
} from "./command-client";
import styles from "./workroom.module.css";
import experience from "./workroom-experience.module.css";
import { WorkroomChart } from "./workroom-chart";
import { WorkroomLoading } from "../ui/workroom-loading";
const instruments = [
  { id: "usd", name: "달러환율", category: "fx" },
  { id: "cny", name: "위안화환율", category: "fx" },
  { id: "jpy", name: "엔화환율 · 100 JPY", category: "fx" },
  { id: "nvda", name: "엔비디아", category: "stocks" },
  { id: "tsla", name: "테슬라", category: "stocks" },
  { id: "msft", name: "마이크로소프트", category: "stocks" },
  { id: "ndx", name: "나스닥100", category: "stocks" },
  { id: "skh", name: "SK하이닉스", category: "stocks" },
  { id: "samsung", name: "삼성전자", category: "stocks" },
  { id: "lg", name: "LG전자", category: "stocks" },
];
const patterns = { wave: "웨이브", slow: "슬로우", balanced: "밸런스" };
const money = (n: number | null) => Math.round(n ?? 0).toLocaleString("ko-KR");
const signed = (n: number | null) => `${(n ?? 0) >= 0 ? "+" : ""}${money(n)}`;
const date = (n: number | string | null) =>
  n === null
    ? "—"
    : new Date(n).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
type Quote = {
  price: number;
  currency: string;
  unit: string;
  source: string;
  asOf: string;
  fetchedAt: string;
  isFallback: boolean;
};
type Page = "room" | "history" | "points" | "guide";
function History({ rows }: { rows: WorkroomSession[] }) {
  if (!rows.length)
    return (
      <div className={styles.empty}>첫 번째 참여를 마치면 기록이 표시돼요.</div>
    );
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <caption>서버에서 확정한 최근 참여 기록</caption>
        <thead>
          <tr>
            <th scope="col">종료 일시 (한국)</th>
            <th scope="col">항목</th>
            <th scope="col">참여 포인트</th>
            <th scope="col">종료 포인트</th>
            <th scope="col">변동</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{date(r.closedAt)}</td>
              <td>
                {instruments.find((i) => i.id === r.instrument)?.name ??
                  r.instrument}
              </td>
              <td>{money(r.stake)} P</td>
              <td>{money(r.returned)} P</td>
              <td
                className={
                  (r.profit ?? 0) >= 0 ? styles.positive : styles.negative
                }
              >
                {signed(r.profit)} P
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function WorkroomClient({
  page = "room",
  ownerUserId,
}: {
  page?: Page;
  ownerUserId: string;
}) {
  const [state, setState] = useState<WorkroomState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("nvda"),
    [amount, setAmount] = useState("50000"),
    [now, setNow] = useState(0);
  const [hasPending, setHasPending] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({}),
    [quoteError, setQuoteError] = useState(""),
    [quoteBusy, setQuoteBusy] = useState(false);
  const queue = useRef<WorkroomCommandQueue | null>(null),
    owner = useRef("");
  const lock = useRef(false),
    revision = useRef(0),
    offset = useRef(0),
    alive = useRef(true),
    syncAttempt = useRef("");
  const accept = useCallback(
    (next: WorkroomState) => {
      if (!alive.current) return;
      offset.current = next.serverNow - Date.now();
      const nextOwner = ownerUserId;
      if (owner.current !== nextOwner) {
        owner.current = nextOwner;
        let storage: Storage | undefined;
        try {
          storage = window.sessionStorage;
        } catch {
          /* Storage may be disabled. */
        }
        queue.current = new WorkroomCommandQueue(nextOwner, storage);
      }
      setHasPending(Boolean(queue.current?.current()));
      setState(next);
      setNow(Date.now() + offset.current);
    },
    [ownerUserId],
  );
  const refresh = useCallback(async () => {
    const requestRevision = revision.current;
    const response = await fetch("/api/v1/workroom/state", {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(20000),
    });
    const payload = (await response.json()) as {
      data?: WorkroomState;
      error?: { message?: string };
    };
    if (!response.ok || !payload.data)
      throw new Error(
        payload.error?.message ||
          "워크룸을 불러오지 못했습니다. 다시 시도해 주세요.",
      );
    if (requestRevision === revision.current) accept(payload.data);
  }, [accept]);
  const command = useCallback(
    async (
      operation?: WorkroomOperation,
      input: Record<string, unknown> = {},
    ) => {
      if (lock.current || !queue.current) return;
      lock.current = true;
      revision.current += 1;
      setBusy(true);
      setError("");
      try {
        if (operation) queue.current.prepare(operation, input);
        setHasPending(Boolean(queue.current.current()));
        const submittedOperation = queue.current.current()?.operation;
        const next = await queue.current.send();
        revision.current += 1;
        accept(next);
        if (submittedOperation === "START")
          setNotice(
            "모의 참여를 시작했습니다. 진행 중인 회차 조건은 고정됩니다.",
          );
        else if (
          submittedOperation === "FINISH" ||
          submittedOperation === "SYNC"
        ) {
          const result = next.history[0];
          if (result && !next.active)
            setNotice(
              `모의 참여를 마쳤습니다. 종료 ${money(result.returned)} P · 변동 ${signed(result.profit)} P`,
            );
        } else setNotice("워크룸이 준비되었습니다.");
        try {
          await refresh();
        } catch {
          /* Successful mutation is already confirmed. */
        }
      } catch (e) {
        if (alive.current)
          setError(
            e instanceof Error ? e.message : "요청 결과를 확인하지 못했습니다.",
          );
        try {
          await refresh();
        } catch {
          /* Keep original error and pending retry. */
        }
      } finally {
        lock.current = false;
        if (alive.current) {
          setBusy(false);
          setHasPending(Boolean(queue.current?.current()));
        }
      }
    },
    [accept, refresh],
  );
  const loadQuotes = useCallback(async () => {
    setQuoteBusy(true);
    try {
      const response = await fetch("/api/v1/workroom/quotes", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = (await response.json()) as {
        data?: { quotes: Record<string, Quote> };
      };
      if (!response.ok || !payload.data) throw new Error();
      if (alive.current) {
        setQuotes(payload.data.quotes);
        setQuoteError("");
      }
    } catch {
      if (alive.current)
        setQuoteError(
          "참고 가격을 불러오지 못했습니다. 모의 참여는 계속 이용할 수 있습니다.",
        );
    } finally {
      if (alive.current) setQuoteBusy(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh().catch((e) => {
      if (alive.current)
        setError(e instanceof Error ? e.message : "연결을 확인해 주세요.");
    });
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset.current), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void loadQuotes(), 0);
    return () => clearTimeout(timer);
  }, [loadQuotes]);
  useEffect(() => {
    const reload = () => {
      if (document.visibilityState === "visible" && !lock.current)
        void refresh().catch(() => {});
    };
    document.addEventListener("visibilitychange", reload);
    const timer = setInterval(reload, 10000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", reload);
    };
  }, [refresh]);
  useEffect(() => {
    const active = state?.active;
    if (
      !active ||
      now < active.started + active.duration * 1000 ||
      syncAttempt.current === active.id ||
      hasPending ||
      busy
    )
      return;
    syncAttempt.current = active.id;
    void command("SYNC", {});
  }, [state?.active, now, hasPending, busy, command]);
  const recovery = (
    <div className={styles.error} role="alert">
      <p>{error || "이전 요청 결과가 아직 확인되지 않았습니다."}</p>
      {hasPending ? (
        <button
          className={styles.secondary}
          disabled={busy}
          onClick={() => void command()}
        >
          같은 요청 결과 다시 확인
        </button>
      ) : (
        <button
          className={styles.secondary}
          disabled={busy}
          onClick={() => {
            setError("");
            void refresh().catch((e) =>
              setError(
                e instanceof Error ? e.message : "연결을 확인해 주세요.",
              ),
            );
          }}
        >
          다시 불러오기
        </button>
      )}
    </div>
  );
  if (!state)
    return (
      <div className={styles.loading}>
        {error ? <h1>워크룸을 준비하고 있어요.</h1> : null}
        {error ? (
          recovery
        ) : (
          <WorkroomLoading
            label="계정과 최근 기록을 불러오고 있어요"
            variant="page"
          />
        )}
      </div>
    );
  if (!state.member)
    return (
      <div className={styles.loading}>
        <span className={styles.eyebrow}>WELCOME TO WORKROOM</span>
        <h1>나만의 워크룸을 개설하세요.</h1>
        <p>무료 체험 포인트 100,000 P는 계정당 한 번 지급됩니다.</p>
        <p className={styles.disclosure}>
          실제 거래와 분리된 무료 시뮬레이션입니다. 연습 포인트는 현금으로
          전환되지 않습니다.
        </p>
        {error || hasPending ? recovery : null}
        <button
          className={styles.primary}
          disabled={busy || hasPending}
          onClick={() => void command("OPEN", {})}
        >
          {busy ? (
            <WorkroomLoading label="개설 확인 중…" variant="inline" />
          ) : (
            "내 워크룸 개설"
          )}
        </button>
      </div>
    );
  const member = state.member,
    active = state.active,
    latestResult = state.history[0];
  const instrument =
    instruments.find((i) => i.id === (active?.instrument ?? selected)) ??
    instruments[3]!;
  const selectedConfig = state.configs.find((c) => c.instrument === selected);
  const config = active ?? selectedConfig,
    quote = quotes[instrument.id];
  const view = active
    ? sessionValue(active, now)
    : {
        progress: 0,
        value: 100,
        returned: Number(amount),
        remaining: config?.duration ?? 0,
      };
  const profit = view.returned - (active?.stake ?? Number(amount)),
    validStake = isValidWorkroomStake(Number(amount), member.balance);
  const remaining = `${Math.floor(view.remaining / 60)
      .toString()
      .padStart(2, "0")}:${(view.remaining % 60).toString().padStart(2, "0")}`,
    overdue = Boolean(active && now >= active.started + active.duration * 1000);
  return (
    <div
      className={page === "room" ? experience.room : undefined}
      data-ui-ready={`/workroom${page === "room" ? "" : `/${page}`}`}
    >
      {notice ? (
        <p className={styles.disclosure} role="status">
          {notice} <Link href="/workroom/history">참여 내역 보기 →</Link>
        </p>
      ) : null}
      {error || hasPending ? recovery : null}
      {page === "room" && (
        <>
          <section className={`${styles.title} ${experience.title}`}>
            <div>
              <span className={styles.eyebrow}>MY WORKROOM</span>
              <h1>흐름을 보고, 순간을 선택하세요.</h1>
              <span className={styles.roomId}>{member.room}</span>
            </div>
            <span className={styles.badge}>무료 시뮬레이션</span>
          </section>
          <div className={`${styles.selectors} ${experience.selectors}`}>
            <label>
              카테고리
              <select
                aria-label="모니터링 카테고리"
                value={instrument.category}
                disabled={Boolean(active) || busy || hasPending}
                onChange={(e) => {
                  setSelected(
                    instruments.find((i) => i.category === e.target.value)
                      ?.id ?? "nvda",
                  );
                }}
              >
                <option value="fx">환율</option>
                <option value="stocks">주식</option>
              </select>
            </label>
            <label>
              모니터링 항목
              <select
                aria-label="모니터링 항목"
                value={instrument.id}
                disabled={Boolean(active) || busy || hasPending}
                onChange={(e) => {
                  setSelected(e.target.value);
                }}
              >
                {instruments
                  .filter((i) => i.category === instrument.category)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </select>
            </label>
            <span>모의 지수 · 실제 시세와 분리</span>
          </div>
          {config ? (
            <div className={`${styles.monitor} ${experience.monitor}`}>
              <section
                className={`${styles.panel} ${styles.chartPanel} ${experience.chartPanel}`}
              >
                <div className={styles.chartHeading}>
                  <span className={styles.running}>
                    {active
                      ? "모의 모니터링 진행 중"
                      : "모의 모니터링 준비 완료"}
                  </span>
                  <span className={styles.instrumentTag}>
                    {instrument.name}
                  </span>
                </div>
                {active && (
                  <div
                    className={`${styles.evaluation} ${experience.evaluation}`}
                  >
                    <span>현재 모의 평가 포인트 · 예상값</span>
                    <div className={styles.evaluationRow}>
                      <strong>
                        {money(view.returned)} <small>P</small>
                      </strong>
                      <span
                        className={
                          profit >= 0 ? styles.positive : styles.negative
                        }
                      >
                        {signed(profit)} P ({(view.value - 100).toFixed(2)}%)
                      </span>
                    </div>
                  </div>
                )}
                <div
                  className={experience.pattern}
                  aria-label="이번 회차에 설정된 모의 경로"
                >
                  <div>
                    <span>설정된 패턴</span>
                    <strong>{patterns[config.pattern]} 패턴</strong>
                  </div>
                  <div className={experience.patternEnd}>
                    <span>진행 시간</span>
                    <strong>{config.duration}초</strong>
                  </div>
                </div>
                <WorkroomChart
                  config={config}
                  progress={view.progress}
                  active={Boolean(active)}
                />
                <div className={experience.timeline}>
                  <div>
                    <span>{active ? "이번 회차 진행" : "모니터링 대기"}</span>
                    <strong>
                      {active
                        ? `${Math.floor(view.progress * 100)}%`
                        : `${config.duration}초`}
                    </strong>
                  </div>
                  <progress
                    aria-label={active ? "이번 회차 진행률" : "시작 대기"}
                    max={100}
                    value={view.progress * 100}
                  />
                  <div>
                    <span>시작 · 0초</span>
                    <span>
                      {active
                        ? `남은 시간 ${remaining}`
                        : `진행 시간 ${config.duration}초`}
                    </span>
                  </div>
                </div>
              </section>
              <section
                className={`${styles.panel} ${styles.session} ${experience.session}`}
              >
                <span className={experience.sessionEyebrow}>
                  {active ? "참여 진행 중" : "무료 모의 체험"}
                </span>
                <h2>{active ? "이번 모의 참여" : "모니터링 시작하기"}</h2>
                <p className={experience.sessionIntro}>
                  {active
                    ? "시작할 때 확인한 조건으로 진행됩니다."
                    : "참여 포인트를 정하고 시작하세요."}
                </p>
                <div className={styles.sessionLines}>
                  <div>
                    <span>참여 포인트</span>
                    <strong>{money(active?.stake ?? Number(amount))} P</strong>
                  </div>
                  <div>
                    <span>{active ? "남은 시간" : "진행 시간"}</span>
                    <strong className={styles.timer}>{remaining}</strong>
                  </div>
                  <div>
                    <span>설정 수익률</span>
                    <strong>
                      {config.roi >= 0 ? "+" : ""}
                      {config.roi.toFixed(2)}%
                    </strong>
                  </div>
                </div>
                {!active && (
                  <label className={styles.stake}>
                    참여할 체험 포인트
                    <input
                      aria-label="참여할 체험 포인트"
                      type="number"
                      min="1000"
                      step="1"
                      max={Math.min(member.balance, 1_000_000_000)}
                      value={amount}
                      disabled={busy || hasPending}
                      onChange={(e) => {
                        setAmount(e.target.value);
                      }}
                    />
                    <small>
                      사용 가능 {money(member.balance)} P · 정수 입력
                    </small>
                  </label>
                )}
                {active ? (
                  <button
                    className={styles.primary}
                    disabled={busy || hasPending}
                    onClick={() =>
                      void command(
                        overdue ? "SYNC" : "FINISH",
                        overdue ? {} : { id: active.id },
                      )
                    }
                  >
                    {busy ? (
                      <WorkroomLoading label="결과 확인 중…" variant="inline" />
                    ) : overdue ? (
                      "종료 결과 확인"
                    ) : (
                      "지금 모의 참여 종료"
                    )}
                  </button>
                ) : (
                  <button
                    className={styles.primary}
                    disabled={
                      busy || hasPending || !validStake || !selectedConfig
                    }
                    onClick={() => {
                      if (!selectedConfig) return;
                      void command("START", {
                        instrument: selected,
                        stake: Number(amount),
                        acknowledged: true,
                        expectedVersion: selectedConfig.version,
                      });
                    }}
                  >
                    {busy ? (
                      <WorkroomLoading label="참여 확인 중…" variant="inline" />
                    ) : (
                      "모니터링 시작"
                    )}
                  </button>
                )}
                <p className={`${styles.helper} ${styles.risk}`}>
                  체험 포인트 · 현금 전환 불가
                </p>
              </section>
            </div>
          ) : (
            <div className={styles.error}>
              참여 조건을 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.
            </div>
          )}
          {!active && latestResult?.status === "completed" && (
            <section
              className={experience.result}
              aria-label="최근 서버 확정 결과"
            >
              <div className={experience.resultHeading}>
                <span className={experience.resultIcon} aria-hidden="true">
                  ✓
                </span>
                <div>
                  <span className={experience.sessionEyebrow}>
                    서버 확정 결과
                  </span>
                  <h2>최근 모의 참여를 마쳤어요.</h2>
                  <p>
                    {instruments.find(
                      (item) => item.id === latestResult.instrument,
                    )?.name ?? latestResult.instrument}{" "}
                    · {date(latestResult.closedAt)}
                  </p>
                </div>
              </div>
              <dl>
                <div>
                  <dt>참여 포인트</dt>
                  <dd>{money(latestResult.stake)} P</dd>
                </div>
                <div>
                  <dt>종료 포인트</dt>
                  <dd>{money(latestResult.returned)} P</dd>
                </div>
                <div>
                  <dt>확정 변동</dt>
                  <dd
                    className={
                      (latestResult.profit ?? 0) >= 0
                        ? styles.positive
                        : styles.negative
                    }
                  >
                    {signed(latestResult.profit)} P
                  </dd>
                </div>
              </dl>
            </section>
          )}
          <section
            className={`${styles.reference} ${experience.reference}`}
            aria-label="실제 시장 참고 가격"
          >
            <div>
              <span>실제 시장 참고 가격 · {instrument.name}</span>
              <strong>
                {quote
                  ? `${Number(quote.price).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} ${quote.currency === "POINT" ? "pt" : quote.currency}`
                  : "참고 가격 없음"}
                {quote?.unit && <small> / {quote.unit}</small>}
              </strong>
            </div>
            <div className={styles.referenceMeta}>
              {quote ? (
                <>
                  {quote.source}
                  <br />
                  기준 {date(quote.asOf)} ·{" "}
                  {quote.isFallback ? "대체 스냅샷" : "제공처 조회"}
                  <br />
                  조회 {date(quote.fetchedAt)}
                </>
              ) : (
                quoteError || "가격을 조회하고 있습니다."
              )}
              <button disabled={quoteBusy} onClick={() => void loadQuotes()}>
                {quoteBusy ? (
                  <WorkroomLoading label="조회 중…" variant="inline" />
                ) : (
                  "가격 새로고침"
                )}
              </button>
            </div>
            <p>
              참고 가격은 모의 차트와 포인트 계산에 적용되지 않습니다. 제공처
              지연·휴장으로 현재가와 다를 수 있습니다.
              {quote && quoteError ? ` ${quoteError}` : ""}
            </p>
          </section>
          <section className={styles.balance}>
            <div>
              <span>사용 가능 체험 포인트</span>
              <strong>{money(member.balance)} P</strong>
            </div>
            <div>
              <span>참여 중</span>
              <strong>{money(active?.stake ?? 0)} P</strong>
            </div>
            <Link className={styles.secondary} href="/workroom/points">
              포인트 내역 →
            </Link>
          </section>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <h2>최근 참여 내역</h2>
              <Link href="/workroom/history">전체 보기 →</Link>
            </div>
            <History rows={state.history.slice(0, 3)} />
          </section>
        </>
      )}
      {page === "history" && (
        <>
          <Heading
            eyebrow="YOUR ACTIVITY"
            title="참여 내역"
            description="완료된 모의 참여와 서버에서 확정한 결과입니다."
          />
          <div className={styles.summary}>
            <Summary
              label="표시된 완료 참여"
              value={`${state.history.length}회`}
            />
            <Summary
              label="표시된 기록 포인트 변동"
              value={`${signed(state.history.reduce((s, r) => s + (r.profit ?? 0), 0))} P`}
            />
            <Summary label="진행 중인 참여" value={active ? "1회" : "0회"} />
          </div>
          {active && (
            <p className={styles.disclosure}>
              진행 중인 참여가 있습니다.{" "}
              <Link href="/workroom">내 워크룸에서 확인하기 →</Link>
            </p>
          )}
          <section className={`${styles.panel} ${styles.tablePanel}`}>
            <h2>최근 참여 기록</h2>
            <History rows={state.history} />
          </section>
        </>
      )}
      {page === "points" && (
        <>
          <Heading
            eyebrow="YOUR POINTS"
            title="체험 포인트"
            description="현금 가치가 없는 무료 모의 체험용 포인트입니다."
          />
          <div className={styles.summary}>
            <Summary label="사용 가능" value={`${money(member.balance)} P`} />
            <Summary label="참여 중" value={`${money(active?.stake ?? 0)} P`} />
            <Summary label="가입 지급 · 계정당 1회" value="100,000 P" />
          </div>
          <p className={styles.disclosure}>
            연습 포인트는 현금으로 전환하거나 출금할 수 없습니다. 실제
            입금·출금은 별도 잔액 메뉴에서 확인하세요.
          </p>
          <section className={`${styles.panel} ${styles.tablePanel}`}>
            <h2>최근 포인트 내역</h2>
            {state.ledger.length ? (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">일시 (한국)</th>
                      <th scope="col">내용</th>
                      <th scope="col">변동</th>
                      <th scope="col">반영 후 잔액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.ledger.map((r) => (
                      <tr key={r.id}>
                        <td>{date(r.createdAt)}</td>
                        <td>{r.note}</td>
                        <td
                          className={
                            r.amount >= 0 ? styles.positive : styles.negative
                          }
                        >
                          {signed(r.amount)} P
                        </td>
                        <td>{money(r.balanceAfter)} P</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.empty}>포인트 내역이 없습니다.</div>
            )}
          </section>
        </>
      )}
      {page === "guide" && (
        <>
          <Link href="/workroom/cash">실제 잔액·입금·출금 확인 →</Link>
          <Heading
            eyebrow="WORKROOM GUIDE"
            title="알고 시작하면, 더 간단하게."
            description="실제 가격 참고와 무료 모의 체험을 구분해 이용하세요."
          />
          <div className={styles.guide}>
            {[
              [
                "01",
                "기존 계정으로 간편하게",
                "기존 아이디와 비밀번호를 그대로 사용하세요. 신규 가입은 유효한 추천인 코드가 필요합니다. 체험 포인트 100,000 P는 계정당 한 번 지급됩니다.",
              ],
              [
                "02",
                "실제 시장 참고 가격",
                "환율·주가는 출처와 기준 시각을 함께 표시합니다. 지연·휴장·조회 실패로 현재가와 다를 수 있으며 모의 차트와는 별개입니다.",
              ],
              [
                "03",
                "사전에 공개된 모의 조건",
                "참여 전에 패턴·진행 시간·종료 변동률을 확인하세요. 모의 차트는 설정된 경로를 따르며 실제 시장 수익률을 예측하지 않습니다. 시작한 회차의 조건은 고정됩니다.",
              ],
              [
                "04",
                "포인트와 기록",
                "원하는 순간 종료하거나 시간이 끝나면 서버가 결과를 확정합니다. 연결이 끊겨도 계정의 회차는 유지됩니다. 다시 접속해 같은 요청 결과를 확인할 수 있습니다.",
              ],
            ].map(([n, t, d]) => (
              <section className={styles.panel} key={n}>
                <span>{n}</span>
                <h2>{t}</h2>
                <p>{d}</p>
              </section>
            ))}
          </div>
          <p className={styles.disclosure}>
            실제 증권·외환 계좌와 연결하지 않으며 주문을 전송하지 않습니다.
            포인트는 늘거나 줄 수 있고 현금으로 전환되지 않습니다.
          </p>
        </>
      )}
      <footer className={styles.footer}>
        <span>© 2026 WORKROOM</span>
        <span>무료 시뮬레이션 · 체험 포인트 현금 전환 불가</span>
        <Link href="/workroom/guide">이용 안내 →</Link>
      </footer>
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className={styles.title}>
      <div>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </section>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
