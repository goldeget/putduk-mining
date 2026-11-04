import {
  TRUST_DOCUMENTS as archivedDocuments,
  type PublicFact,
  type TrustDocument,
} from "@/lib/trust/public-content";
export type { PublicFact, TrustDocument } from "@/lib/trust/public-content";

export const TRUST_CONTENT_VERSION = "2026.11-workroom";
export const TRUST_LAST_UPDATED = "2026-11-04";
export const PUBLIC_FACTS: readonly PublicFact[] = [
  {
    key: "PRODUCT_NAME",
    value: "WORKROOM",
    description: "환율과 주식의 흐름을 경험하는 무료 모의 워크룸입니다.",
  },
  {
    key: "PRODUCT_TYPE",
    value: "무료 시뮬레이션",
    description: "실제 주문이나 거래를 실행하지 않습니다.",
  },
  {
    key: "OFFICIAL_DOMAIN",
    value: "mining.putduk.com",
    description: "기존 서비스 주소에서 워크룸을 이용합니다.",
  },
  {
    key: "MEMBER_SUPPORT_PATH",
    value: "/support",
    description: "계정, 체험, 기존 기록에 관한 문의를 확인합니다.",
  },
  {
    key: "TRIAL_LEDGER",
    value: "현금과 분리된 체험 포인트",
    description:
      "가입 시 100,000 P를 한 번 지급합니다. 현금 전환과 출금은 불가능합니다.",
  },
];
const titles: Record<string, string> = {
  "/about": "나만의 공간에서 시장의 흐름을 경험하세요.",
  "/how-it-works": "가입부터 회차 종료까지, 워크룸 이용 방법",
  "/faq": "워크룸에서 자주 묻는 질문",
  "/verification": "설정과 기록을 확인하는 기준",
  "/rules": "회차와 체험 포인트 안내",
  "/trial": "무료 체험 포인트 안내",
  "/status": "이용 상태 확인 안내",
};
const sections: TrustDocument["sections"] = [
  {
    heading: "추천인 코드로 가입하고 무료로 시작해요",
    body: [
      "담당자가 전달한 유효한 추천인 코드로 가입합니다. 가입 시 계정에 체험 포인트 100,000 P를 한 번 지급합니다. 기존 회원은 사용하던 계정으로 로그인할 수 있습니다.",
    ],
  },
  {
    heading: "참여 전에 회차 조건을 확인해요",
    body: [
      "환율 또는 주식 항목을 선택하고, 설정된 패턴·진행 시간·종료 변동률을 확인한 뒤 회차를 시작합니다. 차트는 사전 설정된 패턴을 따르는 모의 화면이며 실제 시장 주문을 실행하지 않습니다.",
      "참고 시세는 출처와 기준 시각을 함께 표시하며 모의 회차의 결과와 분리됩니다. 회차가 시작되면 해당 회차의 설정이 저장됩니다. 앱을 닫아도 서버 시간을 기준으로 진행되며, 다시 접속해 기록과 결과를 확인할 수 있습니다.",
    ],
  },
  {
    heading: "체험 포인트는 현금으로 바꿀 수 없어요",
    body: [
      "체험 포인트와 모의 손익은 실제 현금 잔액에 반영되지 않으며 입금·출금·환전 대상이 아닙니다. 워크룸은 무료로 이용합니다.",
      "기존 회원의 원화 잔액과 과거 거래 내역은 기존 기록 메뉴에 별도로 보존됩니다. 기존 잔액의 출금은 체험 포인트와 구분해 처리합니다.",
    ],
  },
  {
    heading: "계정과 기록에 관한 문의",
    body: [
      "로그인 문제나 표시 오류는 고객지원에 화면 이름과 대략적인 시각을 알려 주세요. 비밀번호, 인증 코드와 개인키는 보내지 마세요.",
    ],
  },
];

// Preserve the original consent text and consent versions; replace active product guidance.
export const TRUST_DOCUMENTS: readonly TrustDocument[] = archivedDocuments.map(
  (document) =>
    document.consentVersion
      ? document
      : {
          path: document.path,
          eyebrow: "WORKROOM GUIDE",
          title: titles[document.path] ?? "워크룸 이용 안내",
          summary:
            "실제 현금과 분리된 무료 시뮬레이션입니다. 회차 조건과 기록을 확인하고 이용하세요.",
          factKeys: ["PRODUCT_NAME", "PRODUCT_TYPE", "TRIAL_LEDGER"],
          sections,
        },
);
export function getTrustDocument(path: string) {
  return TRUST_DOCUMENTS.find((document) => document.path === path);
}
export function getPublicFacts(keys?: readonly string[]) {
  return PUBLIC_FACTS.filter((fact) => keys?.includes(fact.key));
}
