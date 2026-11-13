import { SupportInbox } from "@/components/workroom-app/support-inbox";
import { requirePageUser } from "@/lib/auth/session";
import { z } from "zod";
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const params = await searchParams;
  const thread = z.uuid().safeParse(params.thread);
  const identity = await requirePageUser(
    thread.success
      ? `/workroom/support?thread=${thread.data}`
      : "/workroom/support",
  );
  return (
    <SupportInbox
      key={identity.userId}
      actorId={identity.userId}
      initialThread={thread.success ? thread.data : null}
    />
  );
}
