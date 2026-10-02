/** 복구 이메일 일부를 가려 표시한다. */
export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "등록됨";
  return `${name.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`;
}

/** 휴대전화는 끝 4자리만 보인다. 소유 인증 문구는 쓰지 않는다. */
export function maskPhone(phone: string) {
  return phone.length >= 4 ? `••• •••• ${phone.slice(-4)}` : "등록됨";
}
