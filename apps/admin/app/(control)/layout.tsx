import { AdminShell } from "@/components/admin-shell";
import { OperatorDraftProvider } from "@/components/assistant/operator-draft-provider";
import { getAdminIdentity, requireAdminPage } from "@/lib/auth/principal";
import { getAdminBrowserPublicConfig } from "@/lib/env";
import { AdminSessionRuntime } from "@/components/admin-session-runtime";
import { ClientRedirect } from "../../../../components/auth/client-redirect";

export const dynamic = "force-dynamic";

export default async function ControlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getAdminIdentity();
  if (!identity) {
    return <ClientRedirect to="/login?returnTo=%2F" />;
  }
  if (!identity.role) {
    return <ClientRedirect to="/login?denied=1" />;
  }

  const principal = await requireAdminPage();
  const publicConfig = getAdminBrowserPublicConfig();
  return (
    <AdminShell principal={principal}>
      <OperatorDraftProvider
        key={`${principal.userId}:${principal.adminSessionId}`}
        userId={principal.userId}
        publicConfig={publicConfig}
      >
        <AdminSessionRuntime />
        {children}
      </OperatorDraftProvider>
    </AdminShell>
  );
}
