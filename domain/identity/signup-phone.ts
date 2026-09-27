export type SignupPhoneAvailability = "AVAILABLE" | "UNAVAILABLE";

const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;

/** 회원가입용 전화번호를 E.164로 정규화합니다. SMS/소유권 인증이 아닙니다. */
export function normalizeSignupPhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+")) {
    digits = `+${digits.slice(1).replace(/\D/g, "")}`;
  } else {
    const only = digits.replace(/\D/g, "");
    if (only.startsWith("00")) {
      digits = `+${only.slice(2)}`;
    } else if (only.startsWith("0")) {
      digits = `+82${only.slice(1)}`;
    } else if (only.startsWith("82")) {
      digits = `+${only}`;
    } else {
      return null;
    }
  }

  return E164_PATTERN.test(digits) ? digits : null;
}

export function isSignupPhoneAvailability(
  value: unknown,
): value is SignupPhoneAvailability {
  return value === "AVAILABLE" || value === "UNAVAILABLE";
}
