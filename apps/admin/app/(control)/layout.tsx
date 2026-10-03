import { AdminShell } from "@/components/admin-shell";
import { OperatorDraftProvider } from "@/components/assistant/operator-draft-provider";
import { requireAdminPage } from "@/lib/auth/principal";

export const dynamic = "force-dynamic";

export default async function ControlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const principal = await requireAdminPage();
  return (
    <AdminShell principal={principal}>
      <OperatorDraftProvider
        key={`${principal.userId}:${principal.adminSessionId}`}
        userId={principal.userId}
      >
        {children}
      </OperatorDraftProvider>
    </AdminShell>
  );
}
