# GPT 감사관 첨부 체크리스트

**감사 ID:** `audit-2026-10-10-164902`  
**대상:** ChatGPT 등 Cursor 맥락 없는 외부 GPT 감사관  
**정본 핸드오프:** [`GPT_HANDOFF_COMPLETE_REPORT_2026-10-10.md`](./GPT_HANDOFF_COMPLETE_REPORT_2026-10-10.md) §12  
**백업 경로 정본:** [`08_COMMIT_AND_BACKUP_RECEIPT.md`](./08_COMMIT_AND_BACKUP_RECEIPT.md)

> 비밀 값·`.env`·자격 증명은 **절대 첨부하지 않는다.** launch ready / PRODUCT COMPLETE 주장 기대하지 않는다.

---

## A. 필수 1개 — GPT 핸드오프 통합 보고서

| 항목 | 경로 | 전달 방식 |
| --- | --- | --- |
| **GPT_HANDOFF_COMPLETE_REPORT** | `docs/audit/local-preservation-2026-10-10/GPT_HANDOFF_COMPLETE_REPORT_2026-10-10.md` | **전체 붙여넣기(권장)** 또는 단일 `.md` 파일 첨부 |
| F: 사본(동일 내용) | `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\` 내 GPT report 사본(§12.3) | 로컬 백업용; GPT에는 repo 경로 또는 붙여넣기 우선 |

**이유:** Executive summary, Cloud A/B, worktree·분류·통합 후보·§13 승인 게이트·읽기 순서가 모두 포함된 **자급자족 진입점**이다.

---

## B. Repo 감사 문서 (`docs/audit/local-preservation-2026-10-10/`)

§12.1 산출물 — 각 파일 한 줄 목적.

| 파일 | 한 줄 목적 |
| --- | --- |
| `00_STORAGE_LAYOUT_AND_DRIVE_VERIFICATION.md` | C/D/F 드라이브·여유 공간·저장 정책 실측 검증 |
| `01_LOCAL_WORKTREE_AND_GIT_INVENTORY.md` | Git·84 worktree 상세 인벤토리 |
| `01_WORKTREE_INVENTORY_SUMMARY.md` | worktree 84건 요약 표 |
| `01_ORPHAN_WORKTREES.md` | prunable·경로 없음 등 orphan 약 10건 (prune deferred) |
| `01_PHASE1_FIRST_REPORT.md` | Phase 1 1차 보고 |
| `02_ALL_UNCOMMITTED_FILES.csv` | 미커밋 266행 raw inventory |
| `03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv` | 266행 분류 정본 (COMMIT / REVIEW / NEVER / PRESERVE) |
| `03_CLASSIFICATION_DELTA.md` | NEVER 5→2 등 분류 수정 delta |
| `04_LOCAL_ONLY_COMMITS_AND_RECOVERY_ASSETS.md` | origin 미반영 66 commits·stash·recovery 자산 |
| `04_UNPUSHED_BRANCHES.csv` | upstream 없음·미 push 브랜치 78행 |
| `05_CLOUD_TO_LOCAL_FUNCTIONAL_FIDELITY.md` | Cloud↔로컬 stub; 267f9da re-hunt deferred |
| `06_CURRENT_PLATFORM_FEATURE_STATUS.md` | 기능 상태 스텁 → RELEASE-READINESS-MATRIX |
| `07_SAFE_INTEGRATION_CANDIDATE.md` | 1차 통합 후보 PR #72 @ `1490cb7` 권장 |
| `08_COMMIT_AND_BACKUP_RECEIPT.md` | Phase 0 D/F 백업·해시·영수증 |
| `11_RELEASE_BLOCKERS_AND_PRODUCTION_GAPS.md` | 릴리스·prod·UX 블로커 요약 |
| `12_FINAL_PLATFORM_REALITY_REPORT.md` | 플랫폼 현실 통합 placeholder |
| `13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md` | PROPOSED R4/FINAL 대비 UX·dedupe·P0/P1 갭 |
| `14_PHASE2_DECISION_PACKAGE.md` | 커밋 wave·push 옵션·§6 사용자 승인 게이트 |
| `STORAGE-POLICY.md` | C/D/F 역할·대용량 C: 금지 정책 |
| `_scripts/classify-uncommitted.mjs` | 미커밋 분류기 (Node, UTF-8) |
| `_scripts/collect-worktree-inventory.ps1` | D: `exports/` worktree 인벤토리 생성 |
| `GPT_HANDOFF_COMPLETE_REPORT_2026-10-10.md` | **본 체크리스트와 동일 패키지의 통합 GPT 핸드오프 (§A 필수)** |

**전달 팁:** 개별 md/csv를 모두 붙이기 어렵으면 **§F `audit-reports-bundle` ZIP 1개**로 §B 대부분을 대체할 수 있다 (핸드오프 §A는 별도).

---

## C. `F:\PUTDUK-MINING-QA\` — bundle·해시·design-review·stash·mirror (전체 경로)

### C.1 감사 루트 `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\`

| 전체 경로 | 내용 |
| --- | --- |
| `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\mirror\putduk-mining-all.bundle` | D: primary와 동일 git bundle (~344MB); `git bundle verify` okay |
| `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\hashes\putduk-mining-all.bundle.sha256.csv` | bundle SHA256 `BA269DC…CCD2FA` |
| `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\hashes\audit-reports-bundle.sha256.txt` | 감사 보고서 ZIP 해시 기록 |
| `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\audit-reports-bundle-20261010.zip` | repo 감사 md/csv 묶음; SHA256 `66696E09…AAB79E` |
| `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\STORAGE-POLICY-POINTER.txt` | repo `STORAGE-POLICY.md` 포인터 |
| `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\large-assets\10월4일 퍼뜩목업사진.zip` | 목업 ZIP 미러 (PRESERVE_OUTSIDE_GIT) |
| `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\large-assets\퍼뜩채굴 모바일 목업사진.zip` | 모바일 목업 ZIP 미러 |
| `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports\stash-0.patch` | `stash@{0}` 패치 export (~62KB) |
| `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports\stash-0.metadata.txt` | stash 메타 |
| `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports\04_UNPUSHED_BRANCHES.csv` | 78행 브랜치 목록 (repo 동일 내용 미러) |

**GPT 전달:** 위 항목 중 **감사관이 git history 복구를 요청할 때만** bundle 경로·해시를 **텍스트로 알려 준다.** bundle 파일 자체 첨부는 **§E·§F** 참고.

### C.2 D: primary (F: mirror와 쌍) — `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\`

| 전체 경로 | 내용 |
| --- | --- |
| `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\putduk-mining-all.bundle` | primary git bundle (313 refs) |
| `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\hashes\putduk-mining-all.bundle.sha256.csv` | bundle 해시 |
| `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports\` | git-status, diff, `worktree-inventory.csv`, `all-uncommitted-files-raw.csv`, `local-only-commits.txt` 등 |
| `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\desktop-repo\` | desktop HEAD·status·diff·일부 미커밋 복사본 |
| `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\ci-worktree-1490cb7\` | PR #72 clean worktree 스냅샷 |
| `D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\recovery-branches-export\` | recovery 4브랜치 tip 요약 |

**GPT 전달:** D: export CSV·patch는 **용량 허용 시** `audit-reports-bundle`에 포함 여부 확인 후 첨부; 대용량 bundle은 **로컬 보관** 위주.

### C.3 design-review `F:\PUTDUK-MINING-QA\design-review-2026-10-10\`

| 전체 경로 | 내용 |
| --- | --- |
| `F:\PUTDUK-MINING-QA\design-review-2026-10-10\source-zips\PUTDUK_R4_FOLLOWUP_24_PROPOSED.zip` | R4 24화면 PROPOSED 원본 zip |
| `F:\PUTDUK-MINING-QA\design-review-2026-10-10\source-zips\PUTDUK_FINAL_DESIGN_PROPOSED.zip` | FINAL scene/animation PROPOSED zip |
| `F:\PUTDUK-MINING-QA\design-review-2026-10-10\source-zips\PUTDUK_R4_RESTORED_REVIEW.zip` | RESTORED 40화면 review zip |
| `F:\PUTDUK-MINING-QA\design-review-2026-10-10\manifest\sha256-manifest.csv` | 추출물 579파일 해시 매니페스트 |
| `F:\PUTDUK-MINING-QA\design-review-2026-10-10\manifest\dedupe-canonical-table.csv` | dedupe 52 logical keys |

**GPT 전달:** UX 감사 시 **`13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md` + manifest CSV** 우선; PROPOSED zip 전체는 **용량·승인 전 truth 아님** 명시 후 선택 첨부.

---

## D. Downloads design inputs (사용자가 참조한 5개 파일명)

사용자 Downloads 기준 design-review 입력 ([`13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md`](./13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md)):

1. `PUTDUK_R4_FOLLOWUP_24_PROPOSED.zip`
2. `PUTDUK_FINAL_DESIGN_PROPOSED.zip`
3. `PUTDUK_R4_RESTORED_REVIEW.zip`
4. `PUTDUK_R4_FOLLOWUP_REVIEW.html`
5. `PUTDUK_MINIMAL_CHANGES.html`

**GPT 전달:** 파일명·역할만 설명하고, 실물은 F: `design-review-2026-10-10\source-zips\` 및 doc 13 표와 대응시킨다. **production truth 아님.**

---

## E. 첨부 비권장 / 금지

| 항목 | 이유 |
| --- | --- |
| `.env`, `.env.local`, Supabase/Cloudflare/GitHub **토큰·키** | 비밀 유출 |
| `credentials.json`, service role key, TOTP seed | 보안 |
| **`putduk-mining-all.bundle` (~344MB)** | GPT 업로드 한도·불필요; 필요 시 **해시·경로만** 텍스트로 전달 ([§C](#c-fputduk-mining-qa--bundle해시design-reviewstashmirror-전체-경로)) |
| `node_modules/`, `.next/`, `apps/admin/.next/` | 대용량·재현 불필요 |
| Desktop 루트 목업 ZIP 원본 (C:) | Git 제외 자산; F: `large-assets` 미러로 충분 |
| PROPOSED PNG/HTML을 **승인된 production spec**처럼 서술 | doc 13 자동 적용 금지 목록 준수 |
| `git push` / merge / prune **실행 결과를 요청하지 않은** 원격 조작 로그에 비밀 포함분 | — |

---

## F. ZIP 전략

| 아티팩트 | 전체 경로 | 첨부 vs 붙여넣기 |
| --- | --- | --- |
| **핸드오프 통합 보고서** | `docs/audit/local-preservation-2026-10-10/GPT_HANDOFF_COMPLETE_REPORT_2026-10-10.md` | **항상:** 전문 **붙여넣기** 또는 `.md` 1파일 첨부 (**§A 필수**) |
| **감사 보고서 번들** | `F:\PUTDUK-MINING-QA\audit-2026-10-10-164902\audit-reports-bundle-20261010.zip` | **권장:** GPT가 ZIP 업로드를 받으면 **§B repo 감사 문서 대체용으로 1회 첨부** (해시 `66696E09…AAB79E`) |
| **git bundle** | `F:\...\mirror\putduk-mining-all.bundle` / `D:\...\putduk-mining-all.bundle` | **기본 금지 첨부**; 감사관이 명시적으로 요청하고 업로드 한도가 있을 때만 |
| **design-review zips** | `F:\PUTDUK-MINING-QA\design-review-2026-10-10\source-zips\*.zip` | UX deep dive 시 **선택**; 평소는 doc `13` + manifest CSV |

### 권장 조합 (3단계)

1. **최소:** §A 핸드오프 **전문 붙여넣기**만 → 통합·승인 게이트·다음 단계 질의용.
2. **표준:** §A + `audit-reports-bundle-20261010.zip` **1개 첨부** → §B 전체에 상당.
3. **확장 (UX):** 표준 + `13_UI_UX_ANIMATION_GAP_VS_PROPOSED_R4.md` 강조 + (선택) `sha256-manifest.csv` / design zip.

**344MB bundle:** GPT 채팅에는 **첨부하지 않는다.** 로컬·F:/D: 보관 및 SHA256만 공유.

---

## 빠른 체크 (발송 전)

- [ ] §A `GPT_HANDOFF_COMPLETE_REPORT` 전문 또는 파일 1개
- [ ] 비밀·`.env` 미포함 확인
- [ ] (선택) `audit-reports-bundle-20261010.zip` 첨부
- [ ] bundle 344MB **미첨부** (경로·해시만 필요 시 기재)
- [ ] PROPOSED = 승인 전 참고용임을 한 줄 면책 포함

---

*Generated 2026-10-10 — companion to GPT handoff §12.*
