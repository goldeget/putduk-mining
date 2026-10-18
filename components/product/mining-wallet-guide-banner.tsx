import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";

import styles from "./mining-wallet-guide-banner.module.css";

export type MiningWalletGuideBannerProps = {
  /** Member route placement for future layout tuning. */
  placement?: "home" | "mining";
};

export function MiningWalletGuideBanner({
  placement = "mining",
}: MiningWalletGuideBannerProps) {
  return (
    <Link
      className={styles.banner}
      href="/how-it-works"
      data-guide-placement={placement}
    >
      <span className={styles.heading}>
        <PutdukIcon
          className={styles.leadIcon}
          name="shield"
          size={25}
          aria-hidden="true"
        />
        <strong className={styles.title}>
          <span className={styles.titleLine}>채굴과 지갑</span>
          <span className={styles.titleLine}>안내</span>
        </strong>
        <PutdukIcon
          className={styles.trailIcon}
          name="arrow-right"
          size={20}
          aria-hidden="true"
        />
      </span>
      <small className={styles.detail}>
        확정 금액과 확인 전 금액의 차이를 알아보세요.
      </small>
    </Link>
  );
}
