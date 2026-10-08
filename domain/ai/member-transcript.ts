const MASK = "[가림]";
const STORED_BODY_MAX = 8_000;
const TITLE_MAX = 80;

// A value's length is not a safety boundary: short OTPs and quoted passphrases
// are secrets too. Match whole labels, not words such as "tokenization".
const LABEL = String.raw`(?<![\p{L}\p{N}_])(?:비밀번호|패스워드|인증\s*번호|토큰|개인\s*키|비밀\s*키|복구\s*(?:문구|코드)|시드(?:\s*문구)?|(?:password|passwd|pwd|otp|pin|api\s*key|access[_\s-]*token|refresh[_\s-]*token|secret|token|private\s*key|seed(?:\s*phrase)?|recovery\s*code)\b)`;
const QUOTED_VALUE = new RegExp(
  LABEL +
    String.raw`(?:["'”’]\s*(?=[:：=]))?\s*(?:(?:은|는|이|가|\bis\b|\bwas\b)\s*)?[:：=]?\s*(["'“‘` +
    "`" +
    String.raw`「『])`,
  "giu",
);
const QUOTE_END: Readonly<Record<string, string>> = {
  '"': '"',
  "'": "'",
  "“": "”",
  "‘": "’",
  "`": "`",
  "「": "」",
  "『": "』",
};
const ASSIGNED_VALUE = new RegExp(
  LABEL +
    String.raw`(?:["'”’]\s*(?=[:：=]))?\s*(?:(?:은|는|이|가)\s*[:：=]|(?:\bis\b|\bwas\b)\s*[:：=]?|[:：=])[^\S\r\n]*[^\r\n]+`,
  "giu",
);
const SHORT_CODE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(?:otp\b|pin\b|인증\s*번호)\s*(?:(?:은|는|이|가)\s*)?\d+(?!\d)`,
  "giu",
);

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bnvapi-[A-Za-z0-9_-]{8,}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /(?<!\d)(?:\+82[- ]?1[016789]|01[016789])[- ]?\d{3,4}[- ]?\d{4}(?!\d)/g,
  /(?<!\d)\d{6}[- ]?[1-8]\d{6}(?!\d)/g,
  /(?:계좌\s*번호|account\s*number)\s*(?:은|는|:|=)?\s*[\d-]{8,30}/gi,
  /\b0x[0-9a-f]{40}\b/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bsk-[A-Za-z0-9_\-]{8,}\b/g,
  /\beyJ[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_+\/=-]{4,}){2}/g,
  /(?:시드(?:\s*문구)?|seed(?:\s*phrase)?|복구\s*문구)\s*(?:은|는|이|가|\bis\b|:|：|=)?\s*["'“”‘’`「」『』]?\s*(?:[a-z]{3,12}\s+){11,23}[a-z]{3,12}/gi,
  new RegExp(
    LABEL +
      String.raw`\s*(?:은|는|이|가|\bis\b|\bwas\b|:|：|=)?\s*["'“”‘’` +
      "`" +
      String.raw`「」『』]?\s*[^\s"'“”‘’` +
      "`" +
      String.raw`「」『』]{6,}`,
    "giu",
  ),
  /\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2,7}\b/g,
];

function redactQuotedValues(input: string) {
  // Work against the original string. Advancing lastIndex past each entire
  // value also avoids rematching labels inside a secret or quadratic scans.
  const pattern = new RegExp(QUOTED_VALUE.source, QUOTED_VALUE.flags);
  const pieces: string[] = [];
  let copiedUntil = 0;
  for (let match = pattern.exec(input); match; match = pattern.exec(input)) {
    const closing = QUOTE_END[match[1] ?? ""];
    if (!closing) continue;
    let end = pattern.lastIndex;
    while (end < input.length) {
      const character = input[end];
      end += 1;
      if (character === "\\") {
        end = Math.min(input.length, end + 1);
      } else if (character === closing) {
        break;
      }
    }
    // An unclosed quoted secret consumes the remainder, never just one word.
    pieces.push(input.slice(copiedUntil, match.index), MASK);
    copiedUntil = end;
    pattern.lastIndex = end;
  }
  pieces.push(input.slice(copiedUntil));
  return pieces.join("");
}

/** Best-effort redaction shared by persistence and outgoing provider text. */
export function redactMemberTranscript(input: string) {
  let text = redactQuotedValues(input);
  // Unquoted explicit assignments are conservatively masked to the line end;
  // there is no reliable way to infer where a multiword password ends.
  text = text.replace(ASSIGNED_VALUE, MASK).replace(SHORT_CODE, MASK);
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
