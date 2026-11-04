export type WorkroomAdminConfig = {
  instrument: string;
  pattern: "wave" | "slow" | "balanced";
  roi: number;
  duration: number;
  amplitude: number;
  version: number;
};
export type WorkroomAdminState = {
  configs: WorkroomAdminConfig[];
  users: {
    id: string;
    name: string;
    email: string;
    balance: number;
    room: string;
    referral: string | null;
    createdAt: number;
  }[];
  invites: {
    id: string;
    code: string;
    label: string;
    maxUses: number;
    used: number;
    enabled: boolean;
    expiresAt: number;
    createdAt: number;
  }[];
  audit: {
    id: string;
    actor: string;
    operation: string;
    target: string;
    input: Record<string, unknown>;
    createdAt: number;
  }[];
  pagination: Record<
    "users" | "invites" | "audit",
    { page: number; total: number }
  >;
};
