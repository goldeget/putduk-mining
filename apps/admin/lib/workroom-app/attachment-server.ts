import "server-only";
import { createAdminServiceClient } from "../supabase/service";
import { adminAppDependencies } from "./server";
import type { AttachmentDependencies } from "../../../../lib/workroom-app/attachments";
const bucket = "workroom-support-attachments";
export function adminAttachmentDependencies(): AttachmentDependencies {
  return {
    ...adminAppDependencies(),
    storage: {
      async upload(path, bytes, mediaType) {
        const result = await createAdminServiceClient()
          .storage.from(bucket)
          .upload(path, bytes, { contentType: mediaType, upsert: false });
        return !result.error;
      },
      async download(path) {
        const result = await createAdminServiceClient()
          .storage.from(bucket)
          .download(path);
        return result.data
          ? new Uint8Array(await result.data.arrayBuffer())
          : null;
      },
      async sign(path) {
        const result = await createAdminServiceClient()
          .storage.from(bucket)
          .createSignedUrl(path, 120);
        return result.data?.signedUrl ?? null;
      },
    },
  };
}
