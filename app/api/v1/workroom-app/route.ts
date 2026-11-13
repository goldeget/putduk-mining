import { handleAppRead, handleAppWrite } from "@/lib/workroom-app/handler";
import { memberAppDependencies } from "@/lib/workroom-app/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleAppRead(request, memberAppDependencies(), "member");
}
export async function POST(request: Request) {
  return handleAppWrite(request, memberAppDependencies(), "member");
}
