import Link from "next/link";
import { WorkroomAuth } from "@/components/workroom/identity";
import styles from "@/components/workroom/workroom.module.css";
export default function HomePage() {
  return (
    <WorkroomAuth>
      <div className={styles.welcomePoints}>
        <span>WORKROOM 모니터링 플랫폼</span>
        <strong>시장 흐름 기록</strong>
        <span>참여 기록과 실제 잔액을 확인</span>
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
        담당자에게 받은 추천인 코드로 새로 가입해 주세요.
      </p>
    </WorkroomAuth>
  );
}
