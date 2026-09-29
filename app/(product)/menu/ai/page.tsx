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
    description: "잔액·입금·출금 질문은 로그인한 내 기록에서 확인합니다.",
  },
  {
    icon: "shield" as const,
    title: "모르면 추측하지 않기",
    description: "근거가 없으면 숫자를 만들어 답하지 않습니다.",
  },
  {
    icon: "ai" as const,
    title: "설명은 돕고 결정은 대신하지 않기",
    description: "송금·승인·잔액 변경은 PUTDUK AI가 직접 실행하지 않습니다.",
  },
] as const;

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
        lead="채굴·지갑·입출금 궁금한 점을 물어보세요. 확인된 정보만 답합니다."
      />

      <Surface as="section" className={styles.aiIntro} tone="raised">
        <span className={styles.aiIntroIcon} aria-hidden="true">
          <PutdukIcon name="ai" size={30} />
        </span>
        <span>
          <h2>
            {providerConfigured
              ? "내 상태부터 일상 궁금증까지"
              : "내 계정과 퍼뜩 공식 정보부터"}
          </h2>
          <p>
            {providerConfigured
              ? "질문 성격에 맞춰 내 기록과 공식 정보, 안전한 도움말을 확인합니다."
              : "내 계정 기록과 공식 정보는 확인할 수 있어요. 그 밖의 일반 질문은 범위가 제한될 수 있어요."}
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
