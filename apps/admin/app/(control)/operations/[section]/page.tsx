import Link from "next/link";
import { notFound } from "next/navigation";

import { OperationsView } from "@/components/operations/operations-view";
import { requireAdminPage } from "@/lib/auth/principal";
import {
  canReadOperation,
  isOperationSection,
} from "@/lib/operations/registry";
import { readOperationsSnapshot } from "@/lib/operations/read";
import { createAdminServiceClient } from "@/lib/supabase/service";

export default async function OperationsPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isOperationSection(section)) notFound();
  const principal = await requireAdminPage(`/operations/${section}`);
  if (!canReadOperation(section, principal.role)) {
    return (
      <section className="page-intro">
        <h1>이 화면의 조회 권한이 필요해요</h1>
        <p>담당 운영자에게 확인해 주세요.</p>
        <Link className="text-link" href="/">
          오늘 확인할 일로 돌아가기
        </Link>
      </section>
    );
  }
  const snapshot = await readOperationsSnapshot(
    createAdminServiceClient(),
    section,
  );
  return <OperationsView snapshot={snapshot} />;
}
