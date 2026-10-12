import { requireAdminCommand } from "@/lib/auth/principal";
import { createContentSourcePreviewHandler } from "@/lib/content/source-preview-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createContentSourcePreviewHandler({
  authorize: requireAdminCommand,
});
