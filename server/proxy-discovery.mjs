import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CalendarError } from './google-mcp.mjs';
const execute = promisify(execFile);

// Resolve the existing Windows configuration, including PAC and bypass rules.
// No process enumeration, port scans, VPN control APIs or configuration writes.
const windowsProxy = String.raw`
$ErrorActionPreference = 'Stop'
$destination = [Uri]$env:FORGEOS_PROXY_DESTINATION
$proxy = [System.Net.WebRequest]::GetSystemWebProxy()
$resolved = $proxy.GetProxy($destination)
[pscustomobject]@{ url = $(if ($null -eq $resolved -or $resolved -eq $destination) { '' } else { $resolved.AbsoluteUri }) } | ConvertTo-Json -Compress
`;

export function proxyUrl(value) {
  try {
    const url = new URL(value.includes('://') ? value : 'http://' + value);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.href;
  } catch { throw new CalendarError('GOOGLE_PROXY_CONFIGURATION_FAILED', 502); }
}

function bypasses(destination, value = '') {
  return value.split(/[\s,]+/).filter(Boolean).some(entry => {
    if (entry === '*') return true;
    const [rawHost, port] = entry.toLowerCase().split(':');
    const host = rawHost.replace(/^\*?\./, '');
    return (!port || port === (destination.port || '443')) &&
      (destination.hostname === host || destination.hostname.endsWith('.' + host));
  });
}

export async function resolveSystemProxy(destination, { platform = process.platform, environment = process.env, run = execute } = {}) {
  const url = new URL(destination);
  const configured = environment.https_proxy || environment.HTTPS_PROXY || environment.http_proxy || environment.HTTP_PROXY || environment.all_proxy || environment.ALL_PROXY;
  if (configured) return { url: bypasses(url, environment.no_proxy || environment.NO_PROXY) ? '' : proxyUrl(configured.trim()), source: 'environment' };
  if (platform !== 'win32') return { url: '', source: 'system' };
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsProxy], {
      windowsHide: true, timeout: 8000, maxBuffer: 4096,
      // Only a public origin is passed to the OS resolver, never OAuth data.
      env: { ...environment, FORGEOS_PROXY_DESTINATION: url.origin + '/' }
    });
    const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    if (typeof result.url !== 'string') throw new Error();
    return { url: result.url ? proxyUrl(result.url) : '', source: 'system' };
  } catch { throw new CalendarError('GOOGLE_PROXY_CONFIGURATION_FAILED', 502); }
}
