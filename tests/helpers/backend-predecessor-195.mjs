import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Historical guard tests use frozen predecessor bytes. Production guards never import this helper.
const HISTORICAL_FILES=Object.freeze({
  "app/api/v1/ai/chat/route.ts": {
    "sha256": "5930e4ae8be9360c41af509e2111b7ddad0bc34a53a8dea7b37055e373a1ee7a",
    "archive": "tests/e2e/fixtures/backend-predecessor-195/5930e4ae8be9360c41af509e2111b7ddad0bc34a53a8dea7b37055e373a1ee7a.source.txt"
  },
  "playwright.backend-http-195.config.ts": {
    "sha256": "d83d50edbbb8237b97c794d708d67f01b2e761bc7f8d3f8d6599163d6c33e2cd",
    "archive": "tests/e2e/fixtures/backend-predecessor-195/d83d50edbbb8237b97c794d708d67f01b2e761bc7f8d3f8d6599163d6c33e2cd.source.txt"
  },
  ".github/workflows/ci.yml": {
    "sha256": "99b4ee8bb2a88c76bef8e46bf6f2af8fd3b4556f3e782a6f94cea898453f017a",
    "archive": "tests/e2e/fixtures/backend-predecessor-195/99b4ee8bb2a88c76bef8e46bf6f2af8fd3b4556f3e782a6f94cea898453f017a.source.txt"
  },
  "scripts/usdt-manual-195-native-fixture.mjs": {
    "sha256": "e01df318a08eba8aef8e90060f1c976a4b495b8dee413bc7922e908a2715ed49",
    "archive": "tests/e2e/fixtures/backend-predecessor-195/e01df318a08eba8aef8e90060f1c976a4b495b8dee413bc7922e908a2715ed49.source.txt"
  },
  "tests/unit/withdrawal-lifecycle-worker.test.ts": {
    "sha256": "b4b79662cd4577ab0b24067893203b54b2b0e77de4d3ca9bf2a3d9e675b61b22",
    "archive": "tests/e2e/fixtures/backend-predecessor-195/b4b79662cd4577ab0b24067893203b54b2b0e77de4d3ca9bf2a3d9e675b61b22.source.txt"
  },
  "tests/unit/ai-chat-audit-persistence-failure.test.ts": {
    "sha256": "74d990b2c6c41368eaf41d1252f8a30d6f08a1b296a57ed9321f819aff116b08",
    "archive": "tests/e2e/fixtures/backend-predecessor-195/74d990b2c6c41368eaf41d1252f8a30d6f08a1b296a57ed9321f819aff116b08.source.txt"
  }
});
export function readPredecessor195TestSource(root,file){
 if(typeof root!=='string'||typeof file!=='string'||file.includes('..')||file.includes('\\')||file.startsWith('/')||file.includes(':'))throw Error('HISTORICAL_TEST_PATH_REJECTED');
 const row=HISTORICAL_FILES[file];
 if(!row)return readFileSync(resolve(root,file));
 const bytes=readFileSync(resolve(root,row.archive));
 if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('HISTORICAL_TEST_SOURCE_CHANGED');
 return bytes;
}

const HISTORICAL_MAPS=Object.freeze([
  {
    "path": "tests/e2e/fixtures/principal-review-r2-ci-source.json",
    "sha256": "338ea5ab29065a5962d40047e3c2e4fd76825fd8ce453ac299b9152d08396bc1"
  },
  {
    "path": "tests/e2e/fixtures/principal-backend-engine-187-source.json",
    "sha256": "1dc13d2b2c71524d37bc1c6bdde4bba4d4f988b707b1959d4597430b621eb9f3"
  },
  {
    "path": "tests/e2e/fixtures/principal-backend-first-188-source.json",
    "sha256": "9c2ea55a0c06f07c3570f25ff80341e6ff67b37623ec497fde3062646882d616"
  },
  {
    "path": "tests/e2e/fixtures/principal-backend-first-191-source.json",
    "sha256": "899bf27e5def9a2c48af491eaa1d2115134f0efbd40581f919c6155e5bb86adb"
  },
  {
    "path": "tests/e2e/fixtures/backend-http-local-193-source.json",
    "sha256": "8957473c3170a41ca19835fc39a73542921dcd71abad4a58261ff7a760bda922"
  },
  {
    "path": "tests/e2e/fixtures/backend-http-195-source.json",
    "sha256": "0d078c0787b5619edfebd800f3f6a5f00848540d97373fac369c87872313b3df"
  }
]);
export function predecessor195TestMigrationVersions(root){
 const migrations=new Map();
 for(const row of HISTORICAL_MAPS){
  const bytes=readFileSync(resolve(root,row.path));
  if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('HISTORICAL_TEST_MANIFEST_CHANGED');
  for(const source of JSON.parse(bytes.toString('utf8')).sources??[]){
   if(source.kind==='migration')migrations.set(source.path,source.sha256);
  }
 }
 const versions=[...migrations.keys()].map(p=>p.match(/^supabase\/migrations\/([0-9]{14})_[^/]+[.]sql$/)?.[1]).sort();
 if(versions.length!==195||versions.some(v=>typeof v!=='string')||new Set(versions).size!==195)throw Error('HISTORICAL_TEST_MIGRATION_INVENTORY_CHANGED');
 return versions;
}

const PREDECESSOR193_FILES=Object.freeze({
  "workers/runner.mjs": {
    "sha256": "4c5153a182955f7a22f1363e410353f4a948b939bb92cbe0269dd3096f6c5f2b",
    "archive": "tests/e2e/fixtures/backend-predecessor-195/4c5153a182955f7a22f1363e410353f4a948b939bb92cbe0269dd3096f6c5f2b.source.txt"
  },
  "lib/ai/usage.ts": {
    "sha256": "fb1b67c8bc8db45161d0709e84d81e09a58659142b33fc0785a806d8c2165408",
    "archive": "tests/e2e/fixtures/backend-predecessor-195/fb1b67c8bc8db45161d0709e84d81e09a58659142b33fc0785a806d8c2165408.source.txt"
  }
});
export function readPredecessor193TestSource(root,file){
 const row=PREDECESSOR193_FILES[file];
 if(!row)return readPredecessor195TestSource(root,file);
 const bytes=readFileSync(resolve(root,row.archive));
 if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('HISTORICAL_193_TEST_SOURCE_CHANGED');
 return bytes;
}
