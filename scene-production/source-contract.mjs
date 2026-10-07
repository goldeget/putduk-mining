import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const seedFile = 'supabase/migrations/20260926192208_ws02_commands_and_catalog_seed.sql';
export const read = (file) => readFileSync(new URL(file, new URL('../', import.meta.url)), 'utf8');
export const sha256 = (file) => createHash('sha256').update(readFileSync(root + file)).digest('hex');
// This is a reviewed parser for this exact SQL VALUES shape, not a SQL executor.
// Any changed shape fails closed; future catalogs require a fresh source audit.
export function sourceProducts() {
  const sql = read(seedFile);
  const block = sql.split('insert into public.mining_products (')[1]?.split(') as proposal (')[0];
  if (!block) throw new Error('CATALOG_SOURCE_SHAPE_CHANGED');
  const rows = [...block.matchAll(/\('([0-9a-f-]{36})', '([A-Z]+)', '([A-Z0-9]+)', '([a-z-]+)', '([A-Z_]+)', '([^']+)', '([^']+)', '([^']+)', (\d+), (true|false), (true|false),/g)].map(m => ({
    product_id:m[1],world:m[2],product_code:m[3],slug:m[4],asset_class:m[5],display_name_ko:m[6],display_name_en:m[7],description_ko:m[8],display_order:Number(m[9]),is_featured:m[10]==='true',trial_available:m[11]==='true',source_line:sql.slice(0,m.index + sql.indexOf(block)).split('\n').length
  }));
  const tupleCount = (block.match(/\('30000000-/g) || []).length;
  if (!rows.length || tupleCount !== rows.length) throw new Error('CATALOG_SOURCE_SHAPE_CHANGED');
  return rows;
}
export function sourceFamilies() {
  const block = read('lib/mining-scene/types.ts').split('export const SCENE_FAMILY_KEYS = [')[1]?.split('] as const')[0];
  if (!block) throw new Error('REGISTRY_SOURCE_SHAPE_CHANGED');
  return [...block.matchAll(/"([A-Z_]+)"/g)].map(m=>m[1]);
}
