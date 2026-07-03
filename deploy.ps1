# ============================================================
# deploy.ps1 — One-command deploy for AI Debt Collector OS
# Flow:  D: (git repo) -> ship WORKING-TREE tracked files to VPS
#        -> npm install (optional) -> build -> pm2 restart
# Usage: powershell -ExecutionPolicy Bypass -File deploy.ps1 "commit message"
#        add -SkipInstall when package.json/lock unchanged (faster)
#
# Notes:
#  - Ships the WORKING TREE (current files), NOT git HEAD — so a deploy never
#    depends on a successful commit. (Local `git commit` is flaky on this box:
#    Windows Defender intermittently locks .git/index. The commit+push below is
#    therefore best-effort and never blocks the deploy.)
#  - File set = `git ls-files` (tracked paths). Deleted files are absent from
#    the list, and `src/` is wiped on the server before extract, so deletions
#    propagate correctly. Untracked, gitignored paths on the server (.env*,
#    node_modules, .next) are preserved.
#  - The tarball is written to a temp file and scp'd (never piped through the
#    PowerShell pipeline, which corrupts binary streams).
#  - The remote command is a SINGLE line to avoid CRLF (\r) breaking bash.
# ============================================================
param(
    [string]$Message = "deploy: update $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
    [switch]$SkipInstall
)

# NOTE: 'Continue' (not 'Stop') on purpose. Under 'Stop', PowerShell 5.1 turns
# any native-command stderr line (e.g. git's harmless "LF will be replaced by
# CRLF" warning) into a terminating NativeCommandError and aborts the script.
# Critical steps below check $LASTEXITCODE explicitly and `throw` on failure.
$ErrorActionPreference = "Continue"
$D   = "D:\ai-debt-os-admin"
$VPS = "root@72.62.30.109"
$APP = "ai-debt-os-admin"
$DIR = "/root/ai-debt-os-admin"
$URL = "http://72.62.30.109"

function Step($m){ Write-Host "`n==> $m" -ForegroundColor Cyan }

Set-Location $D

# 0) Guard against the single most recurring bug class found across every
# audit of this codebase: a Supabase write (insert/update/upsert/delete)
# whose `error` result is never checked, so a failure is completely
# invisible while the caller proceeds as if it succeeded. This has been
# found and hand-fixed dozens of times in dozens of different files across
# multiple sessions - this makes it impossible to reintroduce, permanently,
# by scanning the entire src/ tree on every single deploy. A real failure
# here MUST block the deploy (unlike the git steps below, which are
# best-effort) - this is a hard gate, not a warning.
Step "Guard: no unchecked Supabase writes"
& node scripts/check-unchecked-writes.js
if ($LASTEXITCODE -ne 0) { throw "unchecked Supabase write(s) found - see above. Fix before deploying (or add a documented, justified exclusion in scripts/check-unchecked-writes.js if truly out of scope)." }

# 1) Commit + push to GitHub (history/backup; best-effort — never blocks deploy)
Step "Commit & push to GitHub (origin) [best-effort]"
git add -A | Out-Null
$pending = git status --porcelain
if ([string]::IsNullOrWhiteSpace($pending)) {
    Write-Host "   nothing to commit" -ForegroundColor Yellow
} else {
    git commit -m $Message | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "   committed" -ForegroundColor Green }
    else { Write-Host "   WARN: commit failed (deploy continues from working tree)" -ForegroundColor Yellow }
}
git push origin master | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host "   pushed to origin" -ForegroundColor Green }
else { Write-Host "   WARN: git push origin skipped/failed (continuing)" -ForegroundColor Yellow }

# 2) Build a tarball of the WORKING-TREE tracked files and copy to the VPS
Step "Ship working-tree files to VPS"
$list = Join-Path $env:TEMP "ai-debt-os-files.txt"
$tar  = Join-Path $env:TEMP "ai-debt-os-deploy.tar"
if (Test-Path $tar) { Remove-Item $tar -Force }
# Tracked paths PLUS new untracked-but-not-gitignored paths (git add never
# succeeded locally on this box, so brand-new files like a freshly-added
# lib/route would otherwise be silently missing from every deploy — this bit
# us with agent-dryrun/route.ts and import-engine.ts). Filtering by Test-Path
# drops any files deleted in the working tree but not yet committed, so tar
# never chokes on missing files, and deletions still propagate (absent here +
# `rm -rf src` on the server).
$tracked   = git ls-files
$untracked = git ls-files --others --exclude-standard
($tracked + $untracked) | Select-Object -Unique | Where-Object { Test-Path -LiteralPath $_ } | Set-Content -Path $list -Encoding ascii
if (-not (Test-Path $list) -or (Get-Item $list).Length -eq 0) { throw "git ls-files produced no file list" }
& tar -cf $tar -T $list
if (-not (Test-Path $tar)) { throw "tar produced no tarball" }
& scp -o BatchMode=yes $tar "${VPS}:/tmp/deploy.tar"
if ($LASTEXITCODE -ne 0) { throw "scp failed (exit $LASTEXITCODE)" }

# 3) Extract + build + restart on the VPS (single-line remote command, && chained)
Step "Extract, build & restart on VPS"
$install = if ($SkipInstall) { "echo 'skip install'" } else { "npm install --no-audit --no-fund" }
$remote  = "cd $DIR && rm -rf src && tar -xf /tmp/deploy.tar && rm -f /tmp/deploy.tar && $install && npm run build && pm2 restart $APP --update-env && pm2 save"
& ssh -o BatchMode=yes $VPS $remote
if ($LASTEXITCODE -ne 0) { throw "remote build/restart failed (exit $LASTEXITCODE)" }

# 4) Health check
Step "Health check"
try {
    $code = (Invoke-WebRequest -Uri $URL -UseBasicParsing -TimeoutSec 15).StatusCode
    Write-Host "   $URL -> HTTP $code" -ForegroundColor Green
} catch {
    Write-Host "   WARNING: health check failed: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host "`nDONE." -ForegroundColor Green
