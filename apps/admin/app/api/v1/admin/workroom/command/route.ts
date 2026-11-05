import { createWorkroomCommandHandler } from "@/lib/workroom/handler";
import { workroomDependencies } from "@/lib/workroom/server";
export const dynamic = "force-dynamic";
export const POST = createWorkroomCommandHandler(workroomDependencies);
