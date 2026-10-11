import { Fragment, type ReactNode } from "react";
import styles from "./putduk-ai-chat.module.css";

/** Render a deliberately small text-only subset. Provider text never becomes HTML,
 * an image, a script, or an unapproved navigable URL. Streaming uses the same path. */
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|!?\[[^\]\n]*\]\([^\)\n]*\))/g)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`"))
        return <code key={index}>{part.slice(1, -1)}</code>;
      const link = /^(!?)\[([^\]]*)\]\(([^)]*)\)$/.exec(part);
      if (link)
        return (
          <Fragment key={index}>
            {link[1] ? "[이미지 표시 안 함]" : `${link[2]} (${link[3]})`}
          </Fragment>
        );
      return part;
    });
}

export function PutdukAiMessageBody({
  text,
  formatted = true,
}: {
  text: string;
  formatted?: boolean;
}) {
  if (!formatted)
    return (
      <div className={styles.messageBody}>
        <p>{text}</p>
      </div>
    );
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor]!;
    const key = cursor;
    if (!line.trim()) {
      cursor++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      cursor++;
      while (cursor < lines.length && !/^\s*```/.test(lines[cursor]!))
        code.push(lines[cursor++]!);
      if (cursor < lines.length) cursor++;
      blocks.push(
        <pre key={key}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<h3 key={key}>{inline(heading[1]!)}</h3>);
      cursor++;
      continue;
    }
    const list = /^\s*(?:[-*+] |\d+[.)] )/.exec(line);
    if (list) {
      const ordered = /^\s*\d+[.)] /.test(line);
      const firstNumber = ordered ? Number(/^\s*(\d+)/.exec(line)?.[1]) : 1;
      const start =
        Number.isSafeInteger(firstNumber) &&
        firstNumber >= 0 &&
        firstNumber <= 2_147_483_647 &&
        firstNumber !== 1
          ? firstNumber
          : undefined;
      const pattern = ordered ? /^\s*\d+[.)] (.*)$/ : /^\s*[-*+] (.*)$/;
      const items: ReactNode[] = [];
      while (cursor < lines.length) {
        const item = pattern.exec(lines[cursor]!);
        if (!item) break;
        items.push(<li key={cursor++}>{inline(item[1]!)}</li>);
      }
      blocks.push(
        ordered ? (
          <ol key={key} start={start}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        ),
      );
      continue;
    }
    const paragraph: string[] = [line];
    cursor++;
    while (
      cursor < lines.length &&
      lines[cursor]!.trim() &&
      !/^\s*(?:```|#{1,6}\s|[-*+] |\d+[.)] )/.test(lines[cursor]!)
    )
      paragraph.push(lines[cursor++]!);
    blocks.push(<p key={key}>{inline(paragraph.join("\n"))}</p>);
  }
  return <div className={styles.messageBody}>{blocks}</div>;
}
