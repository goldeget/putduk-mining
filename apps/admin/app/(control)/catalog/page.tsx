import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { HIGH_IMPACT_ROLES } from "../../../lib/auth/policy";
import { requireAdminPage } from "../../../lib/auth/principal";
import { loadCatalogReview } from "../../../lib/catalog/server";
import { CatalogConsole } from "./catalog-console";
import styles from "./catalog.module.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "상품 검토 | 퍼뜩 운영",
  robots: { index: false, follow: false },
};
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ catalog?: string }>;
}) {
  const principal = await requireAdminPage("/catalog");
  if (!HIGH_IMPACT_ROLES.includes(principal.role))
    redirect("/unauthorized?code=ROLE_FORBIDDEN" as Route);
  const query = await searchParams;
  const id =
    query.catalog === undefined ? null : z.uuid().safeParse(query.catalog);
  const loaded =
    id && !id.success
      ? { ok: false as const }
      : await loadCatalogReview(principal, id?.data ?? null);
  return (
    <div
      className={styles.root}
      data-ui-ready="/catalog"
      data-ui-state={loaded.ok ? "loaded" : "error"}
    >
      <header className={styles.heading}>
        <p className="eyebrow">퍼뜩 운영</p>
        <h1>상품 검토</h1>
        <p>출처와 상품을 확인한 뒤 승인하고, 공개 시간을 정합니다.</p>
      </header>
      {loaded.ok ? (
        <CatalogConsole initial={loaded.state} />
      ) : (
        <section className={styles.panel} role="alert">
          <h2>상품 내용을 불러오지 못했습니다</h2>
          <p>최신 내용을 확인한 뒤 다시 검토해 주세요.</p>
          <Link className="ghost-button" href={"/catalog" as Route}>
            다시 열기
          </Link>
        </section>
      )}
    </div>
  );
}
