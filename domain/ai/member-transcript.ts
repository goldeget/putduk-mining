const MASK = "[가림]";
const STORED_BODY_MAX = 8_000;
const TITLE_MAX = 80;

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bsk-[A-Za-z0-9_\-]{8,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /(?:비밀번호|패스워드|password|passwd|pwd|otp|인증\s*번호|api\s*key|access\s*token|refresh\s*token|secret|token|개인\s*키|비밀\s*키|private\s*key)\s*(?:은|는|이|가|:|：|=)?\s*[A-Za-z0-9_+/=.\-]{6,}/gi,
  /(?:시드(?:\s*문구)?|seed(?:\s*phrase)?|복구\s*문구)\s*(?:은|는|:|：|=)?\s*(?:[a-z]{3,12}\s+){11,23}[a-z]{3,12}/gi,
  /\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2,7}\b/g,
];

/** 저장·제공자 전달 전에 비밀값 원문을 지운다. 원문 토큰은 반환하지 않는다. */
export function redactMemberTranscript(input: string) {
  let text = input;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, MASK);
  }
  const trimmed = text.trim();
  if (!trimmed) return "내용이 가려졌어요.";
  return trimmed;
}

export function conversationTitle(redactedText: string) {
  const title = Array.from(redactedText.replace(/\s+/g, " ").trim())
    .slice(0, TITLE_MAX)
    .join("")
    .trim();
  return title || "새 대화";
}

export function splitStoredBody(redactedText: string) {
  const characters = Array.from(redactedText.trim() || "내용이 가려졌어요.");
  const parts: string[] = [];
  for (let index = 0; index < characters.length; index += STORED_BODY_MAX) {
    const part = characters
      .slice(index, index + STORED_BODY_MAX)
      .join("")
      .trim();
    if (part) parts.push(part);
  }
  return parts.length > 0 ? parts : ["내용이 가려졌어요."];
}

export function sanitizeSourceKey(sourceKey: string) {
  const redacted = redactMemberTranscript(sourceKey)
    .replace(/\s+/g, " ")
    .trim();
  const compact = Array.from(redacted).slice(0, 160).join("").trim();
  if (!compact || compact === "내용이 가려졌어요." || compact === MASK) {
    return "guide:putduk";
  }
  return compact;
}

export function sanitizeKnowledgeVersion(version: string | null) {
  if (!version) return null;
  const redacted = redactMemberTranscript(version).replace(/\s+/g, " ").trim();
  const compact = Array.from(redacted).slice(0, 80).join("").trim();
  if (!compact || compact.includes(MASK) || compact === "내용이 가려졌어요.") {
    return null;
  }
  return compact;
}
