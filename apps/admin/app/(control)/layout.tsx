import { AdminShell } from "@/components/admin-shell";
import { OperatorDraftProvider } from "@/components/assistant/operator-draft-provider";
import { requireAdminPage } from "@/lib/auth/principal";
import { getAdminBrowserPublicConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function ControlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const principal = await requireAdminPage();
  const publicConfig = getAdminBrowserPublicConfig();
  return (
    <AdminShell principal={principal}>
      <OperatorDraftProvider
        key={`${principal.userId}:${principal.adminSessionId}`}
        userId={principal.userId}
        publicConfig={publicConfig}
      >
        {children}
      </OperatorDraftProvider>
    </AdminShell>
  );
}
