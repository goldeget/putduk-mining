import type { ReactNode } from "react";

import { ProductShell } from "@/components/layout/product-shell";
import { requirePageUser } from "@/lib/auth/session";
import { MemberSessionRuntime } from "@/components/auth/member-session-runtime";
import { getSupabaseBrowserAuthConfig } from "@/lib/env/supabase-browser.server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProductLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const identity = await requirePageUser();
  const { data: profile } = await identity.supabase
    .from("user_profiles")
    .select("display_name")
    .eq("user_id", identity.userId)
    .maybeSingle();
  const { data: registration } = await identity.supabase
    .from("user_identity_profiles")
    .select("birth_sex_digit")
    .eq("user_id", identity.userId)
    .maybeSingle();

  return (
    <ProductShell displayName={profile?.display_name ?? "워크룸 회원"}>
      <MemberSessionRuntime config={getSupabaseBrowserAuthConfig()} />
      {registration?.birth_sex_digit === null ? (
        <p className="panel-note" role="status">
          가입 정보에 뒷자리 첫 숫자가 비어 있습니다.{" "}
          <Link href="/menu/account#birth-digit-completion">
            내 정보에서 한 자리 등록하기 →
          </Link>
        </p>
      ) : null}
      {children}
    </ProductShell>
  );
}
