import Link from "next/link";
import type { Route } from "next";

import { formatKst } from "@/app/(control)/_lib/format";
import {
  operationSections,
  type OperationsSnapshot,
} from "@/lib/operations/registry";
import { DraftComposer } from "./draft-composer";
import styles from "./operations.module.css";

export function OperationsView({ snapshot }: { snapshot: OperationsSnapshot }) {
  const section = operationSections[snapshot.section];
  const failed = snapshot.panels.some((panel) => panel.state === "unavailable");
  return (
    <div
      className={styles.root}
      data-ui-ready={`/operations/${snapshot.section}`}
      data-ui-state={
        failed || snapshot.section === "support"
          ? "partial"
          : snapshot.panels.every((panel) => panel.count === 0)
            ? "empty"
            : "loaded"
      }
    >
      <section className={styles.hero}>
        <div>
          <p className="eyebrow">퍼뜩 운영</p>
          <h1>{section.title}</h1>
          <p>{section.lead}</p>
          <small>조회 시각 · {formatKst(snapshot.observedAt)}</small>
        </div>
        <Link className="ghost-button" href="/assistant">
          운영 도우미 열기
        </Link>
      </section>
      <aside className={styles.boundary}>
        <strong>먼저 확인해 주세요</strong>
        <p>{section.boundary}</p>
      </aside>
      {failed ? (
        <section className={styles.warning} role="alert">
          <h2>일부 기록을 확인하지 못했어요</h2>
          <p>
            비어 있는 상태와 조회 실패를 구분해요. 확인 전에는 처리하지 마세요.
          </p>
          <Link
            className="text-link"
            href={`/operations/${snapshot.section}` as Route}
          >
            기록 다시 불러오기
          </Link>
        </section>
      ) : null}
      {snapshot.section === "support" ? (
        <section className={styles.panel}>
          <h2>답변 전에 회원 기록부터</h2>
          <ol className={styles.steps}>
            <li>회원 상세에서 문의 내용과 최근 기록을 확인해요.</li>
            <li>입출금 문의는 해당 처리 화면에서 실제 결과를 확인해요.</li>
            <li>확인한 사실만 답변에 넣고, 처리 약속은 다시 검토해요.</li>
          </ol>
          <div className={styles.links}>
            <Link className="gold-button" href="/members">
              회원 선택
            </Link>
            <Link className="text-link" href="/deposits/krw">
              입금 확인
            </Link>
            <Link className="text-link" href="/withdrawals/krw-bank">
              출금 확인
            </Link>
          </div>
          <p className={styles.note}>
            문의 접수함은 연결되어 있지 않아요. 접수·발송 완료로 표시하지
            않아요.
          </p>
        </section>
      ) : null}
      <div className={styles.panels}>
        {snapshot.panels.map((panel) => (
          <section
            className={styles.panel}
            key={panel.key}
            data-testid={`operations-${panel.key}`}
          >
            <header className={styles.panelHead}>
              <h2>{panel.title}</h2>
              <span>
                {panel.state === "unavailable"
                  ? "조회 확인 필요"
                  : `${panel.count?.toLocaleString("ko-KR")}건`}
              </span>
            </header>
            {panel.state === "unavailable" ? (
              <p className={styles.note}>
                권한 또는 연결 상태를 확인한 뒤 다시 불러와 주세요. 조회되지
                않은 값을 채우지 않았어요.
              </p>
            ) : panel.rows.length === 0 ? (
              <div className={styles.empty}>
                <strong>조회된 기록이 없어요</strong>
                <p>새 기록이 생기면 여기에 표시돼요.</p>
              </div>
            ) : (
              <>
                <p className={styles.note}>
                  {snapshot.section === "analytics"
                    ? "최근 24시간 기록 중 최신 20건까지 표시해요. 이용자 수나 전환율을 뜻하지 않아요."
                    : "최신 20건까지 표시해요. 전체 운영 기록을 대체하지 않아요."}
                </p>
                <ol className={styles.records}>
                  {panel.rows.map((row) => (
                    <li key={row.id}>
                      <div className={styles.recordHead}>
                        <h3>{row.title}</h3>
                        <span className={styles.status}>{row.status}</span>
                      </div>
                      {row.detail ? <p>{row.detail}</p> : null}
                      <footer>
                        <time dateTime={row.at ?? undefined}>
                          {row.at ? formatKst(row.at) : "시각 확인 필요"}
                        </time>
                        {row.memberId ? (
                          <Link
                            className="text-link"
                            href={`/members?id=${row.memberId}` as Route}
                          >
                            회원 기록 열기
                          </Link>
                        ) : null}
                      </footer>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        ))}
      </div>
      {section.draft ? <DraftComposer kind={section.draft} /> : null}
      {snapshot.section === "system" ? (
        <section className={styles.panel}>
          <h2>문제가 생겼을 때</h2>
          <ol className={styles.steps}>
            <li>실패·격리 기록과 최근 시각을 확인해요.</li>
            <li>
              거래에 영향을 줄 수 있으면 안전 모드와 예외 기록을 확인해요.
            </li>
            <li>원인과 담당자를 확인한 뒤 승인된 절차로 복구해요.</li>
          </ol>
          <div className={styles.links}>
            <Link className="text-link" href="/exceptions">
              실패·예외 확인
            </Link>
            <Link className="text-link" href="/restrictions">
              안전 모드 확인
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
