/**
 * 이용약관과 개인정보 처리방침의 단일 원천.
 *
 * - 가입 화면이 기록하는 동의 버전과 /terms, /privacy 본문이 같은 곳에서 나온다.
 * - 문장은 제품이 실제로 하는 일만 적는다. 요율, 기간, 권리, 약속을 새로 만들지 않는다.
 * - 아직 확정되지 않은 항목(보관 기간, 맡겨 처리하는 곳, 해외 이전)은
 *   확정된 것처럼 쓰지 않고 그대로 밝힌다.
 * - 한 문단에는 한 가지 생각만 담고, 문장은 짧게 쓴다.
 */

import { PUBLIC_SUPPORT_CONTACT } from "./public-contact";

/** worker가 요구하는 값(workers/runner.mjs)과 같아야 한다. 테스트가 확인한다. */
export const LEGAL_CONSENT_VERSIONS = {
  privacy: "PRIVACY-KO-2026-09-27",
  serviceTerms: "TERMS-KO-2026-09-27",
} as const;

type LegalSection = {
  body: readonly string[];
  heading: string;
  items?: readonly string[];
};

export type LegalDocument = {
  consentVersion: string;
  eyebrow: string;
  path: "/terms" | "/privacy";
  sections: readonly LegalSection[];
  summary: string;
  title: string;
};

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    path: "/terms",
    eyebrow: "TERMS",
    consentVersion: LEGAL_CONSENT_VERSIONS.serviceTerms,
    title: "서비스 이용약관",
    summary: "퍼뜩 채굴의 계정 이용, 서비스 기능 및 문의 방법을 안내합니다.",
    sections: [
      {
        heading: "이 약관은 무엇인가요",
        body: [
          "이 약관은 퍼뜩 채굴(PUTDUK MINING)의 이용 방법과 계정 관리 기준을 안내합니다.",
          "가입 시 동의한 약관의 버전과 동의 시각을 기록합니다.",
        ],
      },
      {
        heading: "가입과 계정",
        body: [],
        items: [
          "가입 화면에서 이름, 생년월일, 휴대전화 번호, 로그인 아이디와 복구 이메일을 입력합니다.",
          "휴대전화 번호는 가입 가능 여부와 중복 여부를 확인하는 데 사용합니다.",
          "이 확인은 휴대전화 소유 인증을 의미하지 않습니다.",
          "비밀번호와 인증 정보는 다른 사람에게 공유하지 마세요.",
          "아이디 확인과 비밀번호 재설정은 로그인 화면의 안내를 이용해 주세요.",
        ],
      },
      {
        heading: "PUTDUK START 체험",
        body: [
          "체험은 최대 24시간이에요. 사용량 100%에 먼저 닿으면 그때 끝나요.",
          "체험 기록은 실제 지갑과 따로 보관돼요. 그대로 실제 자산이 되지 않아요.",
        ],
        items: [
          "자격을 확인하면 한 번, 최대 5,000원까지 출금할 수 있는 원화로 바꿀 수 있어요.",
          "본인 확인 같은 확인이 필요해요. 위험 신호가 있으면 보류될 수 있어요.",
          "입금하지 않아도 돼요.",
        ],
      },
      {
        heading: "채굴과 결과",
        body: [
          "앱을 닫아도 채굴은 계속돼요. 다시 접속하면 결과를 확인할 수 있어요.",
        ],
        items: [
          "채굴과 정산은 서버가 확인한 시간과 적용 시점이 정해진 규칙으로 계산해요.",
          "외부 시세는 채굴 계산에 쓰지 않아요.",
          "이용할 수 있는 상품은 운영자가 승인해 게시한 목록에서 확인해요.",
        ],
      },
      {
        heading: "입금",
        body: [
          "입금은 선택 사항이에요. 원화 계좌이체 또는 USDT 수동 입금을 고를 수 있어요.",
        ],
        items: [
          "입금 요청만으로 잔액이 늘지 않아요.",
          "실제 입금을 확인한 금액만 원화 지갑에 반영돼요.",
          "USDT는 따로 보관하지 않아요. 확인된 금액이 원화로 반영돼요.",
        ],
      },
      {
        heading: "출금",
        body: [
          "출금은 원화 잔액에서 해요. USDT 출금도 원화 잔액을 기준으로 해요.",
        ],
        items: [
          "출금 전에 본인 확인이 필요해요.",
          "새 출금 계좌나 주소는 확인 절차를 거쳐요.",
          "운영자가 확인한 뒤 직접 보내요.",
        ],
      },
      {
        heading: "AI 안내",
        body: [
          "퍼뜩 AI는 서비스 이용과 계정 상태에 관한 설명·분석을 제공합니다.",
          "AI 답변은 잔액을 변경하거나 입금·출금을 승인하지 않습니다.",
          "질문과 답변의 처리에 관한 내용은 개인정보 처리방침에서 확인할 수 있습니다.",
        ],
      },
      {
        heading: "점검과 이용 제한",
        body: [
          "안전을 위해 가입, 입금, 출금, 채굴 같은 기능을 잠시 멈출 수 있어요.",
          "멈춘 동안에도 기록은 남아요.",
          "위험 신호가 확인되면 이용이 제한될 수 있어요.",
        ],
      },
      {
        heading: "약관이 바뀔 때",
        body: ["내용이 바뀌면 버전과 적용일을 공개해요."],
      },
      {
        heading: "문의",
        body: [
          `${PUBLIC_SUPPORT_CONTACT.serviceName} 서비스 문의: ${PUBLIC_SUPPORT_CONTACT.email}`,
          "계정 이용이나 서비스 화면에서 확인이 필요한 내용을 문의할 수 있습니다.",
          "비밀번호와 인증 정보는 보내지 마세요.",
        ],
      },
    ],
  },
  {
    path: "/privacy",
    eyebrow: "PRIVACY",
    consentVersion: LEGAL_CONSENT_VERSIONS.privacy,
    title: "개인정보 처리방침",
    summary:
      "퍼뜩 채굴의 개인정보 처리 항목, 이용 목적 및 문의 방법을 안내합니다.",
    sections: [
      {
        heading: "이 방침은 무엇인가요",
        body: [
          "이 방침은 퍼뜩 채굴의 개인정보 처리 항목과 이용 목적을 안내합니다.",
        ],
      },
      {
        heading: "가입할 때 받는 정보",
        body: [],
        items: [
          "이름과 생년월일",
          "휴대전화 번호",
          "로그인 아이디와 복구 이메일",
          "동의한 약관의 버전과 시각",
        ],
      },
      {
        heading: "쓰는 목적",
        body: [
          "계정 운영과 복구를 위해 가입 화면에서 입력한 정보를 사용합니다.",
        ],
      },
      {
        heading: "본인 확인 서류",
        body: [
          "출금이나 체험 전환 전에 본인 확인이 필요할 수 있어요.",
          "제출한 서류는 확인할 때만 운영자가 열어 봐요. 열어 본 기록이 남아요.",
        ],
      },
      {
        heading: "출금 계좌와 주소",
        body: [
          "출금 계좌와 USDT 주소는 암호화해서 보관해요.",
          "화면에는 일부만 보여요.",
        ],
      },
      {
        heading: "이용 기록",
        body: [
          "서비스를 쓰는 동안 일부 행동이 기록돼요. 예를 들면 가입 완료와 입금 요청이에요.",
          "입금, 출금, 채굴의 금액은 거래 기록으로 남아요.",
        ],
      },
      {
        heading: "AI 질문과 답변",
        body: [
          "퍼뜩 AI에 입력한 질문과 답변은 내 계정에 저장되며, 문의 확인이나 안전 점검이 필요할 때 권한이 있는 운영자가 열람할 수 있어요. 열람할 때마다 기록이 남고, 비밀번호나 인증키 같은 값은 가려서 보여 드려요.",
        ],
      },
      {
        heading: "마케팅 소식",
        body: [
          "혜택·이벤트 소식 수신은 선택 사항입니다.",
          "선택 항목에 동의하지 않아도 서비스를 이용할 수 있습니다.",
        ],
      },
      {
        heading: "아직 정해지지 않은 내용",
        body: [
          "보관 기간은 정해지는 대로 이 방침에 적어요.",
          "정보를 맡아 처리하는 곳과 보관 위치도 정해지는 대로 적어요.",
        ],
      },
      {
        heading: "문의",
        body: [
          `${PUBLIC_SUPPORT_CONTACT.serviceName} 개인정보 문의: ${PUBLIC_SUPPORT_CONTACT.email}`,
          "개인정보의 열람·정정·삭제·처리정지에 관한 문의는 위 연락처로 보내 주세요.",
          "문의에 비밀번호나 인증 정보를 포함하지 마세요.",
        ],
      },
    ],
  },
] as const;
