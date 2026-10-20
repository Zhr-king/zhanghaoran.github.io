import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

// Read only configured proxies and listeners owned by known proxy applications.
// This does not scan LAN hosts or change Windows / VPN settings.
const windowsDiscovery = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$proxyApps = Get-Process | Where-Object { $_.ProcessName -match '^(UniClash(Core)?|clash.*|mihomo.*|v2ray.*|xray.*|sing-box|singbox|hiddify.*|Shadowsocks.*)$' }
$proxyRows = @()
if ($proxyApps) {
  $proxyPids = @($proxyApps.Id)
  $proxyRows = @(Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in $proxyPids -and $_.LocalPort -ge 1024 -and $_.LocalAddress -in @('127.0.0.1','0.0.0.0','::1','::') } | ForEach-Object {
    [pscustomobject]@{ port = $_.LocalPort; address = $_.LocalAddress; app = ($proxyApps | Where-Object Id -eq $_.OwningProcess | Select-Object -First 1).ProcessName }
  })
}
$internet = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
[pscustomobject]@{ listeners = $proxyRows; systemProxy = $(if ($internet.ProxyEnable -eq 1) { [string]$internet.ProxyServer } else { '' }) } | ConvertTo-Json -Depth 4 -Compress
`;

export function localProxy(value) {
  try {
    const url = new URL(value.includes('://') ? value : 'http://' + value);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
export function proxyCandidates(environment = {}, windows = {}) {
  const candidates = [], seen = new Set();
  function add(value, source) {
    if (typeof value !== 'string') return;
    const url = localProxy(value.trim());
    if (url && !seen.has(url)) { seen.add(url); candidates.push({ url, source }); }
  }
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) add(environment[key], 'environment');
  for (const row of Array.isArray(windows.listeners) ? windows.listeners : []) {
    if (!Number.isInteger(row.port) || row.port < 1024 || row.port > 65535) continue;
    if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(row.address)) continue;
    add('http://' + (row.address === '::1' ? '[::1]' : '127.0.0.1') + ':' + row.port, 'application');
  }
  for (const part of String(windows.systemProxy || '').split(';')) {
    const match = part.match(/^(?:https?=)?([^=]+)$/i);
    if (match) add(match[1], 'system');
  }
  return candidates.slice(0, 12);
}
export async function discoverLocalProxies({ platform = process.platform, environment = process.env, run = execute } = {}) {
  let windows = {};
  if (platform === 'win32') {
    try {
      const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsDiscovery], { windowsHide: true, timeout: 10000, maxBuffer: 65536 });
      windows = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
    } catch { /* Environment proxies and the system network can still work. */ }
  }
  return proxyCandidates(environment, windows);
}
