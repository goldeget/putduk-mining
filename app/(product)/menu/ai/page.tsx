import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PageHeading } from "@/components/product/page-heading";
import { PutdukAiChat } from "@/components/product/putduk-ai-chat";
import { Surface } from "@/components/ui/surface";
import { TRUST_CONTENT_VERSION } from "@/lib/trust/public-content";

const boundaries = [
  "잔액 또는 원장 항목을 직접 변경하지 않습니다.",
  "입금·출금을 승인하지 않습니다.",
  "채굴 결과나 경제 규칙을 결정하지 않습니다.",
  "허용된 사용자·공식 정보만 설명에 사용합니다.",
];

export default function PutdukAiPage() {
  const providerConfigured = Boolean(
    process.env.AI_PROVIDER === "openai" &&
    process.env.AI_API_KEY &&
    process.env.AI_MODEL_LOW_COST,
  );

  return (
    <>
      <PageHeading
        eyebrow="PUTDUK AI"
        title="설명과 분석은 돕고, 결정 권한은 넘지 않습니다."
        lead="AI 제공자와 지식 버전이 운영 승인된 뒤 대화 기능이 활성화됩니다."
      />
      <section className="ai-foundation">
        <Surface as="article" className="ai-foundation__panel" tone="raised">
          <span className="ai-foundation__mark">
            <PutdukIcon name="ai" size={30} />
          </span>
          <p className="eyebrow">
            {providerConfigured
              ? "ROUTED PROVIDER STREAM"
              : "CANONICAL FACT MODE"}
          </p>
          <h2>
            {providerConfigured
              ? "단순한 질문은 가볍게, 분석은 필요한 만큼만."
              : "공식 사실은 제공자 없이도 정확하게."}
          </h2>
          <p>
            {providerConfigured
              ? "정적 규칙과 버전 캐시를 먼저 확인하고, 필요한 질문만 승인된 모델로 실제 스트리밍합니다."
              : "체험, 채굴, 입출금과 AI 권한 경계는 현재 공개 지식에서 답합니다. 추가 분석은 제공자 승인 전 추측하지 않습니다."}
          </p>
        </Surface>
        <Surface as="aside" className="ai-boundaries">
          <p className="eyebrow">NON-NEGOTIABLE</p>
          <ul>
            {boundaries.map((boundary) => (
              <li key={boundary}>{boundary}</li>
            ))}
          </ul>
        </Surface>
      </section>
      <PutdukAiChat
        knowledgeVersion={TRUST_CONTENT_VERSION}
        providerConfigured={providerConfigured}
      />
    </>
  );
}
