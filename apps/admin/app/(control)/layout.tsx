import { AdminShell } from "@/components/admin-shell";
import { OperatorDraftProvider } from "@/components/assistant/operator-draft-provider";
import { requireAdminPage } from "@/lib/auth/principal";
import { getAdminEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function ControlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const principal = await requireAdminPage();
  const env = getAdminEnv();
  return (
    <AdminShell principal={principal}>
      <OperatorDraftProvider
        key={`${principal.userId}:${principal.adminSessionId}:${principal.role}`}
        userId={principal.userId}
        publicConfig={{
          url: env.NEXT_PUBLIC_SUPABASE_URL,
          publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        }}
      >
        {children}
      </OperatorDraftProvider>
    </AdminShell>
  );
}
