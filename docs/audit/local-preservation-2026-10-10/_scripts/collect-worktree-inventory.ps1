$ErrorActionPreference = 'Stop'
$base = 'C:\Users\PC\Desktop\putduk-mining'
$exportDir = 'D:\PUTDUK-MINING-QA\audit-2026-10-10-164902\exports'
New-Item -ItemType Directory -Force -Path $exportDir | Out-Null

$rows = @()
$allFiles = @()
$entries = @()
$current = $null
foreach ($line in (git -C $base worktree list --porcelain)) {
    if ($line -match '^worktree ') {
        if ($null -ne $current) { $entries += $current }
        $current = @{ Path = $line.Substring(9).Trim(); HEAD = ''; Branch = '(detached)'; Prunable = $false }
    }
    elseif ($null -eq $current) { continue }
    elseif ($line -match '^HEAD ') { $current.HEAD = $line.Substring(5).Trim() }
    elseif ($line -match '^branch refs/heads/(.+)$') { $current.Branch = $Matches[1].Trim() }
    elseif ($line -eq 'prunable') { $current.Prunable = $true }
    elseif ($line -match '^detached$') { $current.Branch = '(detached)' }
}
if ($null -ne $current) { $entries += $current }

foreach ($entry in $entries) {
    $path = $entry.Path
    $head = $entry.HEAD
    $branch = $entry.Branch
    if ($entry.Prunable -and -not (Test-Path $path)) {
        $rows += [pscustomobject]@{
            Path = $path; HEAD = $head; Branch = $branch
            Modified = 0; Untracked = 0; TotalDirty = 0; Note = 'prunable-missing'
        }
        continue
    }
    if (-not (Test-Path $path)) {
        $rows += [pscustomobject]@{
            Path = $path; HEAD = $head; Branch = $branch
            Modified = 0; Untracked = 0; TotalDirty = 0; Note = 'path-missing'
        }
        continue
    }

    try {
        $porcelain = @(git -C $path status --porcelain 2>$null)
        if ($LASTEXITCODE -ne 0) {
            $rows += [pscustomobject]@{
                Path = $path; HEAD = $head; Branch = $branch
                Modified = 0; Untracked = 0; TotalDirty = 0; Note = 'git-status-failed'
            }
            continue
        }
        # index-only(M )와 worktree( M)를 같이 센다. ?? 는 untracked 이다.
        $modified = @($porcelain | Where-Object { $_ -match '^[MADRCU!T ]{2} ' -and $_ -notmatch '^\?\?' }).Count
        $untracked = @($porcelain | Where-Object { $_ -match '^\?\?' }).Count
        $rows += [pscustomobject]@{
            Path          = $path
            HEAD          = $head
            Branch        = $branch
            Modified      = $modified
            Untracked     = $untracked
            TotalDirty    = $modified + $untracked
            Note          = ''
        }
        foreach ($line in $porcelain) {
            if ($line -match '^\?\? (.+)$') {
                $rel = $Matches[1].Trim('"')
                $full = if ([System.IO.Path]::IsPathRooted($rel)) { $rel } else { Join-Path $path $rel }
                $allFiles += [pscustomobject]@{ path = $full; worktree_root = $path; status = 'untracked' }
            }
            elseif ($line -match '^(.)(.) (.+)$') {
                $rel = $Matches[3].Trim('"')
                $full = if ([System.IO.Path]::IsPathRooted($rel)) { $rel } else { Join-Path $path $rel }
                $allFiles += [pscustomobject]@{ path = $full; worktree_root = $path; status = 'dirty' }
            }
        }
    }
    catch {
        $rows += [pscustomobject]@{
            Path = $path; HEAD = $head; Branch = $branch
            Modified = 0; Untracked = 0; TotalDirty = 0; Note = "error:$($_.Exception.Message)"
        }
    }
}

$rows | Export-Csv -Path (Join-Path $exportDir 'worktree-inventory.csv') -NoTypeInformation -Encoding UTF8
$allFiles | Sort-Object path -Unique | Export-Csv -Path (Join-Path $exportDir 'all-uncommitted-files-raw.csv') -NoTypeInformation -Encoding UTF8

$sumM = ($rows | Measure-Object -Property Modified -Sum).Sum
$sumU = ($rows | Measure-Object -Property Untracked -Sum).Sum
Write-Output "WORKTREES=$($rows.Count) MOD_SUM=$sumM UNTR_SUM=$sumU FILE_ROWS=$($allFiles.Count)"
