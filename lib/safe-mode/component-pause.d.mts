export type AppGuardedSafeModeComponent = "SIGNUP" | "AI" | "NOTIFICATION";
export type SafeModeDecision = "ACTIVE" | "PAUSED" | "UNKNOWN";
export type SafeModeControlRow = {
  component: unknown;
  is_paused: unknown;
  starts_at: unknown;
};
export type SafeModeReadClient = {
  from(table: string): {
    select(columns: string): {
      in(
        column: string,
        values: readonly string[],
      ): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
};

export const APP_GUARDED_SAFE_MODE_COMPONENTS: readonly AppGuardedSafeModeComponent[];
export function safeModeComponentsFor(
  component: AppGuardedSafeModeComponent,
): readonly string[];
export function decideSafeMode(
  rows: unknown,
  component: AppGuardedSafeModeComponent,
  now: Date,
): SafeModeDecision;
export function readSafeModeDecision(
  client: unknown,
  component: AppGuardedSafeModeComponent,
  now?: Date,
): Promise<SafeModeDecision>;
export const SAFE_MODE_MEMBER_COPY: Readonly<
  Record<
    AppGuardedSafeModeComponent,
    Readonly<{ paused: string; unavailable: string }>
  >
>;
