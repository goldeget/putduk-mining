import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = execFileSync(
  "rg",
  ["--files", "app", "components", "-g", "*.ts", "-g", "*.tsx"],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .sort();
const terms = [
  "확인할 수 없",
  "알 수 없",
  "확인 불가",
  "서버에서",
  "서버 기준",
  "DB",
  "authoritative",
  "snapshot",
  "raw enum",
];
const patterns = terms.map((term) => [
  term,
  new RegExp(term === "DB" ? "\\bDB\\b" : term, "i"),
]);
patterns.push([
  "technical error code / raw enum candidate",
  /["'`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)["'`]/,
]);
const findings = [];
const hashes = {};
function explain(file, line, internal) {
  if (internal)
    return [
      "식별자·주석·상태 코드 후보. 문자열 존재만으로 회원 화면 노출을 확정하지 않습니다.",
      "내부 이름은 유지하세요. 실제 렌더/응답 경로에서 한국어 허용 목록으로 표시되는지 확인합니다.",
    ];
  if (file.includes("notification-preferences"))
    return [
      "현재 설정 조회 실패. 이전 설정이나 저장 완료로 해석하면 안 됩니다.",
      "알림 설정을 불러오지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요.",
    ];
  if (file.includes("notification-item") || file.includes("/notifications/["))
    return [
      "삭제·만료·권한 거부 가능성이 있는 알림. 정확한 원인은 현재 문구만으로 확정 불가.",
      "이 알림을 열 수 없어요. 알림함으로 돌아가 최신 안내를 확인해 주세요.",
    ];
  if (file.includes("wallet/withdraw"))
    return [
      "환영 보상의 전환 상태 조회 실패. 미전환·거절·0원으로 판단하지 않음.",
      "전환 상태를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.",
    ];
  if (line.includes("체험 진행률"))
    return [
      "체험 진행률을 안전하게 산출할 정보가 없음. 보조기기 안내도 필요.",
      "체험 진행률을 불러오지 못했어요.",
    ];
  if (file.includes("mining-amount-board"))
    return [
      "금액 표시가 미확인. 확인 전 금액과 확정 보상을 구분해야 함.",
      "금액을 불러오지 못했어요. 다시 확인해 주세요. / 확인 전 금액이며 확정된 보상은 아닙니다.",
    ];
  if (file.includes("events"))
    return [
      "참여 상태 조회 실패. 미참여와 구분해야 함.",
      "참여 상태를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.",
    ];
  if (file.includes("start/error"))
    return [
      "체험 정보 조회 오류. 실제 처리 지속 여부는 이 오류 문구만으로 보증 불가.",
      "인터넷 연결을 확인한 뒤 다시 시도해 주세요. 다시 연결되면 최신 체험 상태를 확인할 수 있어요.",
    ];
  if (file.includes("guided-quest"))
    return [
      "이용 안내 항목을 선택할 맥락이 없음. 이용 기능 자체 실패와 구분.",
      "이용 안내를 불러오지 못했어요. 화면을 다시 연 뒤 안내를 켜 주세요.",
    ];
  if (file.includes("/auth/"))
    return [
      "가입 정보 중복 조회 요청 검증 실패. 정확한 필드·형식은 응답 분기 확인 필요.",
      "입력한 내용을 다시 확인해 주세요. 계속되면 잠시 후 다시 시도해 주세요.",
    ];
  if (file.includes("menu/ai") || line.includes("추측"))
    return [
      "미확인 정보 추측 방지 원칙. 정상적인 안전 안내이며 수정 필수 아님.",
      "유지 가능. 필요한 경우: 아직 확인하지 못한 내용은 추측하지 않아요.",
    ];
  if (line.includes("서버에서"))
    return [
      "조회 오류 상황에서 내부 계산 주체를 설명하는 문구.",
      "최신 정보를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.",
    ];
  return [
    "체험 또는 지갑 금액 조회 실패. 빈 값과 0원, 실제 빈 기록을 구분해야 함.",
    "금액을 불러오지 못했어요. 다시 확인해 주세요.",
  ];
}
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  hashes[file] = crypto.createHash("sha256").update(text).digest("hex");
  text.split(/\r?\n/).forEach((line, index) => {
    for (const [term, expression] of patterns) {
      if (!expression.test(line)) continue;
      const internal =
        term === "snapshot" ||
        term === "authoritative" ||
        term === "DB" ||
        term === "raw enum" ||
        term.startsWith("technical") ||
        /^\s*(?:\/\/|\*|\/\*)/.test(line);
      const [meaning, recommendation] = explain(file, line, internal);
      findings.push({
        file,
        line: index + 1,
        term,
        current_copy_or_source: line.trim(),
        classification: internal
          ? "INTERNAL_SOURCE_CANDIDATE"
          : "MEMBER_COPY_OR_API_MESSAGE_REVIEW",
        actual_state_meaning: meaning,
        recommended_korean: recommendation,
        evidence: "STATIC_SOURCE_READ_ONLY",
        render_verification: "UNRUN",
      });
    }
  });
}
const report = {
  baseline_sha: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  scan_scope: ["app/**/*.ts(x)", "components/**/*.ts(x)"],
  terms,
  technical_code_search:
    "quoted uppercase underscore token candidates; not a claim of raw UI leakage",
  source_hashes: hashes,
  matched_findings: findings.length,
  rendered_visibility: "NOT_VERIFIED",
  findings,
};
const out = path.join(root, "launch-content", "evidence");
fs.writeFileSync(
  path.join(out, "member-copy-audit.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
const escape = (value) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
const readable = findings.filter(
  (finding) => finding.classification === "MEMBER_COPY_OR_API_MESSAGE_REVIEW",
);
const md = [
  "# 회원 문구 감사 보고서",
  "",
  `기준: ${report.baseline_sha}. app/components는 읽기만 했습니다. 정적 검색 ${files.length}개 파일, 전체 후보 ${findings.length}개, 한국어 문구/API 메시지 후보 ${readable.length}개입니다.`,
  "",
  "전체 검색 목록·파일 해시·내부 enum/error code 후보는 member-copy-audit.json에 있습니다. 내부 코드가 검색됐다고 화면 노출을 확정하지 않습니다. 실제 렌더·접근성 이름·네트워크 오류 응답 확인은 Primary 최신 SHA에서 추가 검증해야 합니다.",
  "",
  "| 위치 | 현재 문구/소스 | 실제 상태 의미 | 권장 한국어 |",
  "| --- | --- | --- | --- |",
  ...readable.map(
    (finding) =>
      `| ${escape(finding.file)}:${finding.line} | ${escape(finding.current_copy_or_source)} | ${escape(finding.actual_state_meaning)} | ${escape(finding.recommended_korean)} |`,
  ),
  "",
  "## Primary 실행 목록",
  "",
  "1. 위 각 위치를 현재 작업 SHA에서 다시 찾고 실제 상태 분기를 확인합니다. 실패를 미참여·0원·정상으로 바꾸지 않습니다.",
  "2. 각 화면의 정상/빈 상태/조회 실패/권한 거부/오프라인/복구를 실제 브라우저로 확인합니다. 코드·주석·변수 이름은 회원 문구와 분리합니다.",
  "3. raw enum과 error code는 network 응답 존재가 아니라 실제 HTML/알림/접근성 이름에 노출되는지 확인합니다. 임의 상태 번역으로 도메인 의미를 바꾸지 않습니다.",
  "4. 폰 320/390, 태블릿 834, 데스크톱 1440, 확대 200%, 테마와 스크린리더 안내를 확인합니다.",
  "5. 수정은 Primary 소유 파일에서 진행합니다. 이 콘텐츠 lane에서는 UI·공용 helper·test assertion을 고치지 않습니다.",
  "",
];
fs.writeFileSync(path.join(out, "MEMBER-COPY-AUDIT.md"), md.join("\n"));
console.log(
  JSON.stringify({
    files: files.length,
    findings: findings.length,
    korean_copy_candidates: readable.length,
  }),
);
