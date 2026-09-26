import type { ReactNode } from "react";

import { TrustShell } from "@/components/layout/trust-shell";

export default function TrustLayout({ children }: { children: ReactNode }) {
  return <TrustShell>{children}</TrustShell>;
}
