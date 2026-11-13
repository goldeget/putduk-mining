import type { InboxPage, SupportPage } from "../../lib/workroom-app/contract";

function latestById<T extends { id: string }>(previous: T[], next: T[]) {
  const rows = new Map(previous.map((row) => [row.id, row]));
  for (const row of next) rows.set(row.id, row);
  return [...rows.values()];
}

// Polling must retain rows displaced beyond the live first-page boundary.
export function mergeInboxPage(
  previous: InboxPage,
  next: InboxPage,
): InboxPage {
  return {
    ...next,
    items: latestById(previous.items, next.items).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  };
}

export function mergeSupportPage(
  previous: SupportPage,
  next: SupportPage,
): SupportPage {
  const boundary = next.items.at(-1)?.updatedAt;
  // The refreshed window is authoritative, including rows leaving an admin filter.
  const displaced = boundary
    ? previous.items.filter((row) => row.updatedAt < boundary)
    : [];
  return {
    ...next,
    items: latestById(displaced, next.items).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
  };
}

export function mergeSupportDetail(
  previous: SupportPage,
  next: SupportPage,
): SupportPage {
  return {
    ...next,
    items: next.items.map((thread) => {
      const old = previous.items.find((row) => row.id === thread.id);
      return {
        ...thread,
        messages: latestById(old?.messages ?? [], thread.messages).sort(
          (a, b) => a.createdAt.localeCompare(b.createdAt),
        ),
      };
    }),
  };
}
