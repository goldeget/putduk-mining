import { createHmac } from "node:crypto";

const HEX_SECRET = /^[0-9a-fA-F]{32,128}$/;

/**
 * Channel Talk 공식 Member Hash.
 * secret은 hex로 디코드한 뒤 memberId를 HMAC-SHA256으로 서명하고 hex로 반환한다.
 */
export function createChannelMemberHash(
  memberId: string,
  secretHex: string,
): string {
  if (!memberId || !HEX_SECRET.test(secretHex) || secretHex.length % 2 !== 0) {
    throw new Error("CHANNEL_TALK_MEMBER_HASH_SECRET_INVALID");
  }

  return createHmac("sha256", Buffer.from(secretHex, "hex"))
    .update(memberId)
    .digest("hex");
}

export function readMemberHashSecret(value: string | undefined): string | null {
  const secret = value?.trim() ?? "";
  if (!secret) {
    return null;
  }
  if (!HEX_SECRET.test(secret) || secret.length % 2 !== 0) {
    return null;
  }
  return secret;
}
