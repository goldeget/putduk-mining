import {
  handleAttachmentRead,
  handleAttachmentUpload,
} from "../../../../../../../../lib/workroom-app/attachments";
import { adminAttachmentDependencies } from "@/lib/workroom-app/attachment-server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleAttachmentUpload(request, adminAttachmentDependencies());
}
export async function GET(request: Request) {
  return handleAttachmentRead(request, adminAttachmentDependencies());
}
