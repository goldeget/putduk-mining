import type { WorkroomRuntimeEnv } from "./workroom-production-config";
/** Public RPC surface, independent of generated CF platform ambient globals. */
export class WorkroomMemberAlarm {
  constructor(ctx: unknown, env: WorkroomRuntimeEnv);
  arm(memberId: string): Promise<{ armed: boolean }>;
  alarm(): Promise<void>;
}
