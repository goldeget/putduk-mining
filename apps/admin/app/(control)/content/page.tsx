import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/principal";
import { ContentConsole } from "./content-console";
export default async function ContentPage() {
  const principal = await requireAdminPage("/content");
  if (principal.role !== "SUPER_ADMIN" && principal.role !== "ADMIN")
    redirect("/unauthorized");
  return <ContentConsole />;
}
