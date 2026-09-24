# Probes HTTP S1 (hôte Windows) — à lancer après docker compose up healthy.
# Usage : depuis instance/ — pwsh -File scripts/s1-probes.ps1

$ErrorActionPreference = "Stop"
$caddyPort = if ($env:CADDY_HTTP_PORT) { $env:CADDY_HTTP_PORT } else { "8088" }
$apiPort = if ($env:API_HOST_PORT) { $env:API_HOST_PORT } else { "8080" }

function Test-HttpOk($Url, $Label) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) {
            Write-Host "OK  $Label ($Url)"
        } else {
            throw "HTTP $($r.StatusCode)"
        }
    } catch {
        Write-Error "FAIL $Label ($Url): $_"
    }
}

Test-HttpOk "http://127.0.0.1:$apiPort/health" "API /health"
Test-HttpOk "http://127.0.0.1:$caddyPort/health" "Caddy → API /health"
Test-HttpOk "http://127.0.0.1:$caddyPort/" "Caddy racine"

Write-Host "Probes hôte terminées."
