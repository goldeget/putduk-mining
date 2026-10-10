import "server-only";

import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  ADMIN_APP_URL: z.url(),
});

export type AdminEnv = z.infer<typeof schema>;

export function getAdminEnv(): AdminEnv {
  // Read public values at server runtime when a build is promoted across targets.
  // 키 역할 거절은 브라우저 클라이언트 경계에서만 한다. 프록시가 이 값을
  // 읽을 때 타이포그래피용 가짜 공개 키까지 막으면 서버가 뜨지 않는다.
  const runtimeEnv = process.env;
  return schema.parse({
    APP_ENV: process.env.APP_ENV,
    NEXT_PUBLIC_SUPABASE_URL: runtimeEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      runtimeEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    ADMIN_APP_URL: process.env.ADMIN_APP_URL,
  });
}
