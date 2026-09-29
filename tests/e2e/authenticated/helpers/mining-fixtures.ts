import { randomUUID } from "node:crypto";

import { createLocalServiceRoleClient } from "../../fixtures/local-auth";

const WORLD_CODES = ["KOREA", "USA", "GOLD", "SILVER", "CRYPTO"] as const;

export type MiningWorldCode = (typeof WORLD_CODES)[number];

export type MiningReadStatus =
  "NORMAL" | "REDUCED" | "MAINTENANCE" | "PARTIAL_STOP" | "STOPPED";

const FIXTURE_RULE_NAME = "E2E_MINING_READ_FIXTURE";

/**
 * world_rule_versions.base_mining_rate_atomic 는 0보다 커야 한다.
 * 이 1은 세션 외래 키를 위한 로컬 앵커다.
 * 화면은 이 값을 읽지 않고, 운영 채굴 단가로 쓰지 않는다.
 */
const FIXTURE_RULE_ANCHOR_ATOMIC = 1;

async function worldId(code: MiningWorldCode) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client
    .from("asset_worlds")
    .select("id")
    .eq("code", code)
    .maybeSingle();
  if (error || !data?.id) {
    throw new Error(`ASSET_WORLD_MISSING:${code}:${error?.message ?? "none"}`);
  }
  return data.id as string;
}

async function ensureFixtureRuleVersion(world: string) {
  const client = createLocalServiceRoleClient();
  const { data: existingRule, error: ruleReadError } = await client
    .from("world_rules")
    .select("id")
    .eq("world_id", world)
    .eq("name", FIXTURE_RULE_NAME)
    .maybeSingle();
  if (ruleReadError) {
    throw new Error(ruleReadError.message);
  }

  let ruleId = existingRule?.id as string | undefined;
  if (!ruleId) {
    const { data, error } = await client
      .from("world_rules")
      .insert({ name: FIXTURE_RULE_NAME, world_id: world })
      .select("id")
      .single();
    if (error || !data?.id) {
      throw new Error(error?.message ?? "MINING_FIXTURE_RULE_INSERT_FAILED");
    }
    ruleId = data.id;
  }

  const { data: existingVersion, error: versionReadError } = await client
    .from("world_rule_versions")
    .select("id")
    .eq("world_rule_id", ruleId)
    .eq("version", 1)
    .maybeSingle();
  if (versionReadError) {
    throw new Error(versionReadError.message);
  }
  if (existingVersion?.id) {
    return existingVersion.id as string;
  }

  const { data: version, error: versionError } = await client
    .from("world_rule_versions")
    .insert({
      base_mining_rate_atomic: FIXTURE_RULE_ANCHOR_ATOMIC,
      effective_at: "2020-01-01T00:00:00.000Z",
      rule_payload: { purpose: "e2e-read-model-anchor" },
      version: 1,
      world_multiplier_bps: 10000,
      world_rule_id: ruleId,
    })
    .select("id")
    .single();
  if (versionError || !version?.id) {
    throw new Error(
      versionError?.message ?? "MINING_FIXTURE_RULE_VERSION_INSERT_FAILED",
    );
  }
  return version.id as string;
}

export async function setMiningWorldsActive(active: boolean) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client
    .from("asset_worlds")
    .update({ is_active: active })
    .in("code", [...WORLD_CODES])
    .select("code");
  if (error) {
    throw new Error(error.message);
  }
  if ((data?.length ?? 0) !== WORLD_CODES.length) {
    throw new Error(`WORLD_VISIBILITY_UPDATE:${data?.length ?? 0}`);
  }
}

/**
 * 브라우저가 읽을 세션 행만 넣는다.
 * record_mining_settlement 는 호출하지 않는다.
 */
export async function seedMiningReadSession(input: {
  activeEquipment: number;
  code: MiningWorldCode;
  lastSettledAt: string;
  startedAt: string;
  status: MiningReadStatus;
  userId: string;
}) {
  const client = createLocalServiceRoleClient();
  const resolvedWorldId = await worldId(input.code);
  const ruleVersionId = await ensureFixtureRuleVersion(resolvedWorldId);
  const { data: farm, error: farmError } = await client
    .from("mining_farms")
    .insert({
      status: input.status,
      user_id: input.userId,
      world_id: resolvedWorldId,
    })
    .select("id")
    .single();
  if (farmError || !farm?.id) {
    throw new Error(farmError?.message ?? "MINING_FARM_INSERT_FAILED");
  }

  if (input.activeEquipment > 0) {
    const { error: equipmentError } = await client
      .from("mining_equipment")
      .insert(
        Array.from({ length: input.activeEquipment }, (_, index) => ({
          display_name_ko: "장비",
          equipped_at: input.startedAt,
          equipment_code: `E2E${index + 1}`,
          mining_farm_id: farm.id,
          user_id: input.userId,
        })),
      );
    if (equipmentError) {
      throw new Error(equipmentError.message);
    }
  }

  const { error: sessionError } = await client.from("mining_sessions").insert({
    idempotency_key: `e2e-mining-${randomUUID()}`,
    last_settled_at: input.lastSettledAt,
    mining_farm_id: farm.id,
    started_at: input.startedAt,
    starting_rule_version_id: ruleVersionId,
    status: input.status,
    user_id: input.userId,
  });
  if (sessionError) {
    throw new Error(sessionError.message);
  }
}
