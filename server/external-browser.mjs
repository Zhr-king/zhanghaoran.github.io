import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

// Called only after an explicit, same-origin, CSRF-protected Connect click.
export async function openGoogleAuthorization(value) {
  const url = new URL(value);
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password) throw new Error('Unexpected authorization URL');
  const command = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url.href]]
    : process.platform === 'darwin' ? ['open', [url.href]] : ['xdg-open', [url.href]];
  try {
    await execute(...command, { windowsHide: true, timeout: 5000, maxBuffer: 4096 });
    return true;
  } catch { return false; }
}
