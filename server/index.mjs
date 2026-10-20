import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, 'server', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be 1024–65535.');
const origin = `http://127.0.0.1:${port}`;
const redirectUri = process.env.GOOGLE_REDIRECT_URI || origin + '/api/calendar/oauth/callback';
if (redirectUri !== origin + '/api/calendar/oauth/callback') throw new Error('GOOGLE_REDIRECT_URI must match the local origin and callback path.');
const dataDirectory = path.resolve(process.env.FORGEOS_DATA_DIR || path.join(os.homedir(), '.forgeos', 'calendar'));
if (dataDirectory === root || dataDirectory.startsWith(root + path.sep)) throw new Error('FORGEOS_DATA_DIR must be outside the website directory.');
const config = { root, dataDirectory, redirectUri, clientId: process.env.GOOGLE_CLIENT_ID || '', clientSecret: process.env.GOOGLE_CLIENT_SECRET || '' };
const server = createApp(config);
server.on('error', error => { console.error('Local service could not start: ' + error.code); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`ForgeOS: ${origin}/planner/calendar.html`);
  console.log(config.clientId && config.clientSecret ? 'Google OAuth configured. Connect from Schedule.' : 'Google OAuth not configured. See docs/GOOGLE_CALENDAR_MCP.md.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
