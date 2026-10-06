import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { HIGH_IMPACT_ROLES } from "../../../lib/auth/policy";
import { requireAdminPage } from "../../../lib/auth/principal";
import { policyVersionSchema } from "../../../lib/economy/input";
import { loadEconomyConsole } from "../../../lib/economy/server";
import { getAdminBrowserPublicConfig } from "../../../lib/env";
import { EconomyConsole } from "./economy-console";
import styles from "./economy.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "채굴 정책 | 퍼뜩 운영",
  robots: { index: false, follow: false },
};

export default async function EconomyPage({
  searchParams,
}: {
  searchParams: Promise<{ version?: string }>;
}) {
  const principal = await requireAdminPage("/economy");
  if (!HIGH_IMPACT_ROLES.includes(principal.role))
    redirect("/unauthorized?code=ROLE_FORBIDDEN" as Route);
  const publicConfig = getAdminBrowserPublicConfig();
  const query = await searchParams;
  const version =
    query.version === undefined
      ? null
      : policyVersionSchema.safeParse(query.version);
  const loaded =
    version !== null && !version.success
      ? { ok: false as const }
      : await loadEconomyConsole(principal, version?.data ?? null);
  return (
    <div
      className={styles.root}
      data-ui-ready="/economy"
      data-ui-state={loaded.ok ? "loaded" : "error"}
    >
      <header className={styles.heading}>
        <p className="eyebrow">퍼뜩 운영</p>
        <h1>채굴 정책</h1>
        <p>정책을 새 버전으로 작성하고, 검토·승인 후 적용 시간을 예약합니다.</p>
      </header>
      {loaded.ok ? (
        <EconomyConsole
          key={`${loaded.view.selectedVersion.policyVersion}:${loaded.view.selectedVersion.latestRevision.revisionId}`}
          initial={loaded.view}
          publicConfig={publicConfig}
        />
      ) : (
        <section className={styles.notice} role="alert">
          <h2>정책을 불러오지 못했습니다</h2>
          <p>현재 값을 확인할 수 없어 변경 작업을 멈췄습니다.</p>
          <Link className="ghost-button" href={"/economy" as Route}>
            다시 열기
          </Link>
        </section>
      )}
    </div>
  );
}
