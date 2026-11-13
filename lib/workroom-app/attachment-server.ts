import "server-only";
import { createSupabaseAdminClient } from "../supabase/admin";
import { memberAppDependencies } from "./server";
import type { AttachmentDependencies } from "./attachments";
const bucket = "workroom-support-attachments";
export function memberAttachmentDependencies(): AttachmentDependencies {
  return {
    ...memberAppDependencies(),
    storage: {
      async upload(path, bytes, mediaType) {
        const result = await createSupabaseAdminClient()
          .storage.from(bucket)
          .upload(path, bytes, { contentType: mediaType, upsert: false });
        return !result.error;
      },
      async download(path) {
        const result = await createSupabaseAdminClient()
          .storage.from(bucket)
          .download(path);
        return result.data
          ? new Uint8Array(await result.data.arrayBuffer())
          : null;
      },
      async sign(path) {
        const result = await createSupabaseAdminClient()
          .storage.from(bucket)
          .createSignedUrl(path, 120);
        return result.data?.signedUrl ?? null;
      },
    },
  };
}
