import { Fragment } from "react";

import { formatAtomicAmount } from "@/domain/wallet/format-amount";
import styles from "./principal-recovery.module.css";

/** Keep exact integer text; line breaks may occur only between digit groups. */
export function PrincipalMoney({ atomic }: { atomic: string }) {
  const formatted = formatAtomicAmount(atomic, "KRW");
  const groups = formatted.slice(0, -4).split(",");
  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={index}>
          <span className={styles.moneyGroup} data-principal-money-group>
            {`${group}${index < groups.length - 1 ? "," : ""}`}
          </span>
          {index < groups.length - 1 ? <wbr /> : null}
        </Fragment>
      ))}{" "}
      <span className={styles.moneyGroup} data-principal-money-group>
        KRW
      </span>
    </>
  );
}
