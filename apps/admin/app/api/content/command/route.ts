import { createContentCommandHandler } from "@/lib/content/handler";
import { contentDependencies } from "@/lib/content/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createContentCommandHandler(contentDependencies);
