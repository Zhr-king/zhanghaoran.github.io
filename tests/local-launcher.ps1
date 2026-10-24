# Uses a separate local port; never authenticates with Google or opens a browser.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $projectRoot 'scripts\local-app.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$previousPort = $env:PORT
$previousRedirect = $env:GOOGLE_REDIRECT_URI
$portReservation = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
$portReservation.Start()
$testPort = $portReservation.LocalEndpoint.Port
$portReservation.Stop()
$statePath = Join-Path $projectRoot "server\.data\launcher\$testPort\process.json"
$originalState = $null
function Assert-True($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
try {
    $env:PORT = "$testPort"
    $env:GOOGLE_REDIRECT_URI = "http://127.0.0.1:$testPort/api/calendar/oauth/callback"
    & $powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $launcher -Action Start -NoBrowser -Quiet
    Assert-True ($LASTEXITCODE -eq 0) 'The background service must start successfully.'
    $originalState = Get-Content -LiteralPath $statePath -Raw
    $first = $originalState | ConvertFrom-Json
    & $powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $launcher -Action Start -NoBrowser -Quiet
    Assert-True ($LASTEXITCODE -eq 0) 'Opening a running service must succeed.'
    $second = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    Assert-True ($first.pid -eq $second.pid -and $first.started -eq $second.started) 'Repeated launches must reuse the same process.'
    # A valid PID alone must never authorize stopping a different process.
    $second.entryPoint = Join-Path $projectRoot 'server\unrelated.mjs'
    $second | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    & $powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $launcher -Action Stop -Quiet
    Assert-True ($LASTEXITCODE -eq 1) 'Stopping an unrecognized process must be rejected.'
    Assert-True ($null -ne (Get-Process -Id $first.pid -ErrorAction SilentlyContinue)) 'The unrecognized process must be left running.'
    $originalState | Set-Content -LiteralPath $statePath -Encoding UTF8
    & $powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $launcher -Action Stop -Quiet
    Assert-True ($LASTEXITCODE -eq 0) 'The owned background service must stop.'
    Assert-True (!(Test-Path -LiteralPath $statePath)) 'Stopping must remove the owned process record.'
    Assert-True ($null -eq (Get-Process -Id $first.pid -ErrorAction SilentlyContinue)) 'The test process must have exited.'
    Write-Output 'PASS: hidden start, ready page, repeated launch, process ownership protection and stop.'
} finally {
    if ($originalState -and (Test-Path -LiteralPath $statePath)) {
        $originalState | Set-Content -LiteralPath $statePath -Encoding UTF8
        & $powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $launcher -Action Stop -Quiet
    }
    $env:PORT = $previousPort
    $env:GOOGLE_REDIRECT_URI = $previousRedirect
}
