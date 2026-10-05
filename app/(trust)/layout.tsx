import type { ReactNode } from "react";

import { TrustShell } from "@/components/layout/trust-shell";

import styles from "./trust-shell.module.css";

export default function TrustLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.frame}>
      <TrustShell>{children}</TrustShell>
    </div>
  );
}
