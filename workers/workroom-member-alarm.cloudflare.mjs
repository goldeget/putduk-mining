import { DurableObject } from "cloudflare:workers";
import { MemberAlarmCoordinator } from "./workroom-member-alarm";
import { productionRuntimeClient } from "./workroom-production-config";

/** Runtime adapter; persistence/ordering lives in the separately tested core. */
export class WorkroomMemberAlarm extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.coordinator = new MemberAlarmCoordinator(
      ctx.storage,
      productionRuntimeClient(env),
    );
  }
  async arm(memberId) {
    return this.coordinator.arm(memberId);
  }
  async alarm() {
    await this.coordinator.alarm();
  }
}
