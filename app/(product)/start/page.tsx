import { MiningCore } from "@/components/foundation/mining-core";
import { GuidedQuest } from "@/components/product/guided-quest";
import { PageHeading } from "@/components/product/page-heading";
import { StartTrialButton } from "@/components/product/start-trial-button";
import { TrialSynchronizer } from "@/components/product/trial-synchronizer";
import { WelcomeRewardAction } from "@/components/product/welcome-reward-action";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { formatTrialValue } from "@/domain/trial/format-trial-value";
import { requirePageUser } from "@/lib/auth/session";

export default async function StartPage() {
  const identity = await requirePageUser();
  const [
    { data: trial, error: trialError },
    { data: conversion, error: conversionError },
    { data: lifecycle },
  ] = await Promise.all([
    identity.supabase
      .from("trial_account_snapshots")
      .select("*")
      .eq("user_id", identity.userId)
      .maybeSingle(),
    identity.supabase
      .from("trial_reward_conversions")
      .select("id, status, converted_amount_atomic")
      .eq("user_id", identity.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    identity.supabase
      .from("member_lifecycle_states")
      .select("stage")
      .eq("user_id", identity.userId)
      .maybeSingle(),
  ]);

  const quota = trial?.quota_consumed_bps ?? 0;
  const quotaPercent = Math.min(100, Math.max(0, quota / 100));
  const trialStatus = trialError ? "UNAVAILABLE" : (trial?.status ?? "READY");
  const isActive = trialStatus === "ACTIVE";
  const isComplete = trialStatus === "COMPLETED" || trialStatus === "EXPIRED";

  return (
    <>
      <TrialSynchronizer active={isActive} />
      <GuidedQuest
        serverStage={`${lifecycle?.stage ?? "SIGNED_UP"}:${trialStatus}:${conversion?.status ?? "NONE"}`}
      />
      <PageHeading
        eyebrow="PUTDUK START"
        title={
          trialError
            ? "현재 PUTDUK START 상태를 확인할 수 없어요."
            : isComplete
              ? "첫 채굴을 마쳤어요. 이제 가치의 경계를 확인할 차례예요."
              : "첫 결과까지, 한 번의 분명한 시작."
        }
        lead={
          trialError
            ? "연결을 확인하고 다시 열어 주세요. 화면 표시 오류가 체험 기록이나 실제 잔액을 바꾸지는 않습니다."
            : isComplete
              ? "체험 결과는 아직 실제 돈이 아닙니다. 신원·KYC·이상 이용 방지 자격을 통과한 경우에만 최대 5,000원의 실제 KRW 환영 보상으로 전환됩니다."
              : "KOREA 월드에서 최대 24시간 동안 핵심 채굴 흐름을 경험합니다. 체험 값은 실제 지갑과 완전히 분리됩니다."
        }
      />

      <section className="product-feature-grid">
        <Surface
          as="article"
          className="product-mining-stage"
          data-quest-target="world"
        >
          <div className="product-mining-stage__meta">
            <span>TRIAL / KOREA</span>
            <strong>{trialStatus}</strong>
          </div>
          <div className="product-mining-stage__visual">
            <MiningCore />
          </div>
          <div
            className="product-mining-stage__footer"
            data-quest-target="progress"
          >
            <div className="product-mining-stage__values">
              <span>
                <small>무료 체험 사용량</small>
                <strong>
                  {trialError ? "—" : `${quotaPercent.toFixed(0)}%`}
                </strong>
              </span>
              <span>
                <small>체험 결과</small>
                <strong>
                  {trialError
                    ? "확인할 수 없음"
                    : formatTrialValue(trial?.reward_atomic ?? "0")}
                </strong>
              </span>
            </div>
            <div
              className="product-progress"
              aria-label={
                trialError
                  ? "체험 사용량을 불러오지 못함"
                  : `체험 사용량 ${quotaPercent}%`
              }
            >
              <span style={{ width: trialError ? "0%" : `${quotaPercent}%` }} />
            </div>
          </div>
        </Surface>

        <div className="product-stack">
          <Surface
            as="article"
            className="product-command-card"
            tone="raised"
            data-quest-target="action"
          >
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
                  ? "체험 결과와 실제 KRW는 아직 분리되어 있어요. 자격 확인 후 전환된 환영 보상은 사전 입금 없이 첫 출금을 진행할 수 있습니다."
                  : "시작할 수 있는 체험이 준비되면 이곳에서 첫 채굴을 시작할 수 있어요."}
            </p>
            {trialError ? (
              <StatePanel
                tone="error"
                title="상태를 불러오지 못했어요"
                description="연결을 확인한 뒤 페이지를 다시 열어 주세요."
              />
            ) : trial?.status === "ACTIVE" ? (
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
              conversionError ? (
                <StatePanel
                  tone="error"
                  title="환영 보상 상태를 확인하지 못했어요"
                  description="잠시 후 다시 확인해 주세요. 중복 전환은 허용되지 않습니다."
                />
              ) : (
                <WelcomeRewardAction conversion={conversion} />
              )
            ) : (
              <StartTrialButton />
            )}
          </Surface>

          <Surface
            as="article"
            className="product-rule-card"
            data-quest-target="boundary"
          >
            <p className="eyebrow">TRIAL BOUNDARY</p>
            <ul>
              <li>서버 시간만 사용</li>
              <li>체험 값과 실제 KRW 지갑 분리</li>
              <li>사용량 100% 또는 24시간에 종료</li>
              <li>환영 보상 첫 출금에 사전 입금 불필요</li>
            </ul>
          </Surface>
        </div>
      </section>
    </>
  );
}
