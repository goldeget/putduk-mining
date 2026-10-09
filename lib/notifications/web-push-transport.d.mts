import type { VapidConfig, WebPushInput } from "./web-push-crypto.mjs";
export type PushTransportResult = {
  status: "ACCEPTED" | "EXPIRED" | "RETRY" | "REJECTED" | "ABORTED" | "UNKNOWN";
  httpStatus: number | null;
  errorCode: string | null;
};
export function isPublicPushAddress(value: string): boolean;
export function classifyPushResponse(status: number): PushTransportResult;
export function sendWebPush(
  input: WebPushInput,
  config: VapidConfig,
  signal?: AbortSignal,
): Promise<PushTransportResult>;
