<#
.SYNOPSIS
    Safety check: verifies precious gitignored data is intact.
    Run before and after any git/deploy operation.

.DESCRIPTION
    Returns exit code 0 if all data is intact, 1 if something is missing.
    Called automatically by deploy-pages.ps1 and can be run manually anytime.

.EXAMPLE
    .\scripts\check-data-integrity.ps1
    .\scripts\check-data-integrity.ps1 -Quiet
#>
param([switch]$Quiet)

$RepoRoot = Split-Path $PSScriptRoot -Parent
$backend = Join-Path $RepoRoot "backend"

$checks = @(
    @{ Path = "$backend\storage\audio";            Type = "dir";  MinCount = 500; Desc = "MP3 files" }
    @{ Path = "$backend\storage\chromadb";          Type = "dir";  MinCount = 1;   Desc = "ChromaDB index" }
    @{ Path = "$backend\storage\transcripts";       Type = "dir";  MinCount = 500; Desc = "Transcripts" }
    @{ Path = "$backend\storage\manifest.json";     Type = "file"; MinCount = $null; Desc = "Manifest" }
    @{ Path = "$backend\venv312\Scripts\python.exe"; Type = "file"; MinCount = $null; Desc = "Python venv" }
)

$allOk = $true
$results = @()

foreach ($c in $checks) {
    $status = "OK"
    $detail = ""

    if ($c.Type -eq "dir") {
        if (-not (Test-Path $c.Path)) {
            $status = "MISSING"
            $allOk = $false
        } else {
            $count = (Get-ChildItem $c.Path -File -ErrorAction SilentlyContinue | Measure-Object).Count
            $detail = "$count files"
            if ($c.MinCount -and $count -lt $c.MinCount) {
                $status = "LOW"
                $allOk = $false
            }
        }
    } else {
        if (-not (Test-Path $c.Path)) {
            $status = "MISSING"
            $allOk = $false
        } else {
            $size = (Get-Item $c.Path).Length
            $detail = "$([math]::Round($size/1KB, 1)) KB"
        }
    }

    $results += [PSCustomObject]@{
        Status = $status
        Check  = $c.Desc
        Detail = $detail
        Path   = $c.Path.Replace($RepoRoot, ".")
    }
}

if (-not $Quiet) {
    Write-Host ""
    Write-Host "  Data Integrity Check  " -ForegroundColor Cyan
    Write-Host "========================" -ForegroundColor Cyan
    foreach ($r in $results) {
        $color = switch ($r.Status) {
            "OK"      { "Green" }
            "LOW"     { "Yellow" }
            "MISSING" { "Red" }
        }
        $icon = switch ($r.Status) {
            "OK"      { "[OK]     " }
            "LOW"     { "[LOW]    " }
            "MISSING" { "[MISSING]" }
        }
        $line = "$icon $($r.Check)"
        if ($r.Detail) { $line += " ($($r.Detail))" }
        Write-Host "  $line" -ForegroundColor $color
    }
    Write-Host ""
    if ($allOk) {
        Write-Host "  All checks passed." -ForegroundColor Green
    } else {
        Write-Host "  WARNING: Some data is missing or incomplete!" -ForegroundColor Red
    }
    Write-Host ""
}

exit ([int](-not $allOk))
