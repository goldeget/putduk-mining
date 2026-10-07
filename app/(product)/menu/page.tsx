import { MemberMenuView } from "@/components/product/member-menu-view";
import { requirePageUser } from "@/lib/auth/session";
import { readMemberScreenFacts } from "@/lib/product/member-screen-facts";

export default async function MenuPage() {
  const identity = await requirePageUser("/menu");
  const facts = await readMemberScreenFacts(identity);
  return <MemberMenuView facts={facts} />;
}
