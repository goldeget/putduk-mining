import { TodayView } from "@/components/today/today-view";
import { requireAdminPage } from "@/lib/auth/principal";

import { loadTodaySnapshot } from "./_lib/load-today-snapshot";

export default async function TodayPage() {
  await requireAdminPage("/");
  const snapshot = await loadTodaySnapshot();
  return <TodayView snapshot={snapshot} />;
}
