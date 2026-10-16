import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/principal";
import { ContentConsole } from "./content-console";

export const metadata = {
  title: "이벤트와 공지 | 퍼뜩 운영",
  robots: { index: false, follow: false },
};

export default async function ContentPage() {
  const principal = await requireAdminPage("/content");
  if (principal.role !== "SUPER_ADMIN" && principal.role !== "ADMIN")
    redirect("/unauthorized");
  return <ContentConsole />;
}
