import {
  readWorkroomDueJobs,
  recoverWorkroomJobs,
  type RuntimeClient,
} from "./workroom-app-runtime";

export interface AlarmStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
/** Per-member coordination. Every arm/recovery re-reads the source DB; no
 * caller-provided deadline/generation can overwrite a newer committed round.
 */
export class MemberAlarmCoordinator {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly storage: AlarmStorage,
    private readonly client: RuntimeClient,
  ) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.pending.catch(() => undefined).then(work);
    this.pending = operation;
    return operation;
  }
  arm(memberId: string) {
    return this.serial(() => this.reconcile(memberId));
  }
  private async reconcile(memberId: string) {
    const existingMember = await this.storage.get<string>("memberId");
    if (existingMember && existingMember !== memberId)
      throw new Error("WORKROOM_ALARM_OWNER_INVALID");
    const jobs = await readWorkroomDueJobs(this.client, memberId);
    const job = jobs[0];
    if (!job) {
      await this.storage.deleteAlarm();
      return { armed: false };
    }
    await this.storage.put("memberId", memberId);
    const at = Math.max(Date.now() + 100, Date.parse(job.dueAt));
    const current = await this.storage.getAlarm();
    if (current === null || at < current) await this.storage.setAlarm(at);
    return { armed: true };
  }
  alarm() {
    return this.serial(async () => {
      const memberId = await this.storage.get<string>("memberId");
      if (!memberId) return;
      const jobs = await readWorkroomDueJobs(this.client, memberId);
      const current = jobs[0];
      if (current && Date.parse(current.dueAt) <= Date.now())
        await recoverWorkroomJobs(this.client, {
          memberId,
          roundId: current.roundId,
        });
      // A running alarm is consumed. Explicitly reset before reconciling the
      // authoritative next job, including when an early/duplicate alarm arrives.
      await this.storage.deleteAlarm();
      await this.reconcile(memberId);
    });
  }
}
