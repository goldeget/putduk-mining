import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/principal";
export default async function AdminHomePage() {
  await requireAdminPage("/");
  redirect("/workroom");
}
