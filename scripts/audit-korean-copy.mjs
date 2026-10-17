import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const humanAttributes = new Set([
  "aria-label",
  "title",
  "placeholder",
  "alt",
  "label",
  "description",
  "message",
]);
const inlineElements = new Set(["span", "strong", "em", "b", "i", "a"]);

/** Audit candidates only. Never rewrite Korean grammar or infer CSS line breaks. */
export function auditKoreanCopySource(source, path = "copy.tsx") {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings = [];
  let koreanLiterals = 0;
  function parentWhere(node, predicate) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (predicate(parent)) return parent;
    }
    return undefined;
  }
  function visible(node) {
    const attribute = parentWhere(node, ts.isJsxAttribute);
    if (attribute) return humanAttributes.has(attribute.name.getText(file));
    // Callback bodies inside JSX expressions are behavior, not rendered copy.
    // Their Korean literals remain manual candidates through inspect().
    if (
      parentWhere(
        node,
        (parent) =>
          ts.isArrowFunction(parent) || ts.isFunctionExpression(parent),
      )
    )
      return false;
    return (
      ts.isJsxText(node) ||
      (ts.isJsxAttribute(node.parent) &&
        humanAttributes.has(node.parent.name.getText(file))) ||
      !!parentWhere(node, ts.isJsxExpression)
    );
  }
  function add(node, code, severity, text) {
    findings.push({
      path,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      code,
      severity,
      text: text.trim().replace(/\s+/gu, " ").slice(0, 180),
    });
  }
  function inspect(node, text, rendered) {
    if (!/[가-힣]/u.test(text)) return;
    koreanLiterals += 1;
    const severity = rendered ? "error" : "review";
    if (/[가-힣][.!?][가-힣A-Za-z]/u.test(text))
      add(node, "sentence-space", severity, text);
    if (/(?:운영자|회원|상태) 입니다/u.test(text))
      add(node, "obvious-copula", severity, text);
    if (!ts.isJsxText(node) && /[가-힣][ \t]{2,}[가-힣]/u.test(text))
      add(node, "repeated-space", "review", text);
    if (
      /서버에서|\b(?:DB|UUID|snapshot|authoritative|service_role|hash)\b/u.test(
        text,
      )
    )
      add(node, "technical-copy", "review", text);
  }
  function staticString(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return node.text;
    if (ts.isParenthesizedExpression(node))
      return staticString(node.expression);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = staticString(node.left),
        right = staticString(node.right);
      if (left !== undefined && right !== undefined) return left + right;
    }
    return undefined;
  }
  function numericOperand(node) {
    return (
      ts.isNumericLiteral(node) ||
      (ts.isPropertyAccessExpression(node) && node.name.text === "length")
    );
  }
  function inlineText(node) {
    if (
      !ts.isJsxElement(node) ||
      !inlineElements.has(node.openingElement.tagName.getText(file))
    )
      return undefined;
    const parts = [];
    for (const child of node.children) {
      if (ts.isJsxText(child)) parts.push(child.text.replace(/\s+/gu, " "));
      else if (ts.isJsxExpression(child) && child.expression) {
        const text = staticString(child.expression);
        if (text === undefined) return undefined;
        parts.push(text);
      } else return undefined;
    }
    return parts.join("");
  }
  function visit(node) {
    if (ts.isJsxText(node)) inspect(node, node.text, true);
    else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      if (
        !ts.isJsxAttribute(node.parent) ||
        humanAttributes.has(node.parent.name.getText(file))
      )
        inspect(node, node.text, visible(node));
    } else if (ts.isTemplateExpression(node)) {
      const fragments = [
        node.head.text,
        ...node.templateSpans.map((span) => span.literal.text),
      ];
      for (const fragment of fragments) inspect(node, fragment, visible(node));
      if (fragments.some((fragment) => /[가-힣]/u.test(fragment))) {
        add(node, "dynamic-template", "review", node.getText(file));
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const text = staticString(node);
      if (text !== undefined) inspect(node, text, visible(node));
      else if (
        !(numericOperand(node.left) && numericOperand(node.right)) &&
        (visible(node) || /[가-힣]/u.test(node.getText(file)))
      )
        add(node, "dynamic-concatenation", "review", node.getText(file));
    }
    if (ts.isJsxElement(node)) {
      let previous;
      for (const child of node.children) {
        if (
          ts.isJsxText(child) &&
          !child.text.trim() &&
          /[\r\n]/u.test(child.text)
        )
          continue;
        const text = inlineText(child);
        if (
          previous !== undefined &&
          text !== undefined &&
          /[가-힣][.!?]$/u.test(previous) &&
          /^[가-힣A-Za-z]/u.test(text)
        ) {
          add(child, "adjacent-jsx-copy", "review", previous + text);
        }
        previous = text;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { koreanLiterals, findings };
}

export function auditKoreanCopyFiles(files) {
  const audits = files.map(({ path, source }) =>
    auditKoreanCopySource(source, path),
  );
  const findings = audits.flatMap((audit) => audit.findings);
  return {
    sources: files.length,
    koreanLiterals: audits.reduce(
      (total, audit) => total + audit.koreanLiterals,
      0,
    ),
    errors: findings.filter((finding) => finding.severity === "error"),
    reviews: findings.filter((finding) => finding.severity === "review"),
    scope:
      "Tracked Public/Member/Admin TSX literals plus home-world-state/mining-presentation copy. Ambiguous grammar, dynamic/i18n composition, CSS wrapping and reference fidelity still require manual/browser QA. No automatic corrections.",
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const remote = execFileSync("git", ["remote", "get-url", "origin"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (remote !== "https://github.com/goldeget/putduk-mining.git")
    throw new Error("BLOCKED_TARGET_SCOPE");
  const paths = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--",
      "app",
      "components",
      "apps/admin/app",
      "apps/admin/components",
    ],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter((path) => path.endsWith(".tsx"));
  paths.push(
    "lib/product/home-world-state.ts",
    "lib/product/mining-presentation.ts",
  );
  if (paths.length === 0) throw new Error("No UI source files audited");
  const report = auditKoreanCopyFiles(
    paths.map((path) => ({
      path,
      source: readFileSync(resolve(root, path), "utf8"),
    })),
  );
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.errors.length > 0 ? 1 : 0;
}
