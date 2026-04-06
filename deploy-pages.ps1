# deploy-pages.ps1
# Builds the Next.js frontend locally and pushes to the gh-pages branch.
# Use this when GitHub Actions hosted runners are disabled on GHE.
#
# Usage:
#   .\deploy-pages.ps1            # build + deploy
#   .\deploy-pages.ps1 -SkipBuild # skip build, deploy last out/ folder

param(
    [switch]$SkipBuild,
    [string]$NodePath = "C:\Users\AD10209\node\node-v22.14.0-win-x64"
)

$ErrorActionPreference = "Stop"
$RepoRoot  = $PSScriptRoot
$FrontendDir = Join-Path $RepoRoot "frontend"
$OutDir      = Join-Path $FrontendDir "out"

Write-Host ""
Write-Host "  Utbytte — Deploy to GitHub Pages  " -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

# ── Pre-flight: verify precious data is intact ───────────────────────────────
Write-Host "`n[0/3] Pre-flight data integrity check ..." -ForegroundColor Yellow
$integrityScript = Join-Path $RepoRoot "scripts\check-data-integrity.ps1"
if (Test-Path $integrityScript) {
    & $integrityScript -Quiet
    # Not a blocker — just a warning snapshot so we can detect if deploy damages anything
}
# Snapshot counts for post-deploy verification
$preDeployMp3  = (Get-ChildItem (Join-Path $RepoRoot "backend\storage\audio") -Filter "*.mp3" -ErrorAction SilentlyContinue | Measure-Object).Count
$preDeployVenv = Test-Path (Join-Path $RepoRoot "backend\venv312\Scripts\python.exe")

# ── Step 1: Build ────────────────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Host "`n[1/3] Building frontend (Railway URL baked in) ..." -ForegroundColor Yellow
    Push-Location $FrontendDir
    $env:Path = "$NodePath;$env:Path"
    # Override .env.local so the Railway URL is baked into the static bundle.
    # frontend/.env.local has NEXT_PUBLIC_API_URL=http://localhost:8000 for local dev,
    # but process.env set here wins over file-based env at Next.js build time.
    $env:NEXT_PUBLIC_API_URL = "https://utbytte-backend-production.up.railway.app"
    if (-not (Test-Path "node_modules")) {
        Write-Host "  node_modules missing, running npm install first..." -ForegroundColor DarkYellow
        & "$NodePath\npm.cmd" install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    }
    & "$NodePath\npm.cmd" run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }
    Remove-Item Env:NEXT_PUBLIC_API_URL -ErrorAction SilentlyContinue
    Pop-Location
    Write-Host "  Build complete → $OutDir" -ForegroundColor Green
} else {
    Write-Host "`n[1/3] Skipping build (-SkipBuild)" -ForegroundColor DarkYellow
}

if (-not (Test-Path $OutDir)) {
    throw "No build output found at $OutDir. Run without -SkipBuild first."
}

# ── Step 2: Copy out/ to a temp folder ───────────────────────────────────────
Write-Host "`n[2/3] Copying build output to temp ..." -ForegroundColor Yellow
$TempDir = Join-Path $env:TEMP "utbytte-pages-$(Get-Random)"
Copy-Item $OutDir $TempDir -Recurse -Force
Write-Host "  Temp: $TempDir" -ForegroundColor DarkGray

# ── Step 3: Push temp contents to gh-pages branch via git worktree ──────────
# SAFETY: We use a worktree so we NEVER switch the main working tree to gh-pages.
# Switching branches in the main tree would silently delete gitignored runtime
# data (backend/storage/audio, chromadb, venv312) when git checkout restores
# only tracked files. The worktree is a throwaway temp directory — only it gets
# wiped, never the repo root.
Write-Host "`n[3/3] Deploying to gh-pages branch (via worktree) ..." -ForegroundColor Yellow
Push-Location $RepoRoot

$CurrentBranch = git branch --show-current
$WorktreeDir = Join-Path $env:TEMP "utbytte-gh-pages-wt-$(Get-Random)"

# Ensure remote gh-pages exists
$RemoteExists = git ls-remote --heads origin gh-pages 2>$null
if ($RemoteExists) {
    git fetch origin gh-pages --quiet
    $ErrorActionPreference = "Continue"
    git worktree add $WorktreeDir gh-pages 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        # worktree add failed (e.g. local branch doesn't exist yet) — create tracking branch
        git branch gh-pages origin/gh-pages 2>&1 | Out-Null
        git worktree add $WorktreeDir gh-pages 2>&1 | Out-Null
    }
    $ErrorActionPreference = "Stop"
} else {
    # First deploy: create orphan gh-pages in a bare worktree
    git worktree add --orphan -b gh-pages $WorktreeDir 2>&1 | Out-Null
}

# Clear the worktree (only the temp dir — not the repo root)
Get-ChildItem $WorktreeDir -Force | Where-Object { $_.Name -ne ".git" } | Remove-Item -Recurse -Force

# Copy build files into the worktree
Get-ChildItem $TempDir | ForEach-Object {
    Copy-Item $_.FullName $WorktreeDir -Recurse -Force
}

# Ensure .nojekyll exists
$nojekyll = Join-Path $WorktreeDir ".nojekyll"
if (-not (Test-Path $nojekyll)) { New-Item $nojekyll -ItemType File | Out-Null }

$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
Push-Location $WorktreeDir
git add -A
git commit -m "Deploy $Timestamp from $CurrentBranch"
git push origin gh-pages -f
Pop-Location

# Remove worktree and temp dirs
git worktree remove $WorktreeDir --force 2>&1 | Out-Null
Remove-Item $WorktreeDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $TempDir -Recurse -Force

Pop-Location

Write-Host ""
Write-Host "  Deployment complete!" -ForegroundColor Green

# ── Post-deploy: verify nothing was destroyed ────────────────────────────────
Write-Host "`nPost-deploy integrity check ..." -ForegroundColor Yellow
$postDeployMp3  = (Get-ChildItem (Join-Path $RepoRoot "backend\storage\audio") -Filter "*.mp3" -ErrorAction SilentlyContinue | Measure-Object).Count
$postDeployVenv = Test-Path (Join-Path $RepoRoot "backend\venv312\Scripts\python.exe")

if ($postDeployMp3 -lt $preDeployMp3) {
    Write-Host "  CRITICAL: MP3 count dropped from $preDeployMp3 to $postDeployMp3!" -ForegroundColor Red
} elseif ($preDeployVenv -and -not $postDeployVenv) {
    Write-Host "  CRITICAL: Python venv was destroyed!" -ForegroundColor Red
} else {
    Write-Host "  All data intact (MP3s: $postDeployMp3, venv: $postDeployVenv)" -ForegroundColor Green
}

if (Test-Path $integrityScript) {
    & $integrityScript
}
Write-Host ""
Write-Host "  Next step: in GitHub repo Settings → Pages" -ForegroundColor Cyan
Write-Host "    Source: Deploy from a branch" -ForegroundColor Cyan
Write-Host "    Branch: gh-pages  |  Folder: / (root)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  URL: https://kevinha98.github.io/DNB-Utbytte-Podcast-RAG-Pipeline/" -ForegroundColor Cyan
Write-Host ""
