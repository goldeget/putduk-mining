import { PushControl } from "../product/push-control";
import { AppInstallControl } from "../system/app-experience-runtime";
import { PutdukIcon } from "../icons/putduk-icon";
import styles from "./device-settings.module.css";
import Image from "next/image";

/** Shared presentation around the existing, independently fenced controls. */
export function DeviceSettings({ admin = false }: { admin?: boolean }) {
  return (
    <section
      className={styles.settings}
      aria-label={admin ? "운영 기기 알림과 앱 설치" : "기기 알림과 앱 설치"}
    >
      <header className={styles.heading}>
        <span className={styles.headingIcon} aria-hidden="true">
          <PutdukIcon name="bell" size={22} />
        </span>
        <div>
          <span className={styles.eyebrow}>내 기기 설정</span>
          <h2>
            {admin ? "이 기기로 운영 알림 받기" : "필요한 소식을 기기로 받기"}
          </h2>
          <p>
            {admin
              ? "기기 알림과 앱 설치는 선택 사항입니다. 알림 내용은 보안 로그인 후 확인할 수 있습니다."
              : "기기 알림과 앱 설치는 선택 사항이에요. 알림함은 언제든 사용할 수 있어요."}
          </p>
        </div>
        <span className={styles.optional}>선택 설정</span>
      </header>
      <div className={styles.grid}>
        <div className={`${styles.card} ${styles.control}`}>
          <span className={styles.cardIcon} aria-hidden="true">
            <PutdukIcon name="bell" size={21} />
          </span>
          <PushControl admin={admin} />
        </div>
        <div className={`${styles.card} ${styles.control}`}>
          <span className={styles.cardIcon} aria-hidden="true">
            <Image
              src="/workroom-icon.svg"
              width={24}
              height={24}
              alt=""
              unoptimized
            />
          </span>
          <AppInstallControl />
        </div>
      </div>
    </section>
  );
}
