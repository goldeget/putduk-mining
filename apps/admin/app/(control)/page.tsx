import { TodayView } from "@/components/today/today-view";
import { requireAdminPage } from "@/lib/auth/principal";

import { loadTodaySnapshot } from "./_lib/load-today-snapshot";

export default async function TodayPage() {
  await requireAdminPage("/");
  const snapshot = await loadTodaySnapshot();
  return (
    <div
      data-ui-ready="/"
      data-ui-state={
        snapshot.hasUnavailable
          ? "partial"
          : snapshot.allQueuesEmpty
            ? "empty"
            : "loaded"
      }
    >
      <TodayView snapshot={snapshot} />
    </div>
  );
}
