export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};
export type WebPushInput = {
  endpoint: string;
  p256dh: string;
  authSecret: string;
  notificationId: string;
  deepLink: string;
};
export function encryptWebPush(
  subscription: { p256dh: string; authSecret: string },
  payload: Buffer,
): Buffer;
export function webPushAuthorization(
  endpoint: string,
  config: VapidConfig,
  now?: number,
): string;
export function createWebPushEnvelope(
  input: WebPushInput,
  config: VapidConfig,
): {
  body: Buffer;
  headers: {
    Authorization: string;
    "Content-Encoding": string;
    "Content-Type": string;
    TTL: string;
    Urgency: string;
  };
};
