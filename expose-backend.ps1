# expose-backend.ps1
# Exposes the local FastAPI backend via Cloudflare Tunnel (cloudflared).
# The tunnel URL is printed to console — paste it into the gear icon in the app.
#
# Requirements:
#   winget install Cloudflare.cloudflared
# OR download from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

$backendPort = 8000
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue)?.Source

if (-not $cloudflared) {
    # Try common install paths
    $candidates = @(
        "$env:ProgramFiles\cloudflared\cloudflared.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $cloudflared = $c; break }
    }
}

if (-not $cloudflared) {
    Write-Host ""
    Write-Host "cloudflared not found. Install it with:" -ForegroundColor Yellow
    Write-Host "  winget install Cloudflare.cloudflared" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Or download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" -ForegroundColor Cyan
    exit 1
}

# Check backend is running
try {
    $health = Invoke-RestMethod "http://localhost:$backendPort/api/health" -TimeoutSec 3
    Write-Host "Backend is running (status: $($health.status))" -ForegroundColor Green
} catch {
    Write-Host "Backend is not running on port $backendPort!" -ForegroundColor Red
    Write-Host "Start it first: cd backend ; .\venv312\Scripts\uvicorn.exe api.main:app --reload"
    exit 1
}

Write-Host ""
Write-Host "Starting Cloudflare Tunnel on port $backendPort..." -ForegroundColor Cyan
Write-Host "The tunnel URL will appear below. Copy it into the gear icon in the app." -ForegroundColor Yellow
Write-Host "(Press Ctrl+C to stop the tunnel)" -ForegroundColor Gray
Write-Host ""

# Run tunnel — URL is printed to stderr by cloudflared
& $cloudflared tunnel --url "http://localhost:$backendPort" 2>&1
