import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import { PutdukAiChat } from "@/components/product/putduk-ai-chat";
import { Surface } from "@/components/ui/surface";
import { TRUST_CONTENT_VERSION } from "@/lib/trust/public-content";

const promises = [
  {
    icon: "wallet" as const,
    title: "내 계정의 실제 상태",
    description:
      "잔액·입금·출금처럼 개인 정보가 필요한 질문은 로그인한 내 기록에서 확인합니다.",
  },
  {
    icon: "shield" as const,
    title: "모르면 추측하지 않기",
    description:
      "확인할 근거가 없거나 현재 조회할 수 없는 내용은 숫자를 만들어 답하지 않습니다.",
  },
  {
    icon: "ai" as const,
    title: "설명은 돕고 결정은 대신하지 않기",
    description:
      "송금, 승인, 보상 지급이나 잔액 변경은 PUTDUK AI가 직접 실행하지 않습니다.",
  },
];

export default function PutdukAiPage() {
  const providerConfigured = Boolean(
    process.env.AI_PROVIDER === "openai" &&
    process.env.AI_API_KEY &&
    process.env.AI_MODEL_LOW_COST,
  );

  return (
    <div className={styles.aiPage}>
      <PageHeading
        eyebrow="PUTDUK AI"
        title="무엇을 함께 확인할까요?"
        lead="채굴, 자산, 입출금, 이벤트와 퍼뜩 이용 방법을 자연스러운 한국어로 물어보세요. 확인된 정보와 일반 안내를 구분해 답합니다."
      />

      <Surface as="section" className={styles.aiIntro} tone="raised">
        <span className={styles.aiIntroIcon} aria-hidden="true">
          <PutdukIcon name="ai" size={30} />
        </span>
        <span>
          <h2>
            {providerConfigured
              ? "내 상태부터 일상적인 궁금증까지"
              : "내 계정과 퍼뜩 공식 정보부터"}
          </h2>
          <p>
            {providerConfigured
              ? "질문의 성격에 맞춰 내 계정 기록, 퍼뜩 공식 정보, 안전한 일반 도움말을 확인합니다."
              : "내 계정 기록과 퍼뜩 공식 정보는 확인할 수 있어요. 그 밖의 일반 질문은 현재 답변 범위가 제한될 수 있습니다."}
          </p>
        </span>
      </Surface>

      <section className={styles.promiseGrid} aria-label="PUTDUK AI 답변 원칙">
        {promises.map((promise) => (
          <article className={styles.promiseCard} key={promise.title}>
            <PutdukIcon name={promise.icon} size={24} />
            <h3>{promise.title}</h3>
            <p>{promise.description}</p>
          </article>
        ))}
      </section>

      <PutdukAiChat
        knowledgeVersion={TRUST_CONTENT_VERSION}
        providerConfigured={providerConfigured}
      />
    </div>
  );
}
