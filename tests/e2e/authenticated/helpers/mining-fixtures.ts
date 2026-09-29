import { randomUUID } from "node:crypto";

import { execLocalAdminSql } from "./local-db";

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

const WORLD_LIST = WORLD_CODES.map((code) => `'${code}'`).join(", ");

/**
 * 브라우저 채굴 증거용 행은 로컬 데이터베이스 관리 연결로만 넣는다.
 * 운영 마이그레이션, seed, service_role GRANT, test RPC 로는 만들지 않는다.
 *
 * world_rule_versions 와 mining_equipment 는 삭제 트리거가 있다.
 * fixture 행을 지우려고 그 불변 조건을 풀지 않는다.
 * 로컬 정리 경계는 `pnpm db:reset` 이다.
 *
 * 빈 월드 디렉터리는 다섯 월드의 is_active 를 바꿨다가 finally 에서 되돌린다.
 * 프로세스 강제 종료로 finally 가 못 돌면 로컬 데이터베이스에 false 가 남을 수 있다.
 * CI 는 잡 시작 때 로컬 데이터베이스를 reset 하므로 그 상태는 운영으로 나가지 않는다.
 * Authenticated Playwright 는 workers 1, fullyParallel false 를 유지한다.
 */

function requireCount(actual: string, expected: number, label: string) {
  if (Number(actual) !== expected) {
    throw new Error(`${label}:${actual}`);
  }
}

export async function setMiningWorldsActive(active: boolean) {
  const before = execLocalAdminSql(
    `select count(*) from public.asset_worlds where code in (${WORLD_LIST})`,
  );
  requireCount(before, WORLD_CODES.length, "WORLD_VISIBILITY_BASELINE");
  const updated = execLocalAdminSql(
    `with updated as (
      update public.asset_worlds
      set is_active = :'active_flag'::boolean
      where code in (${WORLD_LIST})
      returning code
    )
    select count(*) from updated`,
    { active_flag: active ? "true" : "false" },
  );
  requireCount(updated, WORLD_CODES.length, "WORLD_VISIBILITY_UPDATE");
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
  if (
    !Number.isInteger(input.activeEquipment) ||
    input.activeEquipment < 0 ||
    input.activeEquipment > 20
  ) {
    throw new Error("MINING_FIXTURE_EQUIPMENT_COUNT");
  }
  if (!WORLD_CODES.includes(input.code)) {
    throw new Error("MINING_FIXTURE_WORLD");
  }
  const result = execLocalAdminSql(
    `with world as (
      select id
      from public.asset_worlds
      where code = :'world_code'::public.world_code
    ),
    inserted_rule as (
      insert into public.world_rules (name, world_id)
      select :'rule_name', world.id
      from world
      on conflict (world_id, name) do nothing
      returning id, world_id
    ),
    rule_id as (
      select id, world_id from inserted_rule
      union all
      select existing.id, existing.world_id
      from public.world_rules as existing
      join world on world.id = existing.world_id
      where existing.name = :'rule_name'
        and not exists (select 1 from inserted_rule)
    ),
    inserted_version as (
      insert into public.world_rule_versions (
        world_rule_id,
        version,
        effective_at,
        base_mining_rate_atomic,
        world_multiplier_bps,
        rule_payload
      )
      select
        rule_id.id,
        1,
        :'effective_at'::timestamptz,
        :anchor_atomic,
        10000,
        :'rule_payload'::jsonb
      from rule_id
      on conflict (world_rule_id, version) do nothing
      returning id
    ),
    version_id as (
      select id from inserted_version
      union all
      select existing.id
      from public.world_rule_versions as existing
      join rule_id on rule_id.id = existing.world_rule_id
      where existing.version = 1
        and not exists (select 1 from inserted_version)
    ),
    farm as (
      insert into public.mining_farms (user_id, world_id, status)
      select
        :'user_id'::uuid,
        rule_id.world_id,
        :'status'::public.mining_status
      from rule_id
      returning id, user_id
    ),
    equipment as (
      insert into public.mining_equipment (
        mining_farm_id,
        user_id,
        equipment_code,
        display_name_ko,
        equipped_at
      )
      select
        farm.id,
        farm.user_id,
        'E2E' || gs.n::text,
        '장비',
        :'started_at'::timestamptz
      from farm
      cross join generate_series(1, :equipment_count) as gs(n)
      where :equipment_count > 0
      returning id
    ),
    session as (
      insert into public.mining_sessions (
        mining_farm_id,
        user_id,
        status,
        started_at,
        last_settled_at,
        starting_rule_version_id,
        idempotency_key
      )
      select
        farm.id,
        farm.user_id,
        :'status'::public.mining_status,
        :'started_at'::timestamptz,
        :'last_settled_at'::timestamptz,
        version_id.id,
        :'idempotency_key'
      from farm
      cross join version_id
      returning id
    )
    select
      (select count(*) from world)
        || '|' || (select count(*) from rule_id)
        || '|' || (select count(*) from version_id)
        || '|' || (select count(*) from session)
        || '|' || (select count(*) from equipment)`,
    {
      anchor_atomic: String(FIXTURE_RULE_ANCHOR_ATOMIC),
      effective_at: "2020-01-01T00:00:00.000Z",
      equipment_count: String(input.activeEquipment),
      idempotency_key: `e2e-mining-${randomUUID()}`,
      rule_payload: '{"purpose":"e2e-read-model-anchor"}',
      last_settled_at: input.lastSettledAt,
      rule_name: FIXTURE_RULE_NAME,
      started_at: input.startedAt,
      status: input.status,
      user_id: input.userId,
      world_code: input.code,
    },
  );
  const [worlds, rules, versions, sessions, equipment] = result.split("|");
  requireCount(worlds ?? "", 1, "MINING_FIXTURE_WORLD_MISSING");
  requireCount(rules ?? "", 1, "MINING_FIXTURE_RULE");
  requireCount(versions ?? "", 1, "MINING_FIXTURE_RULE_VERSION");
  requireCount(sessions ?? "", 1, "MINING_FIXTURE_SESSION");
  requireCount(
    equipment ?? "",
    input.activeEquipment,
    "MINING_FIXTURE_EQUIPMENT",
  );
}
