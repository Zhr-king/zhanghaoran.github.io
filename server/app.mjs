import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CalendarError, GoogleMcp } from './google-mcp.mjs';
import { GoogleOAuth } from './oauth.mjs';
import { CalendarService, Journal } from './calendar-service.mjs';

const random = () => randomBytes(32).toString('base64url');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.md': 'text/plain' };
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 100000) throw new CalendarError('REQUEST_TOO_LARGE', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new CalendarError('INVALID_JSON'); }
}
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }

// Deliberately local and single-user. No remote bind address or cross-origin API.
export function createApp(config, dependencies = {}) {
  const oauth = dependencies.oauth || new GoogleOAuth(config);
  const service = dependencies.service || new CalendarService(new Journal(config.dataDirectory));
  const mcpFor = dependencies.mcpFor || (session => new GoogleMcp(() => oauth.accessToken(session)));
  const sessions = new Map();
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
      for (const [id, session] of sessions) if (session.expires < Date.now()) sessions.delete(id);
      const cookie = /(?:^|;\s*)forgeos_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
      let session = sessions.get(cookie);
      if (!session && route === '/api/calendar/status' && req.method === 'GET') {
        if (sessions.size >= 100) throw new CalendarError('TOO_MANY_SESSIONS', 429);
        session = { id: random(), csrf: random(), expires: Date.now() + 8 * 3600000 };
        sessions.set(session.id, session);
        res.setHeader('Set-Cookie', `forgeos_session=${session.id}; HttpOnly; SameSite=Lax; Path=/api/calendar; Max-Age=28800`);
      }
      if (!session) throw new CalendarError('SESSION_REQUIRED', 401);
      if (route === '/api/calendar/oauth/callback' && req.method === 'GET') {
        try { await oauth.finish(session, url.searchParams); res.writeHead(303, { Location: '/planner/calendar.html?calendar=connected' }); }
        catch { res.writeHead(303, { Location: '/planner/calendar.html?calendar=auth-failed' }); }
        res.end(); return;
      }
      if (req.method === 'GET' && route === '/api/calendar/status') {
        json(res, 200, { available: true, configured: oauth.configured, authenticated: Boolean(session.tokens), email: session.tokens ? session.user?.email : '', csrf: session.csrf }); return;
      }
      if (req.method !== 'POST') throw new CalendarError('METHOD_NOT_ALLOWED', 405);
      if (req.headers.origin !== origin || req.headers['x-forgeos-csrf'] !== session.csrf || !req.headers['content-type']?.startsWith('application/json')) throw new CalendarError('CSRF_FAILED', 403);
      const input = await body(req);
      if (route === '/api/calendar/auth/start') { json(res, 200, { url: oauth.begin(session) }); return; }
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
        const mcp = mcpFor(identity);
        try {
          if (route === '/api/calendar/calendars') return { calendars: await service.calendars(mcp) };
          if (route === '/api/calendar/read') return await service.read(mcp, identity.user.id, input);
          if (route === '/api/calendar/events') return await service.create(mcp, identity.user.id, input);
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
  return server;
}
