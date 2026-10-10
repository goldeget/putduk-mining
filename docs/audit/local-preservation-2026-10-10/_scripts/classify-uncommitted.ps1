# Windows PowerShell 5.x: UTF-8 BOM 없으면 한글 문자열 파싱 오류 가능. 재실행은 classify-uncommitted.mjs 사용.
$ErrorActionPreference = 'Stop'
$rawPath = 'D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports\all-uncommitted-files-raw.csv'
$outPath = 'C:\Users\PC\Desktop\putduk-mining\docs\audit\local-preservation-2026-10-10\03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv'
$copyPath = 'C:\Users\PC\Desktop\putduk-mining\docs\audit\local-preservation-2026-10-10\02_ALL_UNCOMMITTED_FILES.csv'

function Test-TrackedTestAsset {
    param([string]$Rel)
    $testTree = $Rel -match '/tests/'
    $testFile = $Rel -match '\.(test|spec)\.(ts|tsx|js|mjs)$' -or $Rel -match '/supabase/tests/.+\.sql$'
    return $testTree -and $testFile
}

function Get-Category {
    param(
        [string]$Path,
        [string]$Status
    )
    $name = [System.IO.Path]::GetFileName($Path).ToLowerInvariant()
    $rel = ($Path -replace '\\', '/')

    if ($name -match '^\.env' -or $name -eq '.env.local' -or $rel -match '/\.env(/|$)') {
        return @('NEVER_COMMIT', '환경·비밀 변수 파일 패턴', 'D: 또는 F: 보존, .gitignore 유지, 값 노출 금지')
    }
    if ($rel -match 'supabase/migrations/' -and $name -match 'service.?role') {
        return @('REVIEW_BEFORE_COMMIT', '마이그레이션 파일명 service_role (스키마 SQL)', 'diff 검토 후 소유 브랜치 PR')
    }
    if (-not (Test-TrackedTestAsset -Rel $rel) -and $name -match 'service.?role|secret|credential|private.?key|id_rsa|\.pem$|\.p12$') {
        return @('NEVER_COMMIT', '비밀/키 파일명 휴리스틱', '로컬 보존만, 원격 커밋 금지')
    }
    if ($rel -match '\.zip$' -and $rel -match 'Desktop/putduk-mining/') {
        return @('PRESERVE_OUTSIDE_GIT', '대용량 목업 ZIP', 'D:/F: QA 보존, Git 커밋 제외')
    }
    if ($rel -match 'putduk-sk-hynix-mining-v3-precision\.html$') {
        return @('PRESERVE_OUTSIDE_GIT', '로컬 HTML 목업', 'D:/F: QA 보존, Git 커밋 제외')
    }
    if ($rel -match 'Desktop/putduk-mining/(PUTDUK_|CURRENT_|NEXT_|CODEX_)' -and $rel -match '\.(txt|json|md)$') {
        return @('REVIEW_BEFORE_COMMIT', '에이전트/감사 초안 문서', '내용 검토 후 docs/audit 또는 삭제')
    }
    if ($rel -match 'docs/audit/local-preservation-2026-10-10') {
        return @('COMMIT_REQUIRED', '로컬 보존 감사 산출물', '검토 후 docs/audit 커밋')
    }
    if ($rel -match '\.cursor/rules/.*\.local\.') {
        return @('REVIEW_BEFORE_COMMIT', '로컬 전용 Cursor rule', '팀 공유 필요 시만 커밋')
    }
    if ($rel -match 'apps/admin/' -and $Status -eq 'dirty') {
        return @('COMMIT_REQUIRED', '운영자 앱 변경', '소유 브랜치에서 PR')
    }
    if ($rel -match 'tests/e2e/' -and $Status -eq 'dirty') {
        return @('COMMIT_REQUIRED', 'E2E 테스트 변경', '소유 브랜치에서 PR')
    }
    if ($rel -match '/tests/' -and $Status -eq 'dirty') {
        return @('COMMIT_REQUIRED', '단위/통합 테스트 변경', '소유 브랜치에서 PR')
    }
    if ($rel -match 'supabase/' -and $Status -eq 'dirty') {
        return @('COMMIT_REQUIRED', 'DB/마이그레이션 변경', '소유 브랜치에서 PR')
    }
    if ($rel -match 'next-env\.d\.ts$') {
        return @('REVIEW_BEFORE_COMMIT', 'Next 자동 생성 타입', '도구 재생성 여부 확인')
    }
    if ($rel -match 'AGENTS\.md$' -or $rel -match 'docs/quality/') {
        return @('REVIEW_BEFORE_COMMIT', '운영/품질 문서', '의도 확인 후 커밋')
    }
    return @('REVIEW_BEFORE_COMMIT', '미분류 변경', 'diff 검토 후 카테고리 확정')
}

if (-not (Test-Path -LiteralPath $rawPath)) {
    throw "원본 CSV 없음: $rawPath"
}

function Resolve-InventoryPath {
    param(
        [string]$Path,
        [string]$WorktreeRoot
    )
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $Path
    }
    # git status 상대 경로는 드라이브 문자 없이 \ 로 시작할 수 있음
    if ($Path -match '^[A-Za-z]:[/\\]') {
        return $Path
    }
    if (-not [string]::IsNullOrWhiteSpace($WorktreeRoot)) {
        return (Join-Path $WorktreeRoot $Path)
    }
    return $Path
}

$rows = Import-Csv -LiteralPath $rawPath
$classified = foreach ($r in $rows) {
    $fullPath = Resolve-InventoryPath -Path $r.path -WorktreeRoot $r.worktree_root
    $cat = Get-Category -Path $fullPath -Status $r.status
    [pscustomobject]@{
        path               = $r.path
        worktree_root      = $r.worktree_root
        status             = $r.status
        category           = $cat[0]
        reason             = $cat[1]
        recommended_action = $cat[2]
    }
}
if (@($classified).Count -ne @($rows).Count) {
    throw "CSV_ROW_COUNT in=$(@($rows).Count) out=$(@($classified).Count)"
}
$classified | Export-Csv -LiteralPath $outPath -NoTypeInformation -Encoding UTF8
$rows | Export-Csv -LiteralPath $copyPath -NoTypeInformation -Encoding UTF8
Write-Output "CLASSIFIED=$($classified.Count)"