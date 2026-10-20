import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { GoogleMcp, CalendarError, allPages, expandedEvents } from '../server/google-mcp.mjs';
import { CalendarService, Journal, normalizeEvent } from '../server/calendar-service.mjs';
import { GoogleOAuth } from '../server/oauth.mjs';
import { createApp } from '../server/app.mjs';
import { randomUUID } from 'node:crypto';

test('full pagination, empty protobuf lists and repeated-page rejection', async () => {
  const result = await allPages(async (_, args) => args.pageToken ? { events: [{ id: 'b' }] } : { events: [{ id: 'a' }], nextPageToken: 'next' }, 'list_events', {}, 'events');
  assert.deepEqual(result.events.map(e => e.id), ['a', 'b']);
  assert.deepEqual((await allPages(async () => ({}), 'list_events', {}, 'events')).events, []);
  await assert.rejects(allPages(async () => ({ nextPageToken: 'again' }), 'list_events', {}, 'events'), code('CALENDAR_TOO_LARGE'));
});

test('official MCP SDK handshake, discovery, tool calls and structured results', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const remote = new Server({ name: 'calendar-fixture', version: '1' }, { capabilities: { tools: {} } });
  remote.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'list_calendars', inputSchema: { type: 'object' } }] }));
  remote.setRequestHandler(CallToolRequestSchema, async request => {
    assert.equal(request.params.name, 'list_calendars');
    return { content: [{ type: 'text', text: JSON.stringify({ calendars: [{ id: 'test' }] }) }] };
  });
  await remote.connect(serverTransport);
  const mcp = new GoogleMcp(async () => 'test-token', token => { assert.equal(token, 'test-token'); return clientTransport; });
  try { assert.deepEqual(await mcp.run(call => call('list_calendars', {})), { calendars: [{ id: 'test' }] }); }
  finally { await remote.close(); }
});

test('OAuth uses state, PKCE, server exchange and refresh; callback replay is rejected', async () => {
  const calls = [], oauth = new GoogleOAuth({ clientId: 'id', clientSecret: 'secret', redirectUri: 'http://127.0.0.1:8787/api/calendar/oauth/callback' }, async (url, init) => {
    calls.push({ url, init });
    return Response.json(url.includes('userinfo') ? { sub: 'user', email: 'test@example.test' } : { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
  });
  const session = {}, authorization = new URL(oauth.begin(session));
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256'); assert(!authorization.href.includes('secret'));
  await assert.rejects(oauth.finish({}, new URLSearchParams({ state: 'wrong', code: 'code' })), code('GOOGLE_AUTH_SESSION_EXPIRED'));
  const params = new URLSearchParams({ state: session.oauth.state, code: 'code' });
  await oauth.finish(session, params); assert.equal(session.user.id, 'user');
  assert(calls[0].init.body.get('code_verifier')); assert.equal(calls[0].init.body.get('client_secret'), 'secret');
  await assert.rejects(oauth.finish(session, params), code('GOOGLE_AUTH_SESSION_EXPIRED'));
  session.tokens.expiresAt = 0;
  assert.equal(await oauth.accessToken(session), 'access'); assert.equal(calls.at(-1).init.body.get('grant_type'), 'refresh_token');
});

test('local HTTP routes protect secrets, reject cross-origin writes and enforce sessions', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forgeos-http-test-'));
  const server = createApp({ root, dataDirectory: directory, clientId: '', clientSecret: '', redirectUri: '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(origin + '/api/calendar/status'), status = await response.json();
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal(status.authenticated, false); assert.equal(status.configured, false);
    assert.equal((await fetch(origin + '/planner/')).status, 200);
    for (const route of ['/server/.env', '/server/oauth.mjs', '/.git/config', '/node_modules/@modelcontextprotocol/sdk/package.json']) assert.equal((await fetch(origin + route)).status, 404);
    const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-ForgeOS-CSRF': status.csrf };
    assert.equal((await fetch(origin + '/api/calendar/auth/start', { method: 'POST', headers, body: '{}' })).status, 503);
    assert.equal((await fetch(origin + '/api/calendar/auth/start', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(origin + '/api/calendar/events', { method: 'POST', headers, body: '{"proposalId":"fake"}' })).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
const options = { calendarId: 'work', startTime: '2026-10-20T01:00:00Z', endTime: '2026-10-20T02:00:00Z', timeZone: 'Asia/Shanghai' };
const payload = () => ({ ...options, requestId: randomUUID(), title: 'Project review', description: 'Bring notes', location: 'Room 3' });
const event = (id, start = options.startTime, end = options.endTime) => ({ id, summary: 'Existing meeting', start: { dateTime: start }, end: { dateTime: end } });
async function fixture() {
  const journal = new Journal(await mkdtemp(path.join(os.tmpdir(), 'forgeos-calendar-test-')));
  const f = { service: new CalendarService(journal), journal, events: [], writes: [], role: 'writer', loseResponse: false, failRead: false };
  f.mcp = { run: work => work(async (name, args) => {
    if (name === 'list_calendars') return { calendars: [{ id: 'work', summary: 'My Calendar' }] };
    if (name === 'list_events') {
      if (f.failRead) throw new CalendarError('MCP_TOOL_FAILED', 502);
      return structuredClone({ events: f.events, accessRole: f.role, timeZone: 'Asia/Shanghai' });
    }
    if (name === 'get_event') return structuredClone(f.events.find(e => e.id === args.eventId));
    assert.equal(name, 'create_event', 'Only create is allowed; existing events must never be changed');
    f.writes.push(structuredClone(args));
    const created = { ...event('created-' + f.writes.length, args.startTime, args.endTime), summary: args.summary, description: args.description, location: args.location, colorId: args.colorId, htmlLink: 'https://calendar.google.com/calendar/event?eid=example' };
    f.events.push(created);
    if (f.loseResponse) throw new Error('Response lost after Google committed');
    return structuredClone(created);
  }) };
  return f;
}
test('all-day DST boundaries, free events, cancellations and expanded instances', () => {
  const allDay = normalizeEvent({ id: 'dst', start: { date: '2026-03-08' }, end: { date: '2026-03-09' } }, 'cal', 'America/Los_Angeles');
  assert.equal(allDay.end - allDay.start, 23 * 3600000);
  assert.equal(normalizeEvent({ ...event('a'), transparency: 'transparent' }, 'cal', 'UTC').busy, false);
  assert.equal(normalizeEvent({ ...event('a'), status: 'cancelled' }, 'cal', 'UTC'), null);
  assert.equal(normalizeEvent({ ...event('a'), attendees: [{ self: true, responseStatus: 'declined' }] }, 'cal', 'UTC'), null);
  assert.throws(() => normalizeEvent({ ...event('a'), recurrence: ['RRULE:FREQ=WEEKLY'] }, 'cal', 'UTC'), code('UNEXPANDED_RECURRENCE'));
  assert.equal(normalizeEvent({ ...event('a'), recurringEventId: 'series' }, 'cal', 'UTC').id, 'a');
});
test('create uses exact entered times and details; overlap succeeds and marks the NEW Google event red', async () => {
  const f = await fixture(); const original = event('meeting'); f.events.push(original);
  const body = payload(); const result = await f.service.create(f.mcp, 'user', body);
  assert.equal(result.overlap, true); assert.equal(result.conflicts[0].id, 'meeting');
  assert.equal(f.writes[0].colorId, '11'); assert.equal(result.event.colorId, '11');
  assert.equal(f.writes[0].startTime, options.startTime.replace('Z', '.000Z'));
  assert.equal(f.writes[0].endTime, options.endTime.replace('Z', '.000Z'));
  assert.equal(f.writes[0].timeZone, 'UTC'); assert.equal(f.writes[0].location, 'Room 3'); assert(f.writes[0].description.startsWith('Bring notes'));
  assert.deepEqual(f.events[0], original);
  assert.deepEqual(await new CalendarService(f.journal).create(f.mcp, 'user', body), result);
  assert.equal(f.writes.length, 1, 'Double-click / restart retry is idempotent');
  await assert.rejects(f.service.create(f.mcp, 'user', { ...body, title: 'Changed' }), code('REQUEST_CHANGED'));
  await f.service.create(f.mcp, 'user', { ...body, requestId: randomUUID() });
  assert.equal(f.writes.length, 2, 'A deliberate separate submission at the same time is allowed');
});
test('touching boundaries and free events do not mark a new event red', async () => {
  const f = await fixture(); f.events.push(event('earlier', '2026-10-20T00:00:00Z', options.startTime), { ...event('free'), transparency: 'transparent' });
  const result = await f.service.create(f.mcp, 'user', payload());
  assert.equal(result.overlap, false); assert.equal(f.writes[0].colorId, undefined);
});
test('overlap with all-day and cross-midnight events is detected', async () => {
  const f = await fixture(); f.events.push({ id: 'holiday', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } }, event('overnight', '2026-10-19T22:00:00Z', '2026-10-20T03:00:00Z'));
  const result = await f.service.create(f.mcp, 'user', payload()); assert.equal(result.conflicts.length, 2);
});
test('read-only, invalid time and failed conflict read never create events', async () => {
  const f = await fixture(); f.role = 'reader';
  await assert.rejects(f.service.create(f.mcp, 'user', payload()), code('CALENDAR_READ_ONLY'));
  f.role = 'writer'; f.failRead = true;
  await assert.rejects(f.service.create(f.mcp, 'user', payload()), code('MCP_TOOL_FAILED'));
  await assert.rejects(f.service.create(f.mcp, 'user', { ...payload(), endTime: options.startTime }), code('INVALID_WINDOW'));
  assert.equal(f.writes.length, 0); assert.equal(f.service.writing, false);
});
test('lost create response is reconciled from marker without duplicating events', async () => {
  const f = await fixture(); f.loseResponse = true; const body = payload();
  await assert.rejects(f.service.create(f.mcp, 'user', body), code('UNCERTAIN_WRITE'));
  const result = await new CalendarService(f.journal).create(f.mcp, 'user', body);
  assert.equal(result.event.id, 'created-1'); assert.equal(f.writes.length, 1);
});
test('recurrence fallback expands using Google REST, handles pagination and preserves window', async () => {
  const urls = [];
  const result = await expandedEvents('token', options, async (url, init) => {
    urls.push(url); assert.equal(init.headers.Authorization, 'Bearer token');
    assert.equal(url.hostname, 'www.googleapis.com'); assert.equal(url.searchParams.get('singleEvents'), 'true'); assert.equal(url.searchParams.get('timeMin'), options.startTime);
    return Response.json({ accessRole: 'writer', items: [event(url.searchParams.has('pageToken') ? 'second-instance' : 'first-instance')], ...(url.searchParams.has('pageToken') ? {} : { nextPageToken: 'next' }) });
  });
  assert.equal(urls.length, 2); assert.equal(result.events.length, 2); assert.equal(result.nextPageToken, undefined);
});
function code(expected) { return error => error.code === expected; }

// Standard Calendar API transport is the default personal-account integration.
test('Calendar REST transport paginates, expands recurrence and sends Google event JSON', async () => {
  const { GoogleCalendar } = await import('../server/google-calendar.mjs');
  const requests = [];
  const api = new GoogleCalendar(async () => 'private-token', async (url, init) => {
    requests.push({ url, init });
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.equal(init.headers.Authorization, 'Bearer private-token');
    assert.equal(init.redirect, 'error');
    if (url.pathname.endsWith('/calendarList')) return Response.json({ items: [{ id: 'work' }] });
    if (init.method === 'POST') return Response.json({ ...JSON.parse(init.body), id: 'created' });
    if (url.pathname.endsWith('/created')) return Response.json(event('created'));
    assert.equal(url.searchParams.get('singleEvents'), 'true');
    assert.equal(url.searchParams.get('timeMin'), options.startTime);
    assert.equal(url.searchParams.get('timeMax'), options.endTime);
    assert.equal(url.searchParams.get('timeZone'), options.timeZone);
    return Response.json({ items: [event(url.searchParams.has('pageToken') ? 'second' : 'first')], accessRole: 'writer', ...(url.searchParams.has('pageToken') ? {} : { nextPageToken: 'next' }) });
  });
  await api.run(async call => {
    assert.equal((await allPages(call, 'list_calendars', {}, 'calendars')).calendars[0].id, 'work');
    const page = await allPages(call, 'list_events', options, 'events');
    assert.deepEqual(page.events.map(e => e.id), ['first', 'second']);
    assert.equal(page.accessRole, 'writer');
    await call('create_event', { ...options, calendarId: 'personal+test@gmail.com', summary: 'Review', description: 'Notes', location: 'Room', colorId: '11' });
    const post = requests.at(-1);
    assert(post.url.pathname.includes('personal%2Btest%40gmail.com'));
    assert.deepEqual(JSON.parse(post.init.body), { summary: 'Review', description: 'Notes', location: 'Room', colorId: '11', start: { dateTime: options.startTime, timeZone: options.timeZone }, end: { dateTime: options.endTime, timeZone: options.timeZone } });
    assert.equal((await call('get_event', { calendarId: 'work', eventId: 'created' })).id, 'created');
  });
});

test('Calendar REST errors distinguish rejection from an uncertain write without leaking Google messages', async () => {
  const { GoogleCalendar } = await import('../server/google-calendar.mjs');
  for (const [status, reason, expected] of [[401, '', 'SIGN_IN_REQUIRED'], [403, 'accessNotConfigured', 'CALENDAR_API_DISABLED'], [403, 'forbidden', 'CALENDAR_ACCESS_DENIED'], [429, '', 'CALENDAR_RATE_LIMITED'], [503, '', 'CALENDAR_API_FAILED']]) {
    let calls = 0;
    const api = new GoogleCalendar(async () => 'secret', async () => { calls++; return Response.json({ error: { message: 'private Google details', errors: [{ reason }] } }, { status }); });
    await assert.rejects(api.run(call => call('create_event', options)), error => {
      assert.equal(error.code, expected); assert.equal(error.writeRejected, status !== 503);
      assert(!error.message.includes('private Google details')); return true;
    });
    assert.equal(calls, 1, 'No automatic POST retries');
  }
  const api = new GoogleCalendar(async () => 'secret', async () => { throw new Error('network'); });
  await assert.rejects(api.run(call => call('create_event', options)), code('CALENDAR_CONNECTION_FAILED'));
});

test('definitely rejected create can retry, but a rejected verification never permits duplicate creation', async () => {
  const f = await fixture(), body = payload(), base = f.mcp;
  let rejectCreate = true, rejectVerify = false;
  const adapter = { run: work => base.run(call => work(async (name, args) => {
    if ((name === 'create_event' && rejectCreate) || (name === 'get_event' && rejectVerify)) {
      const error = new CalendarError('CALENDAR_ACCESS_DENIED', 403); error.writeRejected = true; throw error;
    }
    return call(name, args);
  })) };
  await assert.rejects(f.service.create(adapter, 'user', body), code('CALENDAR_ACCESS_DENIED'));
  assert.deepEqual(await f.journal.load('user'), {});
  rejectCreate = false; rejectVerify = true;
  await assert.rejects(f.service.create(adapter, 'user', body), code('UNCERTAIN_WRITE'));
  assert.equal(f.writes.length, 1);
  assert.equal(Object.keys(await f.journal.load('user')).length, 1, 'Keep the committed write for reconciliation');
  rejectVerify = false;
  assert.equal((await f.service.create(adapter, 'user', body)).event.id, 'created-1');
  assert.equal(f.writes.length, 1);
});

test('OAuth distinguishes network, client credentials, expired codes and profile failures without exposing secrets', async () => {
  const cases = [
    ['network', 'GOOGLE_AUTH_NETWORK_FAILED'], ['invalid_client', 'GOOGLE_CLIENT_REJECTED'],
    ['invalid_grant', 'GOOGLE_AUTH_CODE_EXPIRED'], ['profile', 'GOOGLE_PROFILE_FAILED'], ['malformed', 'GOOGLE_AUTH_INVALID_RESPONSE']
  ];
  for (const [kind, expected] of cases) {
    const oauth = new GoogleOAuth({ clientId: 'id', clientSecret: 'private-secret', redirectUri: 'http://127.0.0.1/callback' }, async url => {
      if (kind === 'network') throw new Error('private upstream details');
      if (kind === 'malformed') return new Response('invalid JSON');
      if (url.includes('userinfo')) return Response.json({ error: 'private upstream details' }, { status: 403 });
      if (kind === 'profile') return Response.json({ access_token: 'private-token' });
      return Response.json({ error: kind, error_description: 'private upstream details' }, { status: 400 });
    });
    const session = {}; oauth.begin(session);
    await assert.rejects(oauth.finish(session, new URLSearchParams({ state: session.oauth.state, code: 'private-code' })), error => {
      assert.equal(error.code, expected); assert(!error.message.includes('private')); return true;
    });
    assert.equal(session.tokens, undefined);
    assert.equal(session.oauth, undefined, 'Callback cannot replay a failed code');
  }
});

test('missing OAuth callback session redirects safely; errors in status are allowlisted', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const oauth = { configured: true, async finish() { throw new Error('private-token-and-code'); } };
  const server = createApp({ root, dataDirectory: os.tmpdir() }, { oauth });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const missing = await fetch(origin + '/api/calendar/oauth/callback?code=private-code', { redirect: 'manual' });
    assert.equal(missing.status, 303); assert.equal(missing.headers.get('location'), '/planner/calendar.html?calendar=session-expired');
    const first = await fetch(origin + '/api/calendar/status'); const cookie = first.headers.get('set-cookie').split(';')[0];
    const callback = await fetch(origin + '/api/calendar/oauth/callback?code=private-code', { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(callback.headers.get('location'), '/planner/calendar.html?calendar=auth-failed');
    const status = await (await fetch(origin + '/api/calendar/status', { headers: { Cookie: cookie } })).json();
    assert.equal(status.authError, 'GOOGLE_AUTH_FAILED'); assert.equal(status.authenticated, false);
    assert(!JSON.stringify(status).includes('private'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Google transport uses the configured HTTP CONNECT proxy with no direct fallback', async () => {
  const http = await import('node:http');
  const { createGoogleTransport } = await import('../server/google-transport.mjs');
  const destinations = [], proxy = http.createServer();
  proxy.on('connect', (req, socket) => {
    destinations.push(req.url);
    assert.equal(req.headers.authorization, undefined, 'Origin credentials never go into CONNECT headers');
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const transport = createGoogleTransport('http://127.0.0.1:' + proxy.address().port);
  try {
    for (const host of ['oauth2.googleapis.com', 'openidconnect.googleapis.com', 'www.googleapis.com']) {
      await assert.rejects(transport.request('https://' + host + '/', { signal: AbortSignal.timeout(3000), headers: { Authorization: 'Bearer fixture' } }));
    }
    assert.deepEqual(destinations, ['oauth2.googleapis.com:443', 'openidconnect.googleapis.com:443', 'www.googleapis.com:443']);
    await assert.rejects(transport.request('https://unexpected.example/'));
  } finally { await transport.close(); await new Promise(resolve => proxy.close(resolve)); }
});

test('network recheck requires same-origin CSRF and failed preflight prevents OAuth redirect', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let checks = 0, begins = 0, unavailable = false;
  const network = { mode: 'auto', state: 'ready', kind: 'proxy', endpoint: '127.0.0.1:7993', source: 'application' };
  const transport = { status: () => network, async check() { checks++; if (unavailable) throw new CalendarError('GOOGLE_NETWORK_UNAVAILABLE', 502); return network; }, async close() {} };
  const oauth = { configured: true, begin(session) { begins++; session.oauth = {}; return 'https://accounts.google.com/'; } };
  const server = createApp({ root, dataDirectory: os.tmpdir() }, { transport, oauth });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const first = await fetch(origin + '/api/calendar/status'), status = await first.json();
    const cookie = first.headers.get('set-cookie').split(';')[0];
    assert.equal(status.network.mode, 'auto');
    const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-ForgeOS-CSRF': status.csrf };
    const denied = await fetch(origin + '/api/calendar/network/check', { method: 'POST', headers: { ...headers, Origin: 'https://other.example' }, body: '{}' });
    assert.equal(denied.status, 403); assert.equal(checks, 0);
    const checked = await fetch(origin + '/api/calendar/network/check', { method: 'POST', headers, body: '{}' });
    assert.equal(checked.status, 200); assert.equal((await checked.json()).network.endpoint, '127.0.0.1:7993');
    unavailable = true;
    const failed = await fetch(origin + '/api/calendar/auth/start', { method: 'POST', headers, body: '{}' });
    assert.equal(failed.status, 502); assert.equal((await failed.json()).error, 'GOOGLE_NETWORK_UNAVAILABLE'); assert.equal(begins, 0);
    unavailable = false;
    const started = await fetch(origin + '/api/calendar/auth/start', { method: 'POST', headers, body: '{"returnTo":"/planner/"}' });
    assert.equal(started.status, 200); assert.equal(begins, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
