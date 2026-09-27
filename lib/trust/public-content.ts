export const TRUST_CONTENT_VERSION = "2026.09";
export const TRUST_LAST_UPDATED = "2026-09-26";

export type PublicFact = {
  description: string;
  key: string;
  value: string;
};

export const PUBLIC_FACTS: readonly PublicFact[] = [
  {
    key: "PRODUCT_NAME",
    value: "퍼뜩 채굴 / PUTDUK MINING",
    description: "PUTDUK의 서버 권위형 가상 채굴 플랫폼입니다.",
  },
  {
    key: "PRODUCT_TYPE",
    value: "Virtual mining platform",
    description:
      "다섯 개의 내부 월드에서 가상 채굴 흐름을 제공하며 외부 증권·거래소 시세를 채굴 계산에 사용하지 않습니다.",
  },
  {
    key: "OFFICIAL_DOMAIN",
    value: "mining.putduk.com",
    description:
      "사용자용 공식 서비스 도메인입니다. 정식 서비스 연결 전에는 준비 상태로 표시됩니다.",
  },
  {
    key: "ADMIN_DOMAIN",
    value: "admin.mining.putduk.com",
    description: "권한을 가진 운영자만 접근하는 별도 관리자 도메인입니다.",
  },
  {
    key: "SUPPORTED_WORLDS",
    value: "KOREA, USA, GOLD, SILVER, CRYPTO",
    description: "V1에서 정의된 다섯 개의 가상 채굴 월드입니다.",
  },
  {
    key: "TRIAL_DURATION",
    value: "최대 24시간",
    description:
      "사용량 100% 또는 24시간 중 먼저 도달한 시점에 체험이 종료됩니다.",
  },
  {
    key: "TRIAL_LEDGER",
    value: "실제 지갑과 완전 분리",
    description: "체험 결과는 체험 전용 계정과 원장에만 기록됩니다.",
  },
  {
    key: "SUPPORTED_FUNDING_METHODS",
    value: "KRW, USDT",
    description:
      "KRW가 기본 방식이며 USDT는 사용자가 선택한 경우에만 나타납니다.",
  },
  {
    key: "SETTLEMENT_AUTHORITY",
    value: "Server time and versioned rules",
    description:
      "채굴·정산은 서버 시간과 적용 시점이 명시된 규칙 버전을 사용합니다.",
  },
  {
    key: "AI_BOUNDARY",
    value: "Explain and analyze only",
    description:
      "PUTDUK AI는 잔액, 승인, 원장, 채굴 결과를 직접 변경하지 않습니다.",
  },
] as const;

export type TrustSection = {
  body: readonly string[];
  heading: string;
  items?: readonly string[];
};

export type TrustDocument = {
  eyebrow: string;
  factKeys?: readonly string[];
  path: string;
  sections: readonly TrustSection[];
  summary: string;
  title: string;
};

export const TRUST_DOCUMENTS: readonly TrustDocument[] = [
  {
    path: "/about",
    eyebrow: "ABOUT PUTDUK",
    title: "채굴의 시간을, 검증 가능한 기록으로.",
    summary:
      "퍼뜩 채굴은 복잡한 경제 시스템을 사용자에게는 명확한 경험으로, 운영에는 추적 가능한 기록으로 제공하도록 설계된 가상 채굴 플랫폼입니다.",
    factKeys: ["PRODUCT_NAME", "PRODUCT_TYPE", "SUPPORTED_WORLDS"],
    sections: [
      {
        heading: "무엇을 만드는가",
        body: [
          "사용자는 KOREA, USA, GOLD, SILVER, CRYPTO 월드에서 가상 채굴 농장을 운영합니다. 월드의 경제는 PUTDUK 내부 규칙으로 정의되며 외부 증권이나 거래소의 실시간 시세에 의존하지 않습니다.",
          "제품의 핵심은 화려한 숫자가 아니라 그 숫자가 언제, 어떤 규칙으로, 왜 생겼는지 설명할 수 있는 구조입니다.",
        ],
      },
      {
        heading: "설계 원칙",
        body: [],
        items: [
          "모든 채굴과 정산은 서버 시간으로 계산합니다.",
          "자산 변화는 덮어쓰지 않고 원장 이벤트로 남깁니다.",
          "체험 자산과 실제 자산은 섞이지 않습니다.",
          "운영 변경은 적용 시점과 감사 기록을 가집니다.",
        ],
      },
    ],
  },
  {
    path: "/how-it-works",
    eyebrow: "PRODUCT FLOW",
    title: "사용은 단순하게, 계산은 서버에서 엄격하게.",
    summary:
      "가입부터 체험, 입금, 실제 채굴과 정산까지 각 단계의 책임과 데이터 경계를 분리합니다.",
    factKeys: ["TRIAL_DURATION", "SETTLEMENT_AUTHORITY", "TRIAL_LEDGER"],
    sections: [
      {
        heading: "핵심 흐름",
        body: [
          "가입 후 PUTDUK START에서 첫 채굴 결과를 확인하고, 체험을 마친 뒤 사용자가 원할 때 입금과 실제 채굴로 이어집니다.",
        ],
        items: [
          "가입 및 계정 검증",
          "PUTDUK START 체험 시작",
          "서버 시간 기반 체험 정산",
          "입금 요청과 운영 확인",
          "실제 채굴과 자동 정산",
          "원장과 알림을 통한 결과 확인",
        ],
      },
      {
        heading: "화면을 닫아도 이어지는 이유",
        body: [
          "브라우저가 매초 숫자를 저장하는 방식이 아닙니다. 서버가 마지막 정산 시점과 현재 시점 사이의 유효 시간을 계산하고, 해당 구간에 적용된 규칙 버전으로 결과를 확정합니다.",
        ],
      },
    ],
  },
  {
    path: "/putduk-facts",
    eyebrow: "CANONICAL FACTS",
    title: "공식 사실은 한곳에서 관리합니다.",
    summary:
      "제품 페이지, FAQ, 검색 데이터와 PUTDUK AI가 서로 다른 설명을 만들지 않도록 공개 사실의 기준을 통합합니다.",
    factKeys: PUBLIC_FACTS.map((fact) => fact.key),
    sections: [
      {
        heading: "공개 기준",
        body: [
          "이 페이지의 사실 항목은 현재 공개 콘텐츠의 기준입니다. 운영자가 새로운 버전을 승인하기 전에는 이전에 게시된 설명을 조용히 덮어쓰지 않습니다.",
        ],
      },
    ],
  },
  {
    path: "/verification",
    eyebrow: "VERIFICATION",
    title: "결과만이 아니라 근거를 확인합니다.",
    summary:
      "채굴, 정산, 입출금과 운영 변경이 각각 어떤 검증 경계를 통과하는지 공개합니다.",
    factKeys: ["SETTLEMENT_AUTHORITY", "TRIAL_LEDGER", "AI_BOUNDARY"],
    sections: [
      {
        heading: "서버 권위",
        body: [
          "클라이언트 화면은 잔액이나 채굴 보상을 결정하지 않습니다. 서버는 사용자 권한, 요청 중복 여부, 적용 규칙과 시간을 검증한 뒤 결과를 기록합니다.",
        ],
      },
      {
        heading: "원장과 감사",
        body: [],
        items: [
          "동일한 금융성 요청은 멱등 키로 중복 처리를 방지합니다.",
          "잔액은 원장 항목의 합으로 계산합니다.",
          "운영자 조정에는 사유와 감사 이벤트가 필요합니다.",
          "경제 규칙 변경은 버전과 적용 시점을 가집니다.",
        ],
      },
    ],
  },
  {
    path: "/mining-rules",
    eyebrow: "MINING RULES",
    title: "정산 규칙은 시간 구간과 버전으로 고정됩니다.",
    summary:
      "경과 시간, 기본 채굴률, 장비 효율, 월드·이벤트·상태 배율을 서버가 계산합니다.",
    factKeys: ["SETTLEMENT_AUTHORITY", "SUPPORTED_WORLDS"],
    sections: [
      {
        heading: "계산 원칙",
        body: [
          "개념적으로 정산량은 유효 경과 시간과 승인된 각 배율의 곱으로 계산됩니다. 구체적인 생산 값은 운영 승인 전 공개 숫자로 간주하지 않습니다.",
        ],
        items: [
          "서버 시간만 사용",
          "매초 데이터베이스 쓰기 금지",
          "마지막 정산 시점을 기준점으로 사용",
          "규칙 변경 시 시간 구간을 분리",
          "동일 구간 정산 중복 방지",
        ],
      },
      {
        heading: "운영 상태",
        body: [
          "정상, 감속, 점검, 부분 중지, 중지 상태를 구분하며 각 상태는 적용된 시간 구간과 함께 기록됩니다.",
        ],
      },
    ],
  },
  {
    path: "/trial",
    eyebrow: "PUTDUK START",
    title: "최대 24시간, 실제 자산과 분리된 첫 경험.",
    summary:
      "처음 가입한 사용자가 KOREA 월드에서 핵심 채굴 흐름을 이해하도록 설계한 사용량 기반 체험입니다.",
    factKeys: ["TRIAL_DURATION", "TRIAL_LEDGER", "SUPPORTED_WORLDS"],
    sections: [
      {
        heading: "종료 조건",
        body: [
          "체험은 사용량 100% 또는 시작 후 24시간 중 먼저 도달한 시점에 종료됩니다. 앱을 닫은 시간도 서버 기준 유효 구간으로 처리됩니다.",
        ],
      },
      {
        heading: "분리 원칙",
        body: [
          "체험 계정, 세션과 원장은 실제 지갑과 별도입니다. 체험 결과가 실제 잔액으로 자동 전환되거나 섞이지 않습니다.",
        ],
      },
    ],
  },
  {
    path: "/economy",
    eyebrow: "INTERNAL ECONOMY",
    title: "경제는 내부 규칙이며, 변경은 미래 시점부터 적용됩니다.",
    summary:
      "월드별 생산 규칙은 버전 관리되며 운영 승인과 적용 시점 없이 변경되지 않습니다.",
    factKeys: ["PRODUCT_TYPE", "SETTLEMENT_AUTHORITY"],
    sections: [
      {
        heading: "외부 시세와의 경계",
        body: [
          "월드 이름은 제품 안의 가상 분류입니다. 채굴 경제는 외부 증권, 거래소 또는 실시간 시장 데이터에 연동되지 않습니다.",
        ],
      },
      {
        heading: "변경 절차",
        body: [],
        items: [
          "초안 작성",
          "테스트 월드 시뮬레이션",
          "변경 전후 비교",
          "권한 있는 운영자 승인",
          "미래 적용 시점 지정",
          "감사 기록과 사용자 영향 변경 내역 게시",
        ],
      },
    ],
  },
  {
    path: "/deposit",
    eyebrow: "DEPOSIT",
    title: "입금 요청과 잔액 반영은 같은 일이 아닙니다.",
    summary:
      "KRW를 기본 방식으로 제공하고, 사용자가 선택할 때만 USDT 경로를 표시합니다.",
    factKeys: ["SUPPORTED_FUNDING_METHODS"],
    sections: [
      {
        heading: "KRW 흐름",
        body: [
          "사용자가 요청을 생성하면 승인된 계좌 안내와 운영 확인 단계를 거칩니다. 실제 입금이 검증되고 DEPOSIT 원장 항목이 만들어진 뒤에만 표시 잔액이 변합니다.",
        ],
      },
      {
        heading: "USDT 흐름",
        body: [
          "USDT는 보조 선택지입니다. 네트워크, 주소, 확인 기준이 운영 승인된 경우에만 안내하며 외부 거래소 API 연동을 전제로 하지 않습니다.",
        ],
      },
    ],
  },
  {
    path: "/withdrawal",
    eyebrow: "WITHDRAWAL",
    title: "출금은 가용 금액, 검증, 승인을 분리합니다.",
    summary:
      "출금 요청 금액은 사용 가능 잔액과 분리해 보류하고, 처리 결과는 독립된 원장 이벤트로 남깁니다.",
    factKeys: ["SUPPORTED_FUNDING_METHODS"],
    sections: [
      {
        heading: "안전 경계",
        body: [],
        items: [
          "요청 시 가용 금액 검증",
          "수수료와 실수령액의 명시적 분리",
          "운영 승인과 감사 기록",
          "완료·거절·취소 상태의 독립 기록",
          "중복 요청 방지",
        ],
      },
      {
        heading: "V1 운영",
        body: [
          "KRW와 USDT 모두 승인된 운영 절차에 따라 처리됩니다. 실제 출금 기능은 계좌·네트워크·보안 정책이 최종 운영 승인을 마친 뒤 활성화됩니다.",
        ],
      },
    ],
  },
  {
    path: "/faq",
    eyebrow: "FAQ",
    title: "자주 묻는 질문에 같은 기준으로 답합니다.",
    summary: "공식 사실과 제품 경계를 짧고 직접적으로 설명합니다.",
    factKeys: ["TRIAL_DURATION", "SUPPORTED_FUNDING_METHODS", "AI_BOUNDARY"],
    sections: [
      {
        heading: "실제 컴퓨터로 코인을 채굴하나요?",
        body: [
          "아닙니다. PUTDUK MINING은 내부 규칙으로 운영되는 가상 채굴 플랫폼입니다. 사용자의 기기 자원으로 암호화폐를 채굴하지 않습니다.",
        ],
      },
      {
        heading: "체험 결과가 실제 잔액이 되나요?",
        body: [
          "아닙니다. PUTDUK START의 계정과 원장은 실제 지갑과 완전히 분리됩니다.",
        ],
      },
      {
        heading: "화면을 닫으면 채굴이 멈추나요?",
        body: [
          "유효한 세션이라면 서버가 마지막 정산 시점 이후의 시간을 계산합니다. 브라우저가 백그라운드에서 숫자를 조작하는 방식은 아닙니다.",
        ],
      },
      {
        heading: "AI가 자산을 대신 움직일 수 있나요?",
        body: [
          "아닙니다. PUTDUK AI는 설명과 분석만 제공하며 잔액, 승인, 원장 또는 채굴 결과를 직접 변경할 권한이 없습니다.",
        ],
      },
    ],
  },
  {
    path: "/status",
    eyebrow: "SERVICE STATUS",
    title: "현재 정식 서비스 오픈을 준비하고 있습니다.",
    summary:
      "사용자의 자산과 개인정보를 안전하게 다룰 수 있도록 핵심 기능과 운영 절차를 순서대로 검증하고 있습니다.",
    sections: [
      {
        heading: "현재 상태",
        body: [
          "가입, 채굴, 지갑, 입출금, 알림과 운영 안전 절차를 차례로 확인하고 있습니다. 실제 이용 가능 상태는 보안·복구·성능·운영 검증과 최종 출시 승인을 모두 통과한 뒤에만 안내합니다.",
        ],
      },
      {
        heading: "상태 표시 원칙",
        body: [
          "구성되지 않은 외부 서비스나 아직 승인되지 않은 경제 규칙을 정상 운영 중인 것처럼 표시하지 않습니다.",
        ],
      },
    ],
  },
  {
    path: "/changelog",
    eyebrow: "CHANGELOG",
    title: "사용자에게 영향을 주는 변경을 숨기지 않습니다.",
    summary:
      "공개 변경 내역은 기능 출시와 경제·운영 정책의 적용 시점을 구분해 기록합니다.",
    sections: [
      {
        heading: "2026.09 — 서비스 준비",
        body: [
          "PUTDUK MINING의 가입, 채굴, 지갑, 운영 안전 절차와 사용자 경험을 준비하고 있습니다. 아직 정식 서비스 오픈을 의미하지 않습니다.",
        ],
      },
      {
        heading: "게시 기준",
        body: [
          "출시 후에는 사용자 결과, 경제 규칙, 입출금 절차 또는 개인정보 처리에 영향을 주는 변경의 버전과 적용일을 이곳에 기록합니다.",
        ],
      },
    ],
  },
  {
    path: "/ai/about",
    eyebrow: "PUTDUK AI",
    title: "설명은 깊게, 권한은 좁게.",
    summary:
      "PUTDUK AI는 승인된 제품 지식과 허용된 사용자 맥락을 바탕으로 설명·요약·분석을 제공하도록 설계됩니다.",
    factKeys: ["AI_BOUNDARY"],
    sections: [
      {
        heading: "할 수 있는 일",
        body: [],
        items: [
          "공식 규칙과 상태 설명",
          "허용된 사용자 정보 요약",
          "채굴·원장 기록 이해 지원",
          "다음 행동 선택지 제안",
        ],
      },
      {
        heading: "할 수 없는 일",
        body: [],
        items: [
          "잔액 변경 또는 원장 생성",
          "입금·출금 승인",
          "채굴 결과 결정",
          "경제 규칙 또는 관리자 권한 변경",
        ],
      },
    ],
  },
  {
    path: "/ai/facts",
    eyebrow: "AI FACTS",
    title: "AI가 참조하는 공개 사실도 같은 버전을 사용합니다.",
    summary:
      "검색 시스템과 AI가 읽을 수 있는 형식으로 공개하되, 사용자 비공개 정보와 운영 내부 데이터는 포함하지 않습니다.",
    factKeys: PUBLIC_FACTS.map((fact) => fact.key),
    sections: [
      {
        heading: "범위",
        body: [
          "공개 사실 데이터는 제품 정체성, 체험, 채굴 원칙, 지원 방식과 AI 권한 경계만 포함합니다. 개인 지갑, 내부 API, 관리자 화면, 비밀 값과 데이터베이스 구조는 공개 대상이 아닙니다.",
        ],
      },
    ],
  },
  {
    path: "/ai/faq",
    eyebrow: "AI FAQ",
    title: "PUTDUK AI의 답변 경계를 먼저 공개합니다.",
    summary:
      "AI 기능을 활성화하기 전에 지식 출처, 데이터 범위와 실패 동작을 명확히 합니다.",
    factKeys: ["AI_BOUNDARY"],
    sections: [
      {
        heading: "AI 제공자는 언제 연결되나요?",
        body: [
          "모델 제공자, 보존 정책, 비용 한도와 지식 버전이 모두 운영 승인되고 서버 구성이 완료된 경우에만 연결됩니다. 구성되지 않은 환경에서는 사용자 질문을 외부 AI 제공자에게 보내지 않습니다.",
        ],
      },
      {
        heading: "답변이 자산을 바꿀 수 있나요?",
        body: [
          "아닙니다. AI 실행 경로는 원장, 승인, 정산과 권한 변경 명령에서 분리됩니다.",
        ],
      },
      {
        heading: "모르는 내용은 어떻게 처리하나요?",
        body: [
          "승인된 근거가 없거나 최신성을 확인할 수 없으면 추측하지 않고 확인 불가 또는 운영 확인 필요 상태를 표시하도록 설계합니다.",
        ],
      },
    ],
  },
  {
    path: "/ai/how-it-works",
    eyebrow: "HOW PUTDUK AI WORKS",
    title: "질문, 근거, 응답과 사용량을 서로 분리해 기록합니다.",
    summary:
      "AI 요청은 인증, 정책, 지식 버전, 제공자 호출과 감사 가능한 사용량 기록의 경계를 통과합니다.",
    factKeys: ["AI_BOUNDARY"],
    sections: [
      {
        heading: "응답 흐름",
        body: [],
        items: [
          "인증된 사용자와 요청 소유권 확인",
          "민감 작업 및 금지 권한 차단",
          "승인된 지식 버전 검색",
          "제공자 설정과 비용 한도 검증",
          "실제 스트리밍 응답과 취소 처리",
          "요청·사용량·근거 메타데이터 기록",
        ],
      },
      {
        heading: "현재 활성화 조건",
        body: [
          "제공자와 정책이 구성되지 않은 상태에서는 데모 응답이나 가짜 진행률을 만들지 않습니다. 기능은 준비되지 않았다고 명확히 표시합니다.",
        ],
      },
    ],
  },
] as const;

const DOCUMENT_BY_PATH = new Map(
  TRUST_DOCUMENTS.map((document) => [document.path, document]),
);

export function getTrustDocument(path: string) {
  return DOCUMENT_BY_PATH.get(path);
}

export function getPublicFacts(keys?: readonly string[]) {
  if (!keys) {
    return [];
  }

  const keySet = new Set(keys);
  return PUBLIC_FACTS.filter((fact) => keySet.has(fact.key));
}
