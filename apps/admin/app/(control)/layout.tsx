import { AdminShell } from "@/components/admin-shell";
import { requireAdminPage } from "@/lib/auth/principal";

export const dynamic = "force-dynamic";

export default async function ControlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const principal = await requireAdminPage();
  return <AdminShell principal={principal}>{children}</AdminShell>;
}
