import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import type { AdminPrincipal } from "@/lib/auth/principal";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { formatKst } from "@/app/(control)/_lib/format";
import { WORKROOM_INSTRUMENTS } from "../../../../../domain/workroom/contracts";
import styles from "./members.module.css";
const points = z.number().int().safe();
const report = z.object({
  userId: z.uuid(),
  account: z
    .object({ balance: points.nonnegative(), held: points.nonnegative() })
    .nullable(),
  roundCount: points.nonnegative(),
  ledgerCount: points.nonnegative(),
  rounds: z.array(
    z.object({
      id: z.string(),
      instrument: z.string(),
      stake: points.positive(),
      roi: z.number(),
      pattern: z.enum(["wave", "slow", "balanced"]),
      duration: points.positive(),
      startedAt: points,
      closedAt: points.nullable(),
      returned: points.nonnegative().nullable(),
      profit: points.nullable(),
    }),
  ),
  ledger: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["WELCOME", "STAKE", "SETTLEMENT", "ADJUSTMENT"]),
      amount: points,
      balanceAfter: points.nonnegative(),
      note: z.string(),
      roundId: z.string().nullable(),
      createdAt: points,
    }),
  ),
});
const names = new Map<string, string>(
  WORKROOM_INSTRUMENTS.map((item) => [item.id, item.name]),
);
const number = (value: number) => value.toLocaleString("ko-KR");
const signed = (value: number) => `${value > 0 ? "+" : ""}${number(value)}`;
const date = (value: number) => formatKst(new Date(value).toISOString());
export async function MemberWorkroomActivity({
  principal,
  userId,
  roundPage,
  pointPage,
}: {
  principal: AdminPrincipal;
  userId: string;
  roundPage: number;
  pointPage: number;
}) {
  if (!HIGH_IMPACT_ROLES.includes(principal.role)) return null;
  let raw: unknown = null;
  try {
    const result = await principal.supabase.rpc("workroom_admin_command", {
      p_operation: "MEMBER_HISTORY",
      p_request_key: null,
      p_input: { userId, roundPage, pointPage },
      p_actor: principal.userId,
      p_admin_session_id: principal.adminSessionId,
      p_auth_session_id: principal.sessionId,
      p_verified_aal: principal.aal,
    });
    if (!result.error) raw = result.data;
  } catch {
    /* Keep an unavailable result separate from a true empty history. */
  }
  const parsed = report.safeParse(raw);
  if (!parsed.success || parsed.data.userId !== userId)
    return (
      <section
        className={styles.directory}
        id="member-workroom-activity"
        aria-labelledby="workroom-activity-title"
      >
        <h2 id="workroom-activity-title">모의 참여·포인트 거래 내역</h2>
        <p role="alert">내역을 불러오지 못했습니다. 새로고침해 주세요.</p>
      </section>
    );
  const data = parsed.data;
  const href = (r: number, p: number) =>
    `/members?id=${userId}&roundPage=${r}&pointPage=${p}#member-workroom-activity` as Route;
  return (
    <section
      className={styles.directory}
      id="member-workroom-activity"
      aria-labelledby="workroom-activity-title"
    >
      <header className={styles.directoryHead}>
        <div>
          <p className="eyebrow">체험 포인트 전체 기록</p>
          <h2 id="workroom-activity-title">모의 참여·포인트 거래 내역</h2>
          <p>
            실제 원화 입출금과 분리된 기록입니다. 최근 내역부터 25건씩
            확인합니다.
          </p>
        </div>
      </header>
      <dl className={styles.registrationGrid}>
        <div>
          <dt>사용 가능 체험 포인트</dt>
          <dd>
            {data.account
              ? `${number(data.account.balance)} P`
              : "워크룸 미개설"}
          </dd>
        </div>
        <div>
          <dt>참여 중인 포인트</dt>
          <dd>
            {data.account ? `${number(data.account.held)} P` : "워크룸 미개설"}
          </dd>
        </div>
        <div>
          <dt>전체 기록</dt>
          <dd>
            참여 {number(data.roundCount)}건 · 거래 {number(data.ledgerCount)}건
          </dd>
        </div>
      </dl>
      <h3>모의 참여 내역</h3>
      {data.rounds.length ? (
        <div className={styles.directoryScroll}>
          <table className={styles.directoryTable}>
            <caption className="sr-only">회원의 전체 모의 참여 기록</caption>
            <thead>
              <tr>
                {[
                  "상품",
                  "상태",
                  "참여 포인트",
                  "설정 수익률",
                  "반환 포인트",
                  "확정 손익",
                  "시작 일시",
                  "종료 일시",
                  "회차 번호",
                ].map((label) => (
                  <th scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rounds.map((row) => (
                <tr key={row.id}>
                  <th scope="row" data-label="상품">
                    {names.get(row.instrument) ?? row.instrument}
                  </th>
                  <td data-label="상태">
                    {row.closedAt === null ? "진행 중 · 결과 미확정" : "종료"}
                  </td>
                  <td data-label="참여 포인트">{number(row.stake)} P</td>
                  <td data-label="설정 수익률">{signed(row.roi)}%</td>
                  <td data-label="반환 포인트">
                    {row.returned === null
                      ? "미확정"
                      : `${number(row.returned)} P`}
                  </td>
                  <td data-label="확정 손익">
                    {row.profit === null ? "미확정" : `${signed(row.profit)} P`}
                  </td>
                  <td data-label="시작 일시">{date(row.startedAt)}</td>
                  <td data-label="종료 일시">
                    {row.closedAt === null ? "진행 중" : date(row.closedAt)}
                  </td>
                  <td data-label="회차 번호">
                    <code>{row.id}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">
          {data.roundCount
            ? "이 페이지에 참여 내역이 없습니다."
            : "아직 모의 참여 내역이 없습니다."}
        </p>
      )}
      <nav className={styles.directoryHead} aria-label="모의 참여 내역 페이지">
        <span>
          {roundPage} / {Math.max(1, Math.ceil(data.roundCount / 25))} 페이지
        </span>
        <div className="link-row">
          {roundPage > 1 ? (
            <Link
              className="ghost-button"
              href={href(roundPage - 1, pointPage)}
            >
              이전 참여
            </Link>
          ) : null}
          {roundPage * 25 < data.roundCount ? (
            <Link
              className="ghost-button"
              href={href(roundPage + 1, pointPage)}
            >
              다음 참여
            </Link>
          ) : null}
        </div>
      </nav>
      <h3>체험 포인트 거래 내역</h3>
      <p className="panel-note">
        참여 시 차감과 종료 시 반환을 각각 표시합니다. 종료 반환에는 참여
        포인트와 확정된 모의 손익이 포함됩니다.
      </p>
      {data.ledger.length ? (
        <div className={styles.directoryScroll}>
          <table className={styles.directoryTable}>
            <caption className="sr-only">
              가입 지급, 참여 차감, 종료 반환과 운영자 지급·차감 전체 기록
            </caption>
            <thead>
              <tr>
                {[
                  "거래 구분",
                  "증감 포인트",
                  "거래 후 잔액",
                  "내용·사유",
                  "거래 일시",
                  "연결 회차",
                  "거래 번호",
                ].map((label) => (
                  <th scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.ledger.map((row) => (
                <tr key={row.id}>
                  <th scope="row" data-label="거래 구분">
                    {row.kind === "WELCOME"
                      ? "가입 포인트"
                      : row.kind === "STAKE"
                        ? "참여 차감"
                        : row.kind === "SETTLEMENT"
                          ? "종료 반환"
                          : row.amount > 0
                            ? "운영자 지급"
                            : "운영자 차감"}
                  </th>
                  <td data-label="증감 포인트">{signed(row.amount)} P</td>
                  <td data-label="거래 후 잔액">
                    {number(row.balanceAfter)} P
                  </td>
                  <td data-label="내용·사유">{row.note}</td>
                  <td data-label="거래 일시">{date(row.createdAt)}</td>
                  <td data-label="연결 회차">{row.roundId ?? "해당 없음"}</td>
                  <td data-label="거래 번호">
                    <code>{row.id}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">
          {data.ledgerCount
            ? "이 페이지에 거래 내역이 없습니다."
            : "아직 체험 포인트 거래 내역이 없습니다."}
        </p>
      )}
      <nav
        className={styles.directoryHead}
        aria-label="체험 포인트 거래 페이지"
      >
        <span>
          {pointPage} / {Math.max(1, Math.ceil(data.ledgerCount / 25))} 페이지
        </span>
        <div className="link-row">
          {pointPage > 1 ? (
            <Link
              className="ghost-button"
              href={href(roundPage, pointPage - 1)}
            >
              이전 거래
            </Link>
          ) : null}
          {pointPage * 25 < data.ledgerCount ? (
            <Link
              className="ghost-button"
              href={href(roundPage, pointPage + 1)}
            >
              다음 거래
            </Link>
          ) : null}
        </div>
      </nav>
    </section>
  );
}
