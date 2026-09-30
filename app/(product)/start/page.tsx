import { MiningCore } from "@/components/foundation/mining-core";
import { GuidedQuest } from "@/components/product/guided-quest";
import { PageHeading } from "@/components/product/page-heading";
import { RouteReloadButton } from "@/components/product/route-reload-button";
import { StartTrialButton } from "@/components/product/start-trial-button";
import { TrialSynchronizer } from "@/components/product/trial-synchronizer";
import { WelcomeRewardAction } from "@/components/product/welcome-reward-action";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { formatTrialValue } from "@/domain/trial/format-trial-value";
import { requirePageUser } from "@/lib/auth/session";
import {
  formatTrialQuotaPercent,
  formatTrialRemaining,
  presentConversionStatus,
  presentTrialStatus,
} from "@/lib/product/home-start-display";

import styles from "./start.module.css";

export default async function StartPage() {
  const identity = await requirePageUser();
  const [
    { data: trial, error: trialError },
    { data: conversion, error: conversionError },
    { data: lifecycle },
  ] = await Promise.all([
    identity.supabase
      .from("trial_account_snapshots")
      .select(
        "status, world_name_ko, reward_atomic, quota_consumed_bps, remaining_seconds",
      )
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

  const trialStatus = trialError ? "UNAVAILABLE" : (trial?.status ?? "READY");
  const trialPresentation = presentTrialStatus(trialStatus);
  const conversionPresentation = presentConversionStatus(conversion?.status);
  const quotaPercent = formatTrialQuotaPercent(trial?.quota_consumed_bps);
  const isActive = trialStatus === "ACTIVE";
  const isComplete = trialStatus === "COMPLETED" || trialStatus === "EXPIRED";
  const headingTitle = trialError
    ? "START 상태를 확인할 수 없어요."
    : isComplete
      ? "첫 채굴을 마쳤어요."
      : isActive
        ? "첫 채굴이 진행 중이에요."
        : "첫 채굴, 분명한 시작.";
  const headingLead = trialError
    ? "연결을 확인한 뒤 다시 열어 주세요."
    : isComplete
      ? "체험 값은 실제 돈이 아니에요. 자격 확인 후 최대 5,000원까지 전환될 수 있어요."
      : "KOREA 월드에서 첫 채굴을 경험해요. 체험 값은 실제 지갑과 분리됩니다.";

  let commandTitle = "PUTDUK START를 준비하세요";
  let commandLead = "준비가 되면 여기서 첫 채굴을 시작하세요.";
  if (isActive) {
    commandTitle = "채굴이 진행 중이에요";
    commandLead =
      "앱을 닫아도 채굴은 계속돼요. 다시 접속하면 결과를 확인할 수 있어요.";
  } else if (isComplete) {
    commandTitle = "PUTDUK START가 끝났어요";
    commandLead =
      "체험 값과 실제 KRW는 분리돼요. 전환된 환영 보상은 입금 없이 첫 출금할 수 있어요.";
  }

  return (
    <div className={styles.layout}>
      <TrialSynchronizer active={isActive} />
      <GuidedQuest
        serverStage={`${lifecycle?.stage ?? "SIGNED_UP"}:${trialStatus}:${conversion?.status ?? "NONE"}`}
      />
      <PageHeading
        eyebrow="PUTDUK START"
        title={headingTitle}
        lead={headingLead}
      />

      <section className={styles.grid}>
        <Surface
          as="article"
          className={styles.stage}
          data-quest-target="world"
        >
          <div className={styles.stageMeta} data-start-stage-meta>
            <span className={styles.stageMetaLabel}>체험 · KOREA</span>
            <strong className={styles.stageStatus} data-start-status>
              {trialPresentation.label}
            </strong>
          </div>
          <div className={styles.stageVisual}>
            <MiningCore />
          </div>
          <div className={styles.stageFooter} data-quest-target="progress">
            <div className={styles.values}>
              <span>
                <small>무료 체험 사용량</small>
                <strong>
                  {trialError || quotaPercent === null
                    ? "—"
                    : `${quotaPercent.toFixed(0)}%`}
                </strong>
              </span>
              <span>
                <small>체험 결과</small>
                <strong>
                  {trialError
                    ? "확인할 수 없음"
                    : formatTrialValue(String(trial?.reward_atomic ?? "0"))}
                </strong>
              </span>
            </div>
            <div
              className={styles.progress}
              aria-label={
                trialError || quotaPercent === null
                  ? "체험 사용량을 불러오지 못함"
                  : `체험 사용량 ${quotaPercent.toFixed(0)}%`
              }
            >
              <span
                style={{
                  width:
                    trialError || quotaPercent === null
                      ? "0%"
                      : `${quotaPercent}%`,
                }}
              />
            </div>
          </div>
        </Surface>

        <div className={styles.stack}>
          <Surface
            as="article"
            className={styles.commandCard}
            tone="raised"
            data-quest-target="action"
          >
            <p className="eyebrow">다음 행동</p>
            <h2>{commandTitle}</h2>
            <p>{commandLead}</p>
            {trialError ? (
              <StatePanel
                tone="error"
                title="상태를 불러오지 못했어요"
                description="연결을 확인한 뒤 다시 열어 주세요."
                action={
                  <RouteReloadButton className="button button--secondary" />
                }
              />
            ) : isActive && trial ? (
              <dl className={styles.facts}>
                <div>
                  <dt>월드</dt>
                  <dd>{trial.world_name_ko}</dd>
                </div>
                <div>
                  <dt>남은 시간</dt>
                  <dd>{formatTrialRemaining(trial.remaining_seconds)}</dd>
                </div>
              </dl>
            ) : isComplete ? (
              conversionError ? (
                <StatePanel
                  tone="error"
                  title="환영 보상 상태를 확인하지 못했어요"
                  description="잠시 후 다시 확인해 주세요. 중복 전환은 허용되지 않습니다."
                  action={
                    <RouteReloadButton className="button button--secondary" />
                  }
                />
              ) : (
                <WelcomeRewardAction conversion={conversion} />
              )
            ) : (
              <StartTrialButton />
            )}
            {isComplete && conversion?.status ? (
              <p className={styles.actionMessage}>
                {conversionPresentation.description}
              </p>
            ) : null}
          </Surface>

          <Surface
            as="article"
            className={styles.ruleCard}
            data-quest-target="boundary"
          >
            <p className="eyebrow">체험과 실제 잔액</p>
            <ul>
              <li>앱을 닫아도 채굴은 계속돼요</li>
              <li>체험 값과 실제 KRW는 분리돼요</li>
              <li>사용량 100% 또는 24시간에 끝나요</li>
              <li>환영 보상 첫 출금에 입금은 필요 없어요</li>
            </ul>
          </Surface>
        </div>
      </section>
    </div>
  );
}
