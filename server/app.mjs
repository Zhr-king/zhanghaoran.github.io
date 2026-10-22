import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CalendarError } from './google-mcp.mjs';
import { GoogleCalendar } from './google-calendar.mjs';
import { GoogleOAuth } from './oauth.mjs';
import { createGoogleTransport, NETWORK_ERRORS } from './google-transport.mjs';
import { CalendarService, Journal } from './calendar-service.mjs';
import { openGoogleAuthorization } from './external-browser.mjs';

const random = () => randomBytes(32).toString('base64url');
const AUTH_ERRORS = new Set([...NETWORK_ERRORS, 'GOOGLE_AUTH_FAILED', 'GOOGLE_AUTH_NETWORK_FAILED', 'GOOGLE_AUTH_INVALID_RESPONSE',
  'GOOGLE_AUTH_SESSION_EXPIRED', 'GOOGLE_CLIENT_REJECTED', 'GOOGLE_AUTH_CODE_EXPIRED', 'GOOGLE_PROFILE_FAILED']);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.md': 'text/plain' };
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 100000) throw new CalendarError('REQUEST_TOO_LARGE', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new CalendarError('INVALID_JSON'); }
}
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }

// Deliberately local and single-user. No remote bind address or cross-origin API.
export function createApp(config, dependencies = {}) {
  const transport = dependencies.transport || createGoogleTransport(config.proxyUrl);
  const oauth = dependencies.oauth || new GoogleOAuth(config, transport.request);
  const service = dependencies.service || new CalendarService(new Journal(config.dataDirectory));
  const calendarFor = dependencies.calendarFor || (session => new GoogleCalendar(() => oauth.accessToken(session), transport.request));
  const sessions = new Map();
  const openBrowser = dependencies.openBrowser || openGoogleAuthorization;
  let queue = Promise.resolve();
  const serialized = work => { const next = queue.then(work); queue = next.catch(() => {}); return next; };
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    try {
      if (req.headers.host !== new URL(origin).host) throw new CalendarError('INVALID_HOST', 403);
      if (req.headers.origin && req.headers.origin !== origin) throw new CalendarError('INVALID_ORIGIN', 403);
      const url = new URL(req.url, origin), route = url.pathname;
      if (!route.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw new CalendarError('METHOD_NOT_ALLOWED', 405);
        let relative = decodeURIComponent(route);
        if (relative.endsWith('/')) relative += 'index.html';
        if (!(relative === '/index.html' || relative.startsWith('/planner/') || relative.startsWith('/knowledge/') || relative.startsWith('/assets/') || relative === '/docs/GOOGLE_CALENDAR_MCP.md') || relative.split('/').some(part => part.startsWith('.')) || !MIME[path.extname(relative)]) throw new CalendarError('NOT_FOUND', 404);
        const file = await realpath(path.resolve(config.root, '.' + relative)).catch(() => null);
        if (!file || !file.startsWith(config.root + path.sep)) throw new CalendarError('NOT_FOUND', 404);
        res.setHeader('Content-Type', MIME[path.extname(file)] + '; charset=utf-8');
        res.end(req.method === 'HEAD' ? undefined : await readFile(file)); return;
      }
      for (const [id, current] of sessions) {
        if (current.expires < Date.now()) sessions.delete(id);
        else if (current.oauth?.expires < Date.now()) { delete current.oauth; current.authError = 'GOOGLE_AUTH_SESSION_EXPIRED'; }
      }
      const cookie = /(?:^|;\s*)forgeos_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
      let session = sessions.get(cookie);
      if (route === '/api/calendar/oauth/callback' && req.method === 'GET') {
        // The system browser and VS Code have different cookie jars. Random,
        // one-use OAuth state binds the callback to the initiating session.
        const state = url.searchParams.get('state');
        session = state ? [...sessions.values()].find(item => item.oauth?.state === state) : undefined;
      }
      if (!session && route === '/api/calendar/status' && req.method === 'GET') {
        if (sessions.size >= 100) throw new CalendarError('TOO_MANY_SESSIONS', 429);
        session = { id: random(), csrf: random(), expires: Date.now() + 8 * 3600000 };
        sessions.set(session.id, session);
        res.setHeader('Set-Cookie', `forgeos_session=${session.id}; HttpOnly; SameSite=Lax; Path=/api/calendar; Max-Age=28800`);
      }
      if (!session && route === '/api/calendar/oauth/callback' && req.method === 'GET') {
        res.writeHead(303, { Location: '/planner/calendar.html?calendar=session-expired' }); res.end(); return;
      }
      if (!session) throw new CalendarError('SESSION_REQUIRED', 401);
      if (route === '/api/calendar/oauth/callback' && req.method === 'GET') {
        const external = session.oauth?.external === true;
        const language = session.oauth?.language === 'zh-CN' ? 'zh-CN' : 'en';
        const returnTo = session.oauth?.returnTo === '/planner/' ? '/planner/' : '/planner/calendar.html';
        session.authorizing = true;
        let connected = false;
        try { await oauth.finish(session, url.searchParams); connected = true; }
        catch (error) {
          session.authError = AUTH_ERRORS.has(error.code) ? error.code : 'GOOGLE_AUTH_FAILED';
          // Only an allowlisted category is logged, never tokens, callback URLs or Google response bodies.
          console.warn('Google OAuth callback: ' + session.authError);

        }
        finally { session.authorizing = false; }
        if (external) {
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          const title = language === 'en'
            ? (connected ? 'Google Calendar connected' : 'Google authorization incomplete')
            : (connected ? 'Google 日历已连接' : 'Google 授权未完成');
          const detail = language === 'en'
            ? (connected ? 'Return to ForgeOS. Your connection will update automatically. You can close this tab.' : 'Return to ForgeOS to view the error and reconnect.')
            : (connected ? '返回 ForgeOS，页面会自动更新。现在可以关闭此标签页。' : '返回 ForgeOS 查看原因并重试。');
          res.end('<!doctype html><html lang="' + language + '"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' · ForgeOS</title><body style="background:#071126;color:#e4efff;font:20px Calibri,sans-serif;max-width:640px;margin:12vh auto;padding:24px"><h1>' + title + '</h1><p>' + detail + '</p></body></html>');
        } else {
          res.writeHead(303, { Location: returnTo + (connected ? '?calendar=connected' : '?calendar=auth-failed') }); res.end();
        }
        return;
      }
      if (req.method === 'GET' && route === '/api/calendar/status') {
        json(res, 200, { available: true, configured: oauth.configured, authenticated: Boolean(session.tokens), email: session.tokens ? session.user?.email : '', authError: session.authError || '', authorizing: Boolean(session.oauth || session.authorizing), network: transport.status(), csrf: session.csrf }); return;
      }
      if (req.method !== 'POST') throw new CalendarError('METHOD_NOT_ALLOWED', 405);
      if (req.headers.origin !== origin || req.headers['x-forgeos-csrf'] !== session.csrf || !req.headers['content-type']?.startsWith('application/json')) throw new CalendarError('CSRF_FAILED', 403);
      const input = await body(req);
      if (route === '/api/calendar/auth/start') {
        if (session.authorizing) throw new CalendarError('AUTH_IN_PROGRESS', 409);
        const url = oauth.begin(session);
        if (input.returnTo === '/planner/') session.oauth.returnTo = '/planner/';
        session.oauth.external = input.external === true;
        session.oauth.language = input.language === 'zh-CN' ? 'zh-CN' : 'en';
        const opened = input.external === true ? await openBrowser(url) : false;
        if (!opened && session.oauth) session.oauth.external = false;
        json(res, 200, { url, opened }); return;
      }
      if (route === '/api/calendar/disconnect') {
        // Local session disconnect, not revocation of all Google grants.
        sessions.delete(session.id);
        res.setHeader('Set-Cookie', 'forgeos_session=; HttpOnly; SameSite=Lax; Path=/api/calendar; Max-Age=0');
        json(res, 200, { disconnected: true }); return;
      }
      if (!session.tokens || !session.user) throw new CalendarError('SIGN_IN_REQUIRED', 401);
      const account = session.user;
      const result = await serialized(async () => {
        // A sign-out or expired session while queued invalidates the operation.
        if (!sessions.has(session.id) || session.expires < Date.now() || session.user !== account) throw new CalendarError('SIGN_IN_REQUIRED', 401);
        const identity = { ...session };
        const previousTokens = identity.tokens;
        const calendar = calendarFor(identity);
        try {
          if (route === '/api/calendar/calendars') return { calendars: await service.calendars(calendar) };
          if (route === '/api/calendar/read') return await service.read(calendar, identity.user.id, input);
          if (route === '/api/calendar/events') return await service.create(calendar, identity.user.id, input);
          throw new CalendarError('NOT_FOUND', 404);
        } finally {
          if (session.user === account && session.tokens === previousTokens) session.tokens = identity.tokens;
        }
      });
      json(res, 200, result);
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof CalendarError ? error.status : 500, {
        error: error instanceof CalendarError ? error.code : 'SERVICE_ERROR', ...(error.completed ? { completed: error.completed } : {})
      }); else res.end();
    }
  });
  server.requestTimeout = 120000;
  server.once('close', () => { transport.close().catch(() => {}); });
  return server;
}
