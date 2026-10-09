import Link from "next/link";
import type { Route } from "next";
import { AllocationConsole } from "@/components/product/allocation-console";
import { requirePageUser } from "@/lib/auth/session";
import { readAllocation } from "@/lib/product/allocation-handler";
export const dynamic = "force-dynamic";
export const metadata = { title: "원금 배분 | 퍼뜩" };
export default async function AllocationPage() {
  const identity = await requirePageUser("/products/allocation");
  let state;
  try {
    state = await readAllocation(identity.supabase);
  } catch {
    state = null;
  }
  if (!state) {
    return (
      <section role="alert" className="surface-panel">
        <h1>선택 내용을 불러오지 못했어요</h1>
        <p>연결을 확인한 뒤 다시 열어 주세요.</p>
        <Link href={"/products/allocation" as Route} className="ghost-button">
          다시 열기
        </Link>
      </section>
    );
  }
  return <AllocationConsole initial={state} />;
}
