import { z } from "zod";
import { parsePushProviderEndpoint } from "./push-provider-endpoint";

const key = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((value) => {
      const decoded = Buffer.from(value, "base64url");
      return (
        decoded.length === bytes &&
        decoded.toString("base64url") === value &&
        (bytes !== 65 || decoded[0] === 4)
      );
    });
export const pushSubscriptionSchema = z.strictObject({
  endpoint: z
    .string()
    .max(2048)
    .refine((value) => Boolean(parsePushProviderEndpoint(value))),
  expirationTime: z
    .number()
    .int()
    .positive()
    .max(8_640_000_000_000_000)
    .nullable(),
  keys: z.strictObject({ auth: key(16), p256dh: key(65) }),
});
/** Cookie-authorized mutations must originate from this exact app, including logout cleanup. */
export function hasPushSubscriptionOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site")
    return false;
  try {
    return (
      new URL(origin).origin === new URL(request.url).origin &&
      new URL(origin).href === `${new URL(origin).origin}/`
    );
  } catch {
    return false;
  }
}
