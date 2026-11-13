import Link from "next/link";
import type { Route } from "next";
import { PutdukIcon } from "../icons/putduk-icon";
import {
  WORKROOM_INSTRUMENTS,
  type WorkroomSession,
  type WorkroomState,
} from "../../domain/workroom/contracts";
import styles from "./participation-history.module.css";

type CompletedParticipation = Pick<
  WorkroomSession,
  "id" | "instrument" | "stake"
> & {
  returned: number;
  profit: number;
  closedAt: number;
  status: "completed";
};
const points = (value: number) => `${value.toLocaleString("ko-KR")} P`;
const signedPoints = (value: number) =>
  `${value > 0 ? "+" : ""}${points(value === 0 ? 0 : value)}`;
const outcome = (value: number) =>
  value > 0 ? "증가" : value < 0 ? "감소" : "변동 없음";
const tone = (value: number) =>
  value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
const instrument = (id: string) =>
  WORKROOM_INSTRUMENTS.find((item) => item.id === id);
const date = (value: number) =>
  new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));

function Disclosure() {
  return (
    <p className={styles.disclosure}>
      <PutdukIcon name="event" size={18} aria-hidden="true" />
      <span>
        무료 모의 참여 결과예요.
        <br />
        체험 포인트는 현금으로 전환하거나 출금할 수 없어요.
      </span>
    </p>
  );
}

export function ParticipationResult({
  result,
}: {
  result: CompletedParticipation;
}) {
  const item = instrument(result.instrument);
  return (
    <section
      className={styles.page}
      aria-labelledby="round-result-title"
      data-ui-ready="/workroom/history/result"
    >
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>WORKROOM · 참여 기록</span>
          <h1 id="round-result-title">참여 결과</h1>
          <p>서버에서 확정한 모의 참여 결과를 확인하세요.</p>
        </div>
        <span className={styles.complete}>참여 완료</span>
      </header>
      <div className={styles.resultCard}>
        <div className={styles.resultTop}>
          <div className={styles.instrument}>
            <span className={styles.instrumentMark} aria-hidden="true">
              {item?.symbol.slice(0, 1) ?? "W"}
            </span>
            <div>
              <span>{item?.categoryName ?? "모의 참여"}</span>
              <h2>{item?.name ?? result.instrument}</h2>
              <small>{item?.symbol ?? result.instrument}</small>
            </div>
          </div>
          <time dateTime={new Date(result.closedAt).toISOString()}>
            {date(result.closedAt)} 종료
          </time>
        </div>
        <div className={styles.hero}>
          <span>확정 종료 포인트</span>
          <strong>
            {result.returned.toLocaleString("ko-KR")}
            <small>P</small>
          </strong>
          <span className={styles.outcome} data-tone={tone(result.profit)}>
            {outcome(result.profit)} <b>{signedPoints(result.profit)}</b>
          </span>
        </div>
        <dl className={styles.metrics}>
          <div data-result-field="stake">
            <dt>참여 포인트</dt>
            <dd>{points(result.stake)}</dd>
            <dd className={styles.metricHelp}>시작할 때 사용한 포인트</dd>
          </div>
          <div data-result-field="returned">
            <dt>종료 포인트</dt>
            <dd>{points(result.returned)}</dd>
            <dd className={styles.metricHelp}>참여 종료 후 돌아온 포인트</dd>
          </div>
          <div data-result-field="profit" data-tone={tone(result.profit)}>
            <dt>포인트 변동</dt>
            <dd>{signedPoints(result.profit)}</dd>
            <dd className={styles.metricHelp}>{outcome(result.profit)}</dd>
          </div>
        </dl>
      </div>
      <section
        className={styles.details}
        aria-labelledby="participation-details-title"
      >
        <div className={styles.sectionHeading}>
          <h2 id="participation-details-title">참여 상세</h2>
          <span>확정 기록</span>
        </div>
        <dl>
          <div>
            <dt>참여 항목</dt>
            <dd>{item?.name ?? result.instrument}</dd>
          </div>
          <div>
            <dt>처리 상태</dt>
            <dd>
              <span className={styles.detailStatus}>참여 완료</span>
            </dd>
          </div>
          <div>
            <dt>종료 일시 (한국)</dt>
            <dd>
              <time dateTime={new Date(result.closedAt).toISOString()}>
                {date(result.closedAt)}
              </time>
            </dd>
          </div>
          <div className={styles.identifier}>
            <dt>참여 번호</dt>
            <dd>{result.id}</dd>
          </div>
        </dl>
      </section>
      <Disclosure />
      <nav className={styles.resultActions} aria-label="참여 결과 다음 메뉴">
        <Link className={styles.primary} href="/workroom">
          내 워크룸으로{" "}
          <PutdukIcon name="arrow-right" size={18} aria-hidden="true" />
        </Link>
        <Link className={styles.secondary} href="/workroom/history">
          전체 참여 내역 보기
        </Link>
      </nav>
    </section>
  );
}

export function ParticipationResultError({ retryHref }: { retryHref: string }) {
  return (
    <section className={styles.page} aria-labelledby="round-result-title">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>WORKROOM · 참여 기록</span>
          <h1 id="round-result-title">참여 결과</h1>
        </div>
      </header>
      <div className={styles.errorCard} role="alert">
        <span className={styles.errorIcon} aria-hidden="true">
          !
        </span>
        <h2>결과를 불러오지 못했어요</h2>
        <p>
          연결을 확인한 뒤 다시 확인해 주세요.
          <br />
          확정된 참여 기록은 그대로 유지돼요.
        </p>
        <Link className={styles.primary} href={retryHref as Route}>
          다시 확인
        </Link>
        <Link className={styles.textLink} href="/workroom/history">
          참여 내역으로
        </Link>
      </div>
    </section>
  );
}

export function ParticipationHistory({
  rows,
  active,
}: {
  rows: WorkroomSession[];
  active: WorkroomSession | null;
}) {
  const change = rows.reduce((sum, row) => sum + (row.profit ?? 0), 0);
  return (
    <section
      className={styles.page}
      aria-labelledby="participation-history-title"
    >
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>WORKROOM · 참여 기록</span>
          <h1 id="participation-history-title">참여 내역</h1>
          <p>완료된 모의 참여와 서버에서 확정한 결과입니다.</p>
        </div>
        <Link className={styles.secondary} href="/workroom">
          내 워크룸{" "}
          <PutdukIcon name="arrow-right" size={18} aria-hidden="true" />
        </Link>
      </header>
      <dl className={styles.summary}>
        <div>
          <dt>표시된 완료 참여</dt>
          <dd>
            {rows.length.toLocaleString("ko-KR")}
            <small>회</small>
          </dd>
        </div>
        <div data-tone={tone(change)}>
          <dt>표시된 기록 포인트 변동</dt>
          <dd>{signedPoints(change)}</dd>
        </div>
        <div>
          <dt>진행 중인 참여</dt>
          <dd>
            {active ? "1" : "0"}
            <small>회</small>
          </dd>
        </div>
      </dl>
      {active ? (
        <aside className={styles.activeNotice}>
          <span className={styles.activeDot} aria-hidden="true" />
          <div>
            <strong>진행 중인 참여가 있어요</strong>
            <p>완료되면 이곳에서 확정 결과를 확인할 수 있어요.</p>
          </div>
          <Link href="/workroom">내 워크룸에서 확인하기 →</Link>
        </aside>
      ) : null}
      <section
        className={styles.historyCard}
        aria-labelledby="recent-history-title"
      >
        <div className={styles.sectionHeading}>
          <h2 id="recent-history-title">최근 참여 기록</h2>
          <span>{rows.length.toLocaleString("ko-KR")}건</span>
        </div>
        {rows.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table} role="table">
              <caption>
                서버에서 확정한 최근 참여 기록. 시간은 한국 기준입니다.
              </caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col">참여 항목 · 종료 일시</th>
                  <th scope="col">참여 포인트</th>
                  <th scope="col">종료 포인트</th>
                  <th scope="col">포인트 변동</th>
                  <th scope="col">
                    <span className={styles.srOnly}>결과 확인</span>
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((row) => {
                  const item = instrument(row.instrument);
                  const confirmed =
                    row.status === "completed" &&
                    row.returned !== null &&
                    row.profit !== null &&
                    row.closedAt !== null;
                  return (
                    <tr key={row.id} role="row">
                      <td className={styles.rowIdentity} role="cell">
                        <span className={styles.rowCategory}>
                          {item?.categoryName ?? "모의 참여"}
                        </span>
                        <strong>{item?.name ?? row.instrument}</strong>
                        <span className={styles.rowStatus}>
                          {confirmed
                            ? "참여 완료"
                            : row.status === "active"
                              ? "진행 중"
                              : "결과 확인 중"}
                        </span>
                        {row.closedAt !== null ? (
                          <time dateTime={new Date(row.closedAt).toISOString()}>
                            {date(row.closedAt)}
                          </time>
                        ) : (
                          <span className={styles.rowTime}>종료 전</span>
                        )}
                      </td>
                      <td data-label="참여 포인트" role="cell">
                        {points(row.stake)}
                      </td>
                      <td data-label="종료 포인트" role="cell">
                        {confirmed ? points(row.returned!) : "확인 중"}
                      </td>
                      <td
                        data-label="포인트 변동"
                        role="cell"
                        data-tone={confirmed ? tone(row.profit!) : "neutral"}
                      >
                        <strong>
                          {confirmed ? signedPoints(row.profit!) : "확인 중"}
                        </strong>
                        {confirmed ? (
                          <small className={styles.changeLabel}>
                            {outcome(row.profit!)}
                          </small>
                        ) : null}
                      </td>
                      <td className={styles.rowAction} role="cell">
                        {confirmed ? (
                          <Link
                            href={`/workroom/history?round=${row.id}` as Route}
                            aria-label={`${item?.name ?? row.instrument} ${date(row.closedAt!)} 참여 결과 보기`}
                          >
                            결과 보기{" "}
                            <PutdukIcon
                              name="arrow-right"
                              size={16}
                              aria-hidden="true"
                            />
                          </Link>
                        ) : (
                          <span>종료 후 확인</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">
              ≡
            </span>
            <h3>아직 완료된 참여가 없어요</h3>
            <p>
              첫 번째 모의 참여를 마치면
              <br />
              확정된 결과를 이곳에서 확인할 수 있어요.
            </p>
            <Link className={styles.primary} href="/workroom">
              내 워크룸으로 →
            </Link>
          </div>
        )}
      </section>
      <Disclosure />
    </section>
  );
}

export function ParticipationPointsLedger({
  rows,
}: {
  rows: WorkroomState["ledger"];
}) {
  return (
    <section
      className={`${styles.page} ${styles.historyCard}`}
      aria-labelledby="points-history-title"
    >
      <div className={styles.sectionHeading}>
        <h2 id="points-history-title">최근 포인트 내역</h2>
        <span>{rows.length.toLocaleString("ko-KR")}건</span>
      </div>
      {rows.length ? (
        <div className={styles.tableWrap}>
          <table
            className={`${styles.table} ${styles.ledgerTable}`}
            role="table"
          >
            <caption>
              서버에 기록된 체험 포인트 내역. 시간은 한국 기준입니다.
            </caption>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col">일시 (한국)</th>
                <th scope="col">내용</th>
                <th scope="col">변동</th>
                <th scope="col">반영 후 잔액</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {rows.map((row) => (
                <tr key={row.id} role="row">
                  <td
                    className={styles.ledgerDate}
                    data-label="일시 (한국)"
                    role="cell"
                  >
                    <time dateTime={new Date(row.createdAt).toISOString()}>
                      {date(row.createdAt)}
                    </time>
                  </td>
                  <td
                    className={styles.ledgerNote}
                    data-label="내용"
                    role="cell"
                  >
                    {row.note}
                  </td>
                  <td
                    data-label="변동"
                    data-tone={tone(row.amount)}
                    role="cell"
                  >
                    <strong>{signedPoints(row.amount)}</strong>
                  </td>
                  <td data-label="반영 후 잔액" role="cell">
                    {points(row.balanceAfter)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            ≡
          </span>
          <h3>포인트 내역이 없습니다.</h3>
          <p>
            체험 포인트가 변동되면
            <br />
            서버에 기록된 내역을 이곳에서 확인할 수 있어요.
          </p>
          <Link className={styles.secondary} href="/workroom">
            내 워크룸으로 →
          </Link>
        </div>
      )}
    </section>
  );
}
