import Link from "next/link";
import type { Route } from "next";
import type { CashRequestMembers } from "@/lib/members/cash-request-members";
import styles from "./cash-request-member.module.css";
export function CashRequestMember({
  userId,
  directory,
}: {
  userId: string;
  directory: CashRequestMembers;
}) {
  const member = directory.members.get(userId);
  return (
    <div className={styles.member} data-request-member-id={userId}>
      <Link className="text-link" href={`/members?id=${userId}` as Route}>
        <strong>
          {member
            ? member.name
            : directory.failed
              ? "신청자 정보 조회 실패"
              : directory.allowed
                ? "가입 정보 기록 없음"
                : "회원 상세 보기"}
        </strong>
        {member ? (
          <span>아이디 · {member.loginId}</span>
        ) : (
          <code>{userId}</code>
        )}
      </Link>
      {directory.failed ? (
        <span className={styles.unavailable} role="status">
          이름과 아이디를 확인하지 못했습니다. 새로고침해 주세요.
        </span>
      ) : null}
    </div>
  );
}
