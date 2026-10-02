# PR #39 검증 브랜치 작업 보고문 (GPT 인수인계)

> **작성일:** 2026-10-02 (KST)
> **저장소:** `goldeget/putduk-mining` (authorized only)
> **브랜치:** `review/pr38-cde4b203` · **HEAD:** `503ccb2` (본 보고문) · **마지막 full CI green:** `82dce95` (run 36978447777)
> **PR:** [#39 검증: PR #38 통합 후보 cde4b203](https://github.com/goldeget/putduk-mining/pull/39)

---

## 1. 목적·boundary

| 항목 | 내용 |
| --- | --- |
| **목적** | PR #38 (`integration/product-batch-23-37`) 통합 내용 + 후속 수정을 **한 커밋 줄**에서 CI·E2E로 검증 |
| **검증 PR** | **#39** — base `develop`, head `review/pr38-cde4b203` |
| **PR #38** | **변경하지 않음** — 별도 PR/브랜치로 유지 |
| **develop merge** | **MERGE NOT AUTHORIZED** — 사용자 명시 승인 전 금지 |
| **deploy / remote Supabase / Cloudflare / DNS** | 이 작업 범위 **아님** |
| **develop 직접 merge 이력** | 본 검증 브랜치 작업 중 **develop에 merge하지 않음** |

**로컬 truth:** worktree

`C:\Users\PC\Desktop\putduk-mining\.worktrees\pr38-followup-20261001`

(로컬 브랜치명 `local/pr38-followup-20261001` = remote `review/pr38-cde4b203`)

**루트 워크스페이스:** `develop` 체크아웃 + `stash@{0}: agent: root drift off develop (E2E local)` — merge 전까지 검증 브랜치와 **동기화하지 않음**.

---

## 2. 타임라인 (커밋)

`origin/develop..HEAD` 기준 **113커밋**. 아래는 GPT가 이어받기 위해 **역할별**로 나눈 표이다.

### 2-A. 제품 통합 묶음 (PR #23–#37 merge 커밋)

| SHA (short) | 요약 |
| --- | --- |
| `679ae05` | Merge PR #23 ai-product |
| `5675ad5` | Merge PR #24 notifications-product |
| `fadd21b` | Merge PR #25 admin-restrictions-product |
| `4886923` | Merge PR #26 admin-deposits-product |
| `8beb88d` | Merge PR #27 withdrawal-product |
| `b6b4937` | Merge PR #28 admin-withdrawals-product |
| `32cb488` | Merge PR #29 admin-today-product |
| `6a50f6a` | Merge PR #30 wallet-product |
| `45080ad` | Merge PR #31 events-product |
| `9502088` | Merge PR #32 menu-product |
| `2a99341` | Merge PR #33 admin-members-product |
| `3150659` | Merge PR #34 home-start-product |
| `223e24b` | Merge PR #35 admin-kyc-product |
| `9818f7e` | Merge PR #36 support-product |
| `2d537b9` | Merge PR #37 admin-exceptions-product (conflict resolution 포함) |

*(그 이전·사이의 lane 커밋은 동일 diff에 이미 포함됨 — 전체 목록: `git log origin/develop..HEAD --oneline`)*

### 2-B. 통합 후 안정화·보안·UI (develop 대비 HEAD까지 — 발췌)

| SHA | 요약 |
| --- | --- |
| `e965da5`–`d935dfe` | UI 테마·레이아웃·오류 복구 통합 |
| `d70d741`–`2af28e0` | 출금 목적지 재인증·MFA·증거 redaction |
| `c86db57` | KYC: 서류 조회 실패 시 심사 RPC 차단 |
| `0ad472a` | E2E: 체험 만료·송금 기록 조회 검증 완화 |
| `2679b35` / `31ea621` | DB: service_role 기본 권한 최소화 |
| `f310a5f` | docs: E2E 에이전트 triage·npm 스크립트 |
| `b62b674` | E2E: 테스트 회원 토큰·USDT 접수 재현성 |
| `97bb84d` | DB: 대사 잠금 로컬 DB 이름 |
| `cde4b20` | test: 워커 픽스처 시각 ≤ DB 시계 |

### 2-C. PR #39 CI/E2E 검증 체인 (최근 — **우선 숙지**)

| SHA | 요약 |
| --- | --- |
| `f4dc835` | **UI/typography:** 200% 글자에서 한글 단어 중간 줄바꿈 방지 |
| `17348d4` | **timeout 75/90:** job `90`분, authenticated step `75`분 (186 tests가 60분 step에서 끊김 방지) |
| `048e882` | 공개 타이포 gate 기대값 **75건**으로 잠금 |
| `5ba9605` | CI: authenticated **4-way shard** (1차 병렬화) |
| `f9fe050` | CI: **8-way shard** + Playwright browser cache |
| `ad0d147` | **`pnpm exec playwright` shard 전달** + 알림 시드 `read_at >= created_at` CHECK |
| `2f349c9` | cache **v5**, Playwright **`reporter: line` only** |
| `9cfc2ef` | CI only `reportSlowTests` **spread** (`exactOptionalPropertyTypes`) |
| `6b209b4` | docs: WS-05 closure·CI evidence |
| `82dce95` | docs: WS-05-CLOSURE trailing whitespace |

---

## 3. CI evidence chain

| run ID | HEAD (short) | conclusion | wall (approx) | 비고 |
| --- | --- | --- | --- | --- |
| [36957624095](https://github.com/goldeget/putduk-mining/actions/runs/36957624095) | `cde4b20` | **failure** | ~64m | PR39 초기 검증 실패 |
| [36963225127](https://github.com/goldeget/putduk-mining/actions/runs/36963225127) | `048e882` | **success** | ~67m | 단일 authenticated job baseline |
| [36968866402](https://github.com/goldeget/putduk-mining/actions/runs/36968866402) | `5ba9605` | **failure** | ~48m | 4-shard 도입 직후 실패 |
| [36973023878](https://github.com/goldeget/putduk-mining/actions/runs/36973023878) | `ad0d147` | **success** | **~16m** | **8-shard**, 16/16 job success |
| [36975011504](https://github.com/goldeget/putduk-mining/actions/runs/36975011504) | `2f349c9` | **cancelled** | ~7m | merge queue 우선 취소 + Application gates TS (`reportSlowTests`) |
| [36975512027](https://github.com/goldeget/putduk-mining/actions/runs/36975512027) | `9cfc2ef` | **success** | **~16m** | 코드 green; check-run **annotation 0** |
| **[36978447777](https://github.com/goldeget/putduk-mining/actions/runs/36978447777)** | **`82dce95`** | **success** | **~16m** | **최종 green** (docs HEAD 포함), 16/16 |

**Authenticated suite:** 186 tests (chromium + mobile-chrome) = 로컬 `pnpm test:e2e:auth:full` 합과 동일.

---

## 4. 기술 변경 요약

### 4.1 UI / typography / foundation

- `f4dc835`: 접근성 200% 텍스트 — 한글 `word-break`/`overflow-wrap` 정리.
- `048e882`: Korean typography public gates — 통과 기대 **75**건 CI 잠금.
- `cde4b20`, `b62b674`, `97bb84d`: foundation/E2E 재현성 (시계·토큰·DB 이름).

### 4.2 CI: 8-shard · Playwright exec · `--` 버그

- Matrix: `Authenticated product gates (1/8)` … `(8/8)`.
- **올바른 실행:**

```bash
pnpm exec playwright test --config playwright.authenticated.config.ts --shard=i/8
```

- **피할 패턴:** `pnpm run test:e2e:authenticated -- --shard=i/8` — CI에서 shard가 **무시**될 수 있음 (`ad0d147`).
- `f9fe050`: 8-shard + `actions/cache@v5` (`~/.cache/ms-playwright`).

### 4.3 notifications fixture (read_at CHECK)

- `tests/e2e/authenticated/helpers/notification-fixtures.ts`: 시드 시 `read_at < created_at` 이면 `read_at = createdAt`으로 보정 — DB CHECK 위반 방지.
- `notifications-product.spec.ts`: 동일 PR에서 CI shard/스펙 정렬 (`ad0d147`).

### 4.4 timeout 75 / 90

- `17348d4`: workflow job `timeout-minutes: 90`, authenticated step `timeout-minutes: 75` (186 tests, 181번째에서 60분 step timeout 발생 이력).

### 4.5 cache v5 · reporter line-only · reportSlowTests (`9cfc2ef`)

- `2f349c9`: `actions/cache@v5`, authenticated config **`reporter: "line"`** only (github reporter annotation 노이즈 제거).
- `9cfc2ef`: CI에서만 `{ reportSlowTests: { max: 5, threshold: 480_000 } }` spread — `exactOptionalPropertyTypes` TS 통과.
- run **36975512027**, **36978447777**: required checks success + **annotation 0건**.

### 4.6 문서 (요약)

| 문서 | 핵심 |
| --- | --- |
| `docs/development/E2E-AGENT-WORKFLOW.md` | triage → 좁은 재실행 → merge 직전 full 1회; `auth:file`/`grep`은 `--` 필수; hung 10분 규칙 |
| `docs/quality/WS-05-CLOSURE.md` | PR #39 범위, 8-shard green evidence, 16 required check 이름, **MERGE NOT AUTHORIZED** |
| `.cursor/rules/putduk-e2e-agent-verification.mdc` | 에이전트 필수 순서·금지 (full 반복, reset 직후 full 등) |

---

## 5. Branch protection (develop · 16 checks)

GitHub `develop` 브랜치 protection에 **아래 16개 status check 이름** 등록 (작업 추적 ref: **`a9b6f2e0`** — GitHub 설정 변경, repo 커밋 SHA 아님).

**구 단일 job `Authenticated product gates`는 제거** — shard 8개로 대체.

### Required check 이름 (16개 — 전체)

1. Exact diff integrity
2. Application gates
3. Worker runtime gates
4. WebServer lifecycle probe
5. Korean typography public gates
6. Browser foundation
7. Database security gates
8. Korean typography protected gates
9. Authenticated product gates (1/8)
10. Authenticated product gates (2/8)
11. Authenticated product gates (3/8)
12. Authenticated product gates (4/8)
13. Authenticated product gates (5/8)
14. Authenticated product gates (6/8)
15. Authenticated product gates (7/8)
16. Authenticated product gates (8/8)

---

## 6. PR #39 상태 (2026-10-02)

| 필드 | 값 |
| --- | --- |
| URL | https://github.com/goldeget/putduk-mining/pull/39 |
| state | **OPEN** (Draft 아님 — Ready for review) |
| mergeable | **MERGEABLE** |
| head | `503ccb2` @ `review/pr38-cde4b203` (docs-only 추가) |
| checks | run **36978447777** @ `82dce95` 기준 **16/16 SUCCESS** (HEAD `503ccb2` CI는 push 후 재실행 대기) |

---

## 7. 로컬 환경

| 위치 | 상태 |
| --- | --- |
| Worktree | `C:\Users\PC\Desktop\putduk-mining\.worktrees\pr38-followup-20261001` |
| Remote tracking | `origin/review/pr38-cde4b203` @ `503ccb2` |
| Root repo | `C:\Users\PC\Desktop\putduk-mining`, branch `develop` |
| Stash | `stash@{0}: On develop: agent: root drift off develop (E2E local)` |
| Root untracked (동기화 전) | `.cursor/rules/putduk-e2e-agent-verification.mdc`, 일부 `docs/` (worktree에 커밋된 버전이 truth) |

**E2E 좁은 재실행 예:**

```powershell
pnpm test:e2e:auth:file -- tests/e2e/authenticated/notifications-product.spec.ts
pnpm test:e2e:auth:last-failed
```

---

## 8. 미완료·다음 단계

- [ ] **사용자 승인:** PR #39 → `develop` merge (에이전트 단독 push/merge **금지**)
- [ ] **PR #38** (`integration/product-batch-23-37`) — 별도 정책·리뷰 (본 검증과 head 변경 혼동 금지)
- [ ] merge 후: develop에서 동일 16 check green 재확인, 필요 시 `pnpm test:e2e:auth:full` 로컬 1회 (WS-05)
- [ ] 원격 Supabase migration apply / Cloudflare / production deploy — **별도 승인 단계**
- [ ] `apps/admin/tests/kyc-review-evidence-action.test.ts` — **본 검증 브랜치에 커밋하지 않음** (PR #39 본문 명시)

---

## 9. Handoff for GPT (새 세션에서 이어서 할 일)

1. **승인 경계 확인:** `develop` merge·PR #38 head 변경·deploy 없이, 사용자 지시만 따른다 (`AGENTS.md`, `WS-05-CLOSURE.md`).
2. **CI 회귀 시:** run ID·HEAD·실패 job 이름 triage → `pnpm test:e2e:auth:file` / `auth:last-failed` only — **동일 SHA full 3회 금지**.
3. **Authenticated CI 디버그:** shard는 반드시 `pnpm exec playwright … --shard=i/8`; workflow `ci.yml`과 `playwright.authenticated.config.ts`의 reporter/cache 설정 유지.
4. **Branch protection:** develop에 위 **16개 이름**이 빠지면 merge blocked — 구 `Authenticated product gates` 단일 이름 추가하지 않는다.
5. **merge 승인 후:** PR #39 squash/merge 정책 확인 → develop checkout → optional local full E2E → PR #38과 integration 브랜치 정리는 **사용자와 합의**.

---

## 부록: authorized targets (immutable)

- Repo: `https://github.com/goldeget/putduk-mining.git`
- Supabase project ref: `osrmyjgmpdspdcwqjwuv` (로컬 dev only; remote apply 금지 unless approved)

**END OF REPORT**
