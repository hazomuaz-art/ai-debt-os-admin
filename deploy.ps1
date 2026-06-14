# ============================================================
# deploy.ps1 — One-command deploy for AI Debt Collector OS
# Flow:  D: (work copy) -> C: (git copy) -> GitHub + VPS -> build + pm2 restart
# Usage: powershell -ExecutionPolicy Bypass -File deploy.ps1 "commit message"
# ============================================================
param(
    [string]$Message = "deploy: update $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
    [switch]$SkipInstall  # pass -SkipInstall when package.json/lock unchanged (faster)
)

$ErrorActionPreference = "Stop"
$D   = "D:\ai-debt-os-admin"
$C   = "C:\Users\moham\.gemini\antigravity-ide\scratch\ai-debt-os-admin"
$VPS = "root@72.62.30.109"
$APP = "ai-debt-os-admin"
$URL = "http://72.62.30.109"

function Step($m){ Write-Host "`n==> $m" -ForegroundColor Cyan }

# 1) Mirror D: -> C: (code only; never touch git/deps/build/secrets)
Step "Sync D: -> C: (robocopy mirror)"
$exclDirs  = @("node_modules",".next",".git",".vercel","out","dist")
$exclFiles = @(".env.local","tsconfig.tsbuildinfo")
robocopy $D $C /E /XD $exclDirs /XF $exclFiles /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE)" }  # 0-7 = success
Write-Host "   sync OK" -ForegroundColor Green

# 2) Commit + push (GitHub + VPS bare repo)
Step "Commit & push (origin + vps)"
Push-Location $C
git add -A
$pending = git status --porcelain
if ([string]::IsNullOrWhiteSpace($pending)) {
    Write-Host "   no code changes to commit" -ForegroundColor Yellow
} else {
    git commit -m $Message
}
git push origin master
git push vps master
Pop-Location

# 3) Build + restart on the server (post-receive only checks out files)
Step "Build & restart on VPS"
$install = if ($SkipInstall) { "echo 'skip install'" } else { "npm install --no-audit --no-fund" }
$remote = @"
set -e
cd /root/ai-debt-os-admin
$install
npm run build
pm2 restart $APP --update-env
pm2 save
"@
ssh -o BatchMode=yes $VPS $remote

# 4) Health check
Step "Health check"
Start-Sleep -Seconds 3
try {
    $code = (Invoke-WebRequest -Uri $URL -UseBasicParsing -TimeoutSec 15).StatusCode
    Write-Host "   $URL -> HTTP $code" -ForegroundColor Green
} catch {
    Write-Host "   WARNING: health check failed: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host "`nDONE." -ForegroundColor Green
