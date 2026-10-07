import Link from "next/link";
import type { Route } from "next";
import { formatKst } from "@/app/(control)/_lib/format";
import styles from "../operations/operations.module.css";

export type DirectoryMember = {
  userId: string;
  name: string;
  joinedAt: string;
};
export function MemberDirectory({
  members,
  unavailable,
  query,
  invalidReference,
}: {
  members: DirectoryMember[];
  unavailable: boolean;
  query: string;
  invalidReference: boolean;
}) {
  return (
    <div
      className={styles.root}
      data-ui-ready="/members"
      data-ui-state={
        unavailable ? "partial" : members.length ? "loaded" : "empty"
      }
    >
      <section className={styles.hero}>
        <div>
          <p className="eyebrow">회원 한눈에</p>
          <h1>조회할 회원을 선택하세요.</h1>
          <p>이름과 가입 시각을 확인해 회원의 최근 기록을 열어요.</p>
        </div>
      </section>
      {invalidReference ? (
        <p className="form-error" role="alert">
          회원 참조가 올바르지 않아요. 아래 목록에서 다시 선택해 주세요.
        </p>
      ) : null}
      <section className={styles.panel}>
        <h2>회원 찾기</h2>
        <form className={styles.form} method="get" action="/members">
          <label>
            회원 이름
            <input
              name="q"
              defaultValue={query}
              maxLength={40}
              autoComplete="off"
              placeholder="등록된 이름 그대로 입력"
            />
          </label>
          <div className={styles.links}>
            <button className="gold-button" type="submit">
              회원 찾기
            </button>
            <Link className="text-link" href="/members">
              최근 가입 회원
            </Link>
          </div>
        </form>
        <p className={styles.note}>
          이름이 같은 회원은 가입 시각도 확인해 주세요. 이름이나 전화번호로
          신원을 단정하지 않아요.
        </p>
      </section>
      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <h2>{query ? "이름이 일치하는 회원" : "최근 가입 회원"}</h2>
          <span>최대 20명</span>
        </header>
        {unavailable ? (
          <div role="alert">
            <p>
              회원 목록을 확인하지 못했어요. 조회 실패를 회원 없음으로 표시하지
              않아요.
            </p>
            <Link className="text-link" href="/members">
              다시 불러오기
            </Link>
          </div>
        ) : members.length ? (
          <ul className={styles.records}>
            {members.map((member) => (
              <li key={member.userId}>
                <div className={styles.recordHead}>
                  <h3>{member.name}</h3>
                  <Link
                    className="gold-button"
                    href={`/members?id=${member.userId}` as Route}
                  >
                    회원 상세
                  </Link>
                </div>
                <p>가입 · {formatKst(member.joinedAt)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <strong>
              {query
                ? "이 이름으로 조회된 회원이 없어요"
                : "조회된 회원이 없어요"}
            </strong>
            <p>
              {query
                ? "등록된 이름과 띄어쓰기를 다시 확인해 주세요."
                : "최근 가입 기록이 생기면 여기에 표시돼요."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
