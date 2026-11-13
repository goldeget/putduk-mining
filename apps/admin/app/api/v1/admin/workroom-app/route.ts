import {
  handleAppRead,
  handleAppWrite,
} from "../../../../../../../lib/workroom-app/handler";
import { adminAppDependencies } from "@/lib/workroom-app/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleAppRead(request, adminAppDependencies(), "admin");
}
export async function POST(request: Request) {
  return handleAppWrite(request, adminAppDependencies(), "admin");
}
