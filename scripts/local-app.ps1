param(
    [ValidateSet('Start', 'Stop')][string]$Action = 'Start',
    [switch]$NoBrowser,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$entryPoint = Join-Path $projectRoot 'server\index.mjs'
$launchMutex = $null
$ownsMutex = $false

function Show-LauncherMessage([string]$Text, [bool]$IsError = $false) {
    if ($Quiet) { Write-Output $Text; return }
    $dialog = New-Object -ComObject WScript.Shell
    $icon = if ($IsError) { 16 } else { 64 }
    [void]$dialog.Popup($Text, 0, 'ForgeOS', $icon)
}

function Get-LocalServiceState([string]$Url) {
    # This only checks localhost; it never probes Google or any proxy software.
    $request = [System.Net.HttpWebRequest]::Create($Url)
    $request.Proxy = $null
    $request.AllowAutoRedirect = $false
    $request.Timeout = 1000
    $request.ReadWriteTimeout = 1000
    $response = $null
    $reader = $null
    try {
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $html = $reader.ReadToEnd()
        if ($response.StatusCode -eq 200 -and $html.Contains('id="taskForm"') -and $html.Contains('ForgeOS')) { return 'ready' }
        return 'occupied'
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) { $_.Exception.Response.Close(); return 'occupied' }
        return 'offline'
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Close() }
    }
}

function Get-OwnedService([string]$StatePath) {
    if (!(Test-Path -LiteralPath $StatePath)) { return $null }
    $record = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if (!$process -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $record.started) { return $null }
    $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
    if ($details.ExecutablePath -ne $record.executable -or $record.entryPoint -ne $entryPoint -or
        !$details.CommandLine.Contains('"' + $entryPoint + '"')) {
        throw 'The saved process does not belong to this ForgeOS launcher. It was left running.'
    }
    return $process
}

try {
    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$nodeCommand) { throw 'Node.js 22.19 or newer is required. Install Node.js, then double-click ForgeOS.vbs again.' }
    $nodePath = $nodeCommand.Source
    Push-Location -LiteralPath $projectRoot
    try {
        # Only the port leaves this process. OAuth credentials are never printed.
        $settingsText = 'const fs=require("node:fs");const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<19))throw Error("Node.js 22.19 or newer is required.");if(fs.existsSync("server/.env"))process.loadEnvFile("server/.env");const port=Number(process.env.PORT||8787);if(!Number.isInteger(port)||port<1024||port>65535)throw Error("Invalid local port.");console.log(JSON.stringify({port}));' | & $nodePath
        if ($LASTEXITCODE -ne 0) { throw 'Could not read the local configuration. Check your Node.js version and server/.env.' }
        $port = ($settingsText | ConvertFrom-Json).port
    } finally { Pop-Location }
    $url = "http://127.0.0.1:$port/planner/"
    $runtimeDirectory = Join-Path $projectRoot "server\.data\launcher\$port"
    $statePath = Join-Path $runtimeDirectory 'process.json'
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $key = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant() + ':' + $port))).Replace('-', '') }
    finally { $sha.Dispose() }
    $launchMutex = New-Object System.Threading.Mutex($false, "Local\ForgeOS-$key")
    try { $ownsMutex = $launchMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (!$ownsMutex) { exit 0 }

    if ($Action -eq 'Stop') {
        $owned = Get-OwnedService $statePath
        if ($owned) {
            Stop-Process -InputObject $owned
            $owned.WaitForExit(5000) | Out-Null
            if (!$owned.HasExited) { throw 'ForgeOS has not exited yet. Try stopping it again.' }
            Remove-Item -LiteralPath $statePath
            Show-LauncherMessage 'ForgeOS is stopped. Double-click ForgeOS.vbs to start it again.'
        } elseif ((Get-LocalServiceState $url) -eq 'ready') {
            Show-LauncherMessage 'This ForgeOS service was started elsewhere. Close it from its original launcher; this shortcut has left it running.'
        } else { Show-LauncherMessage 'ForgeOS is already stopped.' }
        exit 0
    }

    $serviceState = Get-LocalServiceState $url
    if ($serviceState -eq 'occupied') { throw "Port $port is in use by another application. ForgeOS did not change or stop that application." }
    if ($serviceState -ne 'ready') {
        Push-Location -LiteralPath $projectRoot
        try {
            'for(const name of ["undici","@js-temporal/polyfill","@modelcontextprotocol/sdk/client/index.js"])require.resolve(name);' | & $nodePath
            if ($LASTEXITCODE -ne 0) { throw 'Project dependencies are missing. Run npm ci once in this project, then double-click ForgeOS.vbs.' }
        } finally { Pop-Location }
        [void](New-Item -ItemType Directory -Path $runtimeDirectory -Force)
        $stdout = Join-Path $runtimeDirectory 'stdout.log'
        $stderr = Join-Path $runtimeDirectory 'stderr.log'
        $owned = Get-OwnedService $statePath
        if (!$owned) {
            $owned = Start-Process -FilePath $nodePath -ArgumentList ('"' + $entryPoint + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
            @{ pid = $owned.Id; started = $owned.StartTime.ToUniversalTime().Ticks.ToString(); executable = $nodePath; entryPoint = $entryPoint } |
                ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
        }
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        do {
            if ($owned.HasExited) { throw "ForgeOS could not start. See $stderr" }
            if ((Get-LocalServiceState $url) -eq 'ready') { $serviceState = 'ready'; break }
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($serviceState -ne 'ready') { throw "ForgeOS has not become ready. See $stderr" }
    }
    if (!$NoBrowser) { Start-Process $url }
    if ($Quiet) { Write-Output "ForgeOS ready: $url" }
} catch {
    Show-LauncherMessage $_.Exception.Message $true
    exit 1
} finally {
    if ($ownsMutex) { $launchMutex.ReleaseMutex() }
    if ($launchMutex) { $launchMutex.Dispose() }
}
