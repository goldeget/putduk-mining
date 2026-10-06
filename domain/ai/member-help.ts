import { z } from "zod";

/** Public navigation only. An action opens a screen; it never executes a command. */
export const MEMBER_AI_NAVIGATION_ROUTES = [
  "/home",
  "/start",
  "/mining",
  "/products",
  "/wallet",
  "/wallet/deposit",
  "/wallet/withdraw",
  "/events",
  "/notifications",
  "/menu",
  "/menu/account",
  "/menu/notifications",
  "/support",
  "/putduk-facts",
  "/mining-rules",
  "/ai",
] as const;

export const MEMBER_AI_HELP_TOPICS = [
  "getting_started",
  "home",
  "start",
  "mining",
  "products",
  "wallet",
  "deposit",
  "withdrawal",
  "events",
  "notifications",
  "notification_settings",
  "account",
  "menu",
  "support",
  "rules",
  "troubleshooting",
  "ai",
] as const;

export const memberAiHelpTopicSchema = z.enum(MEMBER_AI_HELP_TOPICS);
export type MemberAiHelpTopic = z.infer<typeof memberAiHelpTopicSchema>;
export type MemberAiNavigationRoute =
  (typeof MEMBER_AI_NAVIGATION_ROUTES)[number];
export type MemberAiNavigation = {
  href: MemberAiNavigationRoute;
  label: string;
};
type MemberAiHelp = {
  title: string;
  answer: string;
  actions: readonly MemberAiNavigation[];
};

const HELP: Readonly<Record<MemberAiHelpTopic, MemberAiHelp>> = {
  getting_started: {
    title: "처음 이용할 때",
    answer:
      "처음이라면 PUTDUK START에서 체험 상태와 시작 안내를 확인해 주세요. 체험 결과와 실제 지갑 잔액은 따로 표시돼요.\n\n체험 뒤에는 START에 표시된 자격 확인 안내를 따라가세요. 자격이 확인된 환영 보상을 출금하기 전에 입금할 필요는 없어요.",
    actions: [
      { href: "/start", label: "START 확인" },
      { href: "/home", label: "홈으로" },
    ],
  },
  home: {
    title: "홈 화면 도움",
    answer:
      "홈에서 START와 내 채굴 상태를 확인할 수 있어요. 자세한 채굴 기록은 채굴 화면, 실제 잔액과 거래 내역은 자산 화면에서 확인해 주세요.\n\n표시된 상태를 불러오지 못했다면 다시 불러오기를 눌러 주세요. 확인되지 않은 잔액이나 보상은 추측하지 않아요.",
    actions: [
      { href: "/start", label: "START 확인" },
      { href: "/mining", label: "채굴 보기" },
      { href: "/wallet", label: "자산 보기" },
    ],
  },
  start: {
    title: "START 이용 도움",
    answer:
      "PUTDUK START에서 현재 체험 상태와 사용량을 확인해 주세요. 시작할 수 있을 때 표시되는 시작 버튼을 이용하면 돼요. 앱을 닫아도 체험은 계속돼요.\n\n체험 결과가 실제 지갑으로 자동 합쳐지지는 않아요. 전환은 START에 표시된 자격 확인 안내를 따라 진행해 주세요. 환영 보상 출금에 사전 입금은 필요하지 않아요.",
    actions: [
      { href: "/start", label: "START 확인" },
      { href: "/wallet/withdraw", label: "출금 안내" },
    ],
  },
  mining: {
    title: "채굴 화면 도움",
    answer:
      "채굴 화면에서 현재 채굴 상태와 사용량을 확인해 주세요. 상세 보기에서는 확인된 기록과 이용 조건을 살펴볼 수 있어요. 체험 결과와 실제 채굴 기록은 구분해서 확인해 주세요.\n\n화면의 움직임만으로 보상이나 잔액이 결정되지는 않아요. 확정된 잔액은 자산 화면에서 확인할 수 있어요. 개인별 속도가 달라진 이유는 적용된 기록을 확인해야 알 수 있어요.",
    actions: [
      { href: "/mining", label: "채굴 보기" },
      { href: "/wallet", label: "자산 보기" },
    ],
  },
  products: {
    title: "상품 화면 도움",
    answer:
      "상품 화면에서 공개된 상품 설명과 이용 가능 상태를 확인할 수 있어요. 화면에 표시된 상품을 선택해 자세한 안내를 살펴보세요.\n\n상품이 보이지 않거나 이용 가능 여부를 확인하지 못했다면 다시 불러와 주세요. 공개된 설명만으로 개인의 수익이나 채굴 결과를 보장할 수는 없어요.",
    actions: [
      { href: "/products", label: "상품 보기" },
      { href: "/mining", label: "내 채굴 보기" },
    ],
  },
  wallet: {
    title: "자산 화면 도움",
    answer:
      "자산 화면에서 실제 지갑 잔액과 거래 내역을 확인할 수 있어요. 사용 가능 금액은 현재 이용할 수 있는 금액이고, 예약·보류 금액은 처리 중인 요청 등으로 따로 잡힌 금액이에요.\n\n체험 결과는 실제 지갑 잔액과 별도로 확인해 주세요. 상태를 불러오지 못했다면 잔액을 추측하지 말고 다시 불러와 주세요.",
    actions: [
      { href: "/wallet", label: "자산 보기" },
      { href: "/wallet/deposit", label: "입금 안내" },
      { href: "/wallet/withdraw", label: "출금 안내" },
    ],
  },
  deposit: {
    title: "입금 이용 도움",
    answer:
      "입금 화면에서 현재 이용할 수 있는 입금 수단과 안내를 확인해 주세요. 요청을 만든 것만으로 잔액에 반영되지는 않아요. 실제 입금이 확인된 뒤 기록돼요.\n\nUSDT는 직접 보내는 입금 방식이에요. 선택한 네트워크와 주소 안내를 확인해 주세요. 입금 확인이 끝날 시각을 보장할 수는 없어요.",
    actions: [
      { href: "/wallet/deposit", label: "입금 화면" },
      { href: "/wallet", label: "거래 내역 보기" },
    ],
  },
  withdrawal: {
    title: "출금 이용 도움",
    answer:
      "출금 화면에서 사용 가능 금액, 출금 수단과 필요한 확인 절차를 살펴보세요. 요청 전 화면에 표시되는 수수료와 받을 금액을 확인해 주세요.\n\n환영 보상 출금에는 사전 입금이 필요하지 않아요. 자격과 출금 준비 상태는 화면의 안내를 따라 확인해 주세요. 출금 승인이나 완료 시각은 보장할 수 없어요.",
    actions: [
      { href: "/wallet/withdraw", label: "출금 화면" },
      { href: "/start", label: "환영 보상 확인" },
    ],
  },
  events: {
    title: "이벤트 이용 도움",
    answer:
      "이벤트 화면에서 공개된 이벤트를 선택해 참여 조건과 기간을 확인해 주세요. 실제 참여 가능 여부와 진행 상태는 각 이벤트의 안내를 기준으로 확인해야 해요.\n\n참여했다고 보상이 자동으로 확정되는 것은 아니에요. 조건을 확인하지 못했다면 자격이나 받을 금액을 추측하지 않아요.",
    actions: [
      { href: "/events", label: "이벤트 보기" },
      { href: "/notifications", label: "관련 알림 보기" },
    ],
  },
  notifications: {
    title: "알림 화면 도움",
    answer:
      "알림에서 채굴·자산·이벤트 소식을 확인할 수 있어요. 알림을 열어 내용을 살펴보고 읽음 상태를 관리해 주세요.\n\n받고 싶은 알림 종류와 기기 푸시는 알림 설정에서 선택할 수 있어요. 알림과 알림 설정은 서로 다른 화면이에요.",
    actions: [
      { href: "/notifications", label: "알림 보기" },
      { href: "/menu/notifications", label: "알림 설정" },
    ],
  },
  notification_settings: {
    title: "알림 설정 도움",
    answer:
      "메뉴의 알림 설정에서 받고 싶은 소식을 선택할 수 있어요. 기기 푸시는 직접 선택한 기기에서 설정해 주세요.\n\n알림이 오지 않으면 이 화면의 기기 설정과 브라우저의 알림 권한을 함께 확인해 주세요. 최근 받은 소식은 알림 화면에서 볼 수 있어요.",
    actions: [
      { href: "/menu/notifications", label: "알림 설정" },
      { href: "/notifications", label: "받은 알림 보기" },
    ],
  },
  account: {
    title: "내 정보 도움",
    answer:
      "메뉴의 내 정보에서 로그인 정보와 기기 로그아웃을 확인할 수 있어요. 공용 기기를 이용했다면 내 정보의 로그아웃 안내를 살펴보세요.\n\n비밀번호나 인증번호는 대화에 적지 마세요. 계정 이용에 문제가 있으면 고객지원에서 안내를 확인해 주세요.",
    actions: [
      { href: "/menu/account", label: "내 정보 보기" },
      { href: "/support", label: "고객지원" },
    ],
  },
  menu: {
    title: "메뉴 화면 도움",
    answer:
      "메뉴에서 내 정보, 받은 알림, 알림 설정과 고객지원으로 이동할 수 있어요. 알림은 받은 소식을 보는 곳이고 알림 설정은 받을 종류를 선택하는 곳이에요.",
    actions: [
      { href: "/menu/account", label: "내 정보 보기" },
      { href: "/menu/notifications", label: "알림 설정" },
      { href: "/support", label: "고객지원" },
    ],
  },
  support: {
    title: "고객지원 찾기",
    answer:
      "고객지원에서 가입, 채굴, 입금과 출금 안내를 확인해 주세요. 문의 내용을 정리할 때는 문제가 생긴 화면과 표시된 오류를 적으면 도움이 돼요.\n\n비밀번호, 인증번호와 전체 계좌번호 같은 민감한 정보는 대화에 적지 마세요.",
    actions: [{ href: "/support", label: "고객지원" }],
  },
  rules: {
    title: "이용 원칙 확인",
    answer:
      "공식 정보와 채굴 규칙에서 공개된 이용 원칙을 확인할 수 있어요. 채굴 결과는 확인된 시간과 적용된 규칙에 따라 기록돼요.\n\n퍼뜩 AI는 설명과 본인 기록 확인을 도와요. 잔액, 승인이나 보상을 직접 바꾸지 않아요. 확인되지 않은 결과나 수익을 보장하지 않아요.",
    actions: [
      { href: "/putduk-facts", label: "공식 정보" },
      { href: "/mining-rules", label: "채굴 규칙" },
    ],
  },
  troubleshooting: {
    title: "화면 이용 문제",
    answer:
      "인터넷 연결을 확인한 뒤 화면의 다시 불러오기를 이용해 주세요. 로그인이 필요하다는 안내가 나오면 로그인 상태를 다시 확인해 주세요.\n\n입금·출금 요청을 보낸 뒤 응답을 받지 못했다면 거래 내역을 먼저 확인해 주세요. 처리 여부를 확인하기 전에 같은 요청을 다시 보내지 않는 것이 좋아요.",
    actions: [
      { href: "/wallet", label: "거래 내역 확인" },
      { href: "/support", label: "고객지원" },
    ],
  },
  ai: {
    title: "퍼뜩 AI 이용 도움",
    answer:
      "퍼뜩 이용 방법과 본인 기록 확인을 도와드려요. 내 잔액, 채굴 상태, 받은 알림처럼 확인할 항목을 구체적으로 물어보세요.\n\n확인할 수 없는 내용은 추측하지 않아요. 잔액 변경이나 입출금 승인은 직접 실행하지 않아요.",
    actions: [
      { href: "/start", label: "START 확인" },
      { href: "/wallet", label: "자산 보기" },
      { href: "/support", label: "고객지원" },
    ],
  },
};

const PAGE_TOPICS: Readonly<Record<string, MemberAiHelpTopic>> = {
  "/home": "home",
  "/start": "start",
  "/mining": "mining",
  "/products": "products",
  "/wallet": "wallet",
  "/wallet/deposit": "deposit",
  "/wallet/withdraw": "withdrawal",
  "/events": "events",
  "/notifications": "notifications",
  "/menu/notifications": "notification_settings",
  "/menu/account": "account",
  "/menu": "menu",
  "/support": "support",
  "/ai": "ai",
  "/menu/ai": "ai",
  "/login": "getting_started",
  "/signup": "getting_started",
  "/offline": "troubleshooting",
};

export function getMemberAiHelp(topic: MemberAiHelpTopic): MemberAiHelp {
  return HELP[topic];
}

export function getMemberAiPageTopic(route?: string): MemberAiHelpTopic {
  return route ? (PAGE_TOPICS[route] ?? "ai") : "ai";
}

export function memberAiHelpFromSourceKey(
  sourceKey: string,
): MemberAiHelpTopic | undefined {
  const prefix = "guide:member_help_";
  if (!sourceKey.startsWith(prefix)) return undefined;
  return memberAiHelpTopicSchema.safeParse(sourceKey.slice(prefix.length)).data;
}

export type MemberAiSuggestion = { label: string; question: string };
const GUIDE_QUESTIONS: Readonly<Record<MemberAiHelpTopic, string>> = {
  getting_started: "퍼뜩은 처음인데 어떻게 시작하나요?",
  home: "홈 화면은 어떻게 이용하나요?",
  start: "PUTDUK START는 어떻게 시작하나요?",
  mining: "채굴 화면은 어떻게 보나요?",
  products: "상품 정보는 어디서 보나요?",
  wallet: "사용 가능 금액과 보류 금액은 무슨 뜻인가요?",
  deposit: "입금은 어떻게 신청하나요?",
  withdrawal: "첫 출금은 어떻게 준비하나요?",
  events: "이벤트 참여 방법 알려줘",
  notifications: "알림 화면은 어떻게 이용하나요?",
  notification_settings: "알림 설정은 어디에 있나요?",
  account: "로그인 정보는 어디서 보나요?",
  menu: "메뉴에서는 무엇을 할 수 있나요?",
  support: "고객지원은 어디에 있나요?",
  rules: "퍼뜩 이용 규칙은 어디서 보나요?",
  troubleshooting: "화면을 불러오지 못하면 어떻게 하나요?",
  ai: "퍼뜩 AI는 어떻게 이용하나요?",
};

export function getMemberAiSuggestions(
  route?: string,
): readonly MemberAiSuggestion[] {
  const topic = getMemberAiPageTopic(route);
  const guide = { label: HELP[topic].title, question: GUIDE_QUESTIONS[topic] };
  const own =
    topic === "mining"
      ? { label: "내 채굴 상태", question: "내 채굴 상태 알려줘" }
      : topic === "start" || topic === "getting_started"
        ? {
            label: "내 START 상태",
            question: "내 PUTDUK START 체험 상태 알려줘",
          }
        : topic === "deposit"
          ? { label: "내 입금 상태", question: "내 입금 상태 알려줘" }
          : topic === "withdrawal"
            ? { label: "내 출금 상태", question: "내 출금 상태 알려줘" }
            : topic === "events"
              ? {
                  label: "내 이벤트 진행",
                  question: "내 이벤트 진행 상태 알려줘",
                }
              : topic === "notifications" || topic === "notification_settings"
                ? { label: "최근 받은 알림", question: "내 최근 알림 알려줘" }
                : { label: "내 지갑 확인", question: "내 지갑 잔액 얼마야?" };
  const next: MemberAiSuggestion =
    topic === "wallet" || topic === "withdrawal" || topic === "start"
      ? { label: "첫 출금 준비", question: GUIDE_QUESTIONS.withdrawal }
      : {
          label: "알림 설정 찾기",
          question: GUIDE_QUESTIONS.notification_settings,
        };
  return [guide, own, next].filter(
    (item, index, list) =>
      list.findIndex((other) => other.question === item.question) === index,
  );
}

/** Intent is advisory public help. Account tools and the safety guard run first. */
export function findMemberAiHelpTopic(
  question: string,
  route?: string,
): MemberAiHelpTopic | undefined {
  const text = question.replace(/\s+/g, " ").trim();
  const exact = MEMBER_AI_HELP_TOPICS.find(
    (topic) => GUIDE_QUESTIONS[topic] === text,
  );
  if (exact) return exact;
  if (
    route &&
    /(이\s*화면|여기서|현재\s*화면).*(어떻게|뭐|무엇|어디|할\s*수)/i.test(text)
  )
    return getMemberAiPageTopic(route);
  if (/알림\s*설정|푸시.*(설정|권한)|알림.*(안\s*와|오지\s*않)/i.test(text))
    return "notification_settings";
  if (
    /(고객\s*지원|고객\s*센터|문의|상담).*(어디|방법|어떻게|화면|이용)/i.test(
      text,
    )
  )
    return "support";
  if (/(처음|가입\s*후|시작).*(이용|어떻게|순서|해야)|온보딩/i.test(text))
    return "getting_started";
  if (
    /(사용\s*가능|예약|보류).*(금액|잔액).*(뜻|차이|의미)|지갑.*(용어|뜻)/i.test(
      text,
    )
  )
    return "wallet";
  if (/(첫\s*출금|환영\s*보상).*(준비|절차|조건)/i.test(text))
    return "withdrawal";
  if (
    /(연결|인터넷|화면|오류).*(안\s*돼|실패|문제|불러오지|끊|안\s*떠)/i.test(
      text,
    )
  )
    return "troubleshooting";
  const navigation = /(어디|방법|어떻게|화면|메뉴|이용|설명|뜻)/i.test(text);
  if (!navigation) return undefined;
  if (/(로그인\s*정보|내\s*정보|로그아웃|계정\s*설정)/i.test(text))
    return "account";
  if (/(putduk\s*start|퍼뜩\s*스타트|스타트|체험)/i.test(text)) return "start";
  if (/상품|제품|카탈로그/i.test(text)) return "products";
  if (/입금|충전/i.test(text)) return "deposit";
  if (/출금/i.test(text)) return "withdrawal";
  if (/이벤트/i.test(text)) return "events";
  if (/알림/i.test(text)) return "notifications";
  if (/지갑|자산/i.test(text)) return "wallet";
  if (/채굴|마이닝/i.test(text)) return "mining";
  if (/홈/i.test(text)) return "home";
  if (/메뉴|더보기/i.test(text)) return "menu";
  if (/규칙|이용\s*원칙|신뢰/i.test(text)) return "rules";
  if (/퍼뜩\s*ai|putduk\s*ai/i.test(text)) return "ai";
  return undefined;
}
