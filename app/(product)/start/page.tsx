import Link from "next/link";

import { MiningCore } from "@/components/foundation/mining-core";
import { PageHeading } from "@/components/product/page-heading";
import { StartTrialButton } from "@/components/product/start-trial-button";
import { TrialSynchronizer } from "@/components/product/trial-synchronizer";
import { Surface } from "@/components/ui/surface";
import { formatAtomicAmount } from "@/domain/wallet/format-amount";
import { requirePageUser } from "@/lib/auth/session";

export default async function StartPage() {
  const identity = await requirePageUser();
  const { data: trial } = await identity.supabase
    .from("trial_account_snapshots")
    .select("*")
    .eq("user_id", identity.userId)
    .maybeSingle();

  const quota = trial?.quota_consumed_bps ?? 0;
  const quotaPercent = Math.min(100, Math.max(0, quota / 100));
  const trialStatus = trial?.status ?? "READY";
  const isActive = trialStatus === "ACTIVE";
  const isComplete = trialStatus === "COMPLETED" || trialStatus === "EXPIRED";

  return (
    <>
      <TrialSynchronizer active={isActive} />
      <PageHeading
        eyebrow="PUTDUK START"
        title="첫 결과까지, 한 번의 분명한 시작."
        lead="KOREA 월드에서 최대 24시간 동안 핵심 채굴 흐름을 경험합니다. 체험 자산은 실제 지갑과 완전히 분리됩니다."
      />

      <section className="product-feature-grid">
        <Surface as="article" className="product-mining-stage">
          <div className="product-mining-stage__meta">
            <span>TRIAL / KOREA</span>
            <strong>{trialStatus}</strong>
          </div>
          <div className="product-mining-stage__visual">
            <MiningCore />
          </div>
          <div className="product-mining-stage__footer">
            <div className="product-mining-stage__values">
              <span>
                <small>무료 체험 사용량</small>
                <strong>{quotaPercent.toFixed(0)}%</strong>
              </span>
              <span>
                <small>체험 결과</small>
                <strong>
                  {formatAtomicAmount(trial?.reward_atomic ?? "0", "KRW")}
                </strong>
              </span>
            </div>
            <div
              className="product-progress"
              aria-label={`체험 사용량 ${quotaPercent}%`}
            >
              <span style={{ width: `${quotaPercent}%` }} />
            </div>
          </div>
        </Surface>

        <div className="product-stack">
          <Surface as="article" className="product-command-card" tone="raised">
            <p className="eyebrow">NEXT ACTION</p>
            <h2>
              {isActive
                ? "서버에서 채굴 시간을 기록하고 있습니다"
                : isComplete
                  ? "PUTDUK START가 완료되었습니다"
                  : "PUTDUK START를 준비하세요"}
            </h2>
            <p>
              {isActive
                ? "앱을 닫아도 서버 시간 기준으로 다음 정산 구간이 이어집니다."
                : isComplete
                  ? "체험 원장은 실제 지갑과 분리되어 있습니다. 실제 채굴 준비는 입금 요청부터 시작합니다."
                  : "운영자가 승인한 체험 규칙이 있을 때만 실제 체험 세션이 생성됩니다."}
            </p>
            {trial?.status === "ACTIVE" ? (
              <dl className="compact-facts">
                <div>
                  <dt>월드</dt>
                  <dd>{trial.world_name_ko}</dd>
                </div>
                <div>
                  <dt>남은 시간</dt>
                  <dd>
                    {trial.remaining_seconds === null
                      ? "정산 대기"
                      : `${Math.ceil(Number(trial.remaining_seconds) / 3600)}시간 이내`}
                  </dd>
                </div>
              </dl>
            ) : isComplete ? (
              <Link
                className="button button--primary product-completion-link"
                href="/wallet/deposit"
              >
                내 채굴 시작하기
              </Link>
            ) : (
              <StartTrialButton />
            )}
          </Surface>

          <Surface as="article" className="product-rule-card">
            <p className="eyebrow">TRIAL BOUNDARY</p>
            <ul>
              <li>서버 시간만 사용</li>
              <li>체험 원장과 실제 원장 분리</li>
              <li>사용량 100% 또는 24시간에 종료</li>
            </ul>
          </Surface>
        </div>
      </section>
    </>
  );
}
