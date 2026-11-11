import Link from "next/link";
import { WorkroomAuth } from "@/components/workroom/identity";
import styles from "@/components/workroom/workroom.module.css";
export default function HomePage() {
  return (
    <WorkroomAuth>
      <div className={styles.welcomePoints}>
        <span>가입 체험 포인트 · 계정당 한 번</span>
        <strong>100,000 P</strong>
        <span>현금 전환·출금 불가</span>
      </div>
      <div className={styles.landingActions}>
        <Link className={styles.primary} href="/signup">
          추천인 코드로 회원가입 →
        </Link>
        <Link className={styles.secondary} href="/login?next=%2Fworkroom">
          회원 로그인
        </Link>
        <Link className={styles.secondary} href="/workroom">
          내 워크룸으로 이동
        </Link>
      </div>
      <p className={styles.muted}>
        담당자에게 받은 추천인 코드로 새로 가입해 주세요. 체험 포인트는 가입할
        때 한 번 지급됩니다.
      </p>
    </WorkroomAuth>
  );
}
