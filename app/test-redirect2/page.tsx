import { redirect } from "next/navigation";

export default function TestRedirectPage() {
  redirect("/login");
}
