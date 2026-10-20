import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyCandidates, discoverLocalProxies } from '../server/proxy-discovery.mjs';
import { createGoogleTransport, probeGoogleRoute } from '../server/google-transport.mjs';

test('discovery only accepts local HTTP proxies and deduplicates configured listeners', () => {
  const candidates = proxyCandidates({ HTTPS_PROXY: 'http://127.0.0.1:7993', HTTP_PROXY: 'http://remote.example:8080', ALL_PROXY: 'http://user:password@localhost:7890' }, {
    listeners: [{ port: 7993, address: '127.0.0.1' }, { port: 53, address: '::' }, { port: 7890, address: '0.0.0.0' }, { port: 9000, address: '192.168.1.20' }],
    systemProxy: 'http=127.0.0.1:7890;https=localhost:8888;socks=localhost:1080'
  });
  assert.deepEqual(candidates.map(item => item.url), ['http://127.0.0.1:7993', 'http://127.0.0.1:7890', 'http://localhost:8888']);
  assert(!JSON.stringify(candidates).includes('password'));
});

test('Windows discovery runs hidden and survives unavailable process inspection', async () => {
  const result = await discoverLocalProxies({ platform: 'win32', environment: {}, run: async (command, args, options) => {
    assert.equal(command, 'powershell.exe'); assert.equal(options.windowsHide, true); assert(options.timeout <= 10000);
    return { stdout: JSON.stringify({ listeners: [{ port: 7993, address: '127.0.0.1' }] }) };
  } });
  assert.equal(result[0].url, 'http://127.0.0.1:7993');
  const fallback = await discoverLocalProxies({ platform: 'win32', environment: { HTTPS_PROXY: 'http://localhost:7890' }, run: async () => { throw new Error('Denied'); } });
  assert.equal(fallback[0].url, 'http://localhost:7890');
});

test('connectivity probes check all three Google hosts without sending credentials', async () => {
  const urls = [];
  assert.equal(await probeGoogleRoute(async (url, options) => {
    urls.push(url); assert.equal(options.headers, undefined); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return new Response('', { status: url.includes('oauth2.') ? 404 : 401 });
  }), true);
  assert.equal(urls.length, 3);
  assert.equal(await probeGoogleRoute(async () => new Response('proxy login page', { status: 200 })), false);
});

function fixture() {
  const f = { clock: 10000, discoveryCount: 0, probes: 0, writes: 0, failWrite: false, working: 'http://127.0.0.1:7993/', direct: false, closed: [] };
  f.transport = createGoogleTransport('auto', async (url, options = {}) => {
    const selected = options.dispatcher?.url;
    if (options.method === 'POST') {
      f.writes++;
      if (f.failWrite) throw new Error('Connection lost after write');
      return Response.json({ created: true });
    }
    return new Response('', { status: selected ? selected === f.working ? 401 : 503 : f.direct ? 401 : 503 });
  }, {
    now: () => f.clock,
    discover: async () => { f.discoveryCount++; return [{ url: 'http://127.0.0.1:7993', source: 'application' }, { url: 'http://127.0.0.1:7890', source: 'application' }]; },
    makeDispatcher: url => ({ url, async close() { f.closed.push(url); } }),
    probe: async request => { f.probes++; return (await request('https://oauth2.googleapis.com/token')).status === 401; }
  });
  return f;
}

test('automatic routing shares detection, caches it and redetects after a failed write without replaying it', async () => {
  const f = fixture();
  try {
    const [first, second] = await Promise.all([f.transport.check(), f.transport.check()]);
    assert.equal(f.discoveryCount, 1); assert.deepEqual(first, second); assert.equal(first.endpoint, '127.0.0.1:7993');
    await f.transport.check(); assert.equal(f.discoveryCount, 1);
    f.failWrite = true;
    await assert.rejects(f.transport.request('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', body: '{}' }));
    assert.equal(f.writes, 1, 'No write replay on a different route');
    f.failWrite = false; f.working = 'http://127.0.0.1:7890/';
    await f.transport.request('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    assert.equal(f.discoveryCount, 2); assert.equal(f.transport.status().endpoint, '127.0.0.1:7890');
    f.clock += 61000; await f.transport.check(); assert.equal(f.discoveryCount, 3);
    await f.transport.check(true); assert.equal(f.discoveryCount, 4);
  } finally { await f.transport.close(); }
  await assert.rejects(f.transport.check(), error => error.code === 'GOOGLE_NETWORK_UNAVAILABLE');
});

test('system network works for TUN mode; total failure is reported and can be rechecked immediately', async () => {
  const f = fixture(); f.working = ''; f.direct = true;
  try {
    assert.equal((await f.transport.check()).kind, 'system');
    f.direct = false;
    await assert.rejects(f.transport.check(true), error => error.code === 'GOOGLE_NETWORK_UNAVAILABLE');
    assert.equal(f.transport.status().state, 'error');
    const count = f.discoveryCount;
    await assert.rejects(f.transport.check()); assert.equal(f.discoveryCount, count, 'Brief negative cache avoids repeated scanning');
    f.working = 'http://127.0.0.1:7993/';
    assert.equal((await f.transport.check(true)).kind, 'proxy');
  } finally { await f.transport.close(); }
});

test('explicit manual proxy does not switch routes or expose credentials in status', async () => {
  let discovered = false;
  const transport = createGoogleTransport('http://user:private@localhost:8888', async () => Response.json({}), {
    discover: async () => { discovered = true; return []; },
    makeDispatcher: () => ({ async close() {} }), probe: async () => true
  });
  try {
    const result = await transport.check(); assert.equal(result.mode, 'manual'); assert.equal(result.endpoint, 'localhost:8888');
    assert.equal(discovered, false); assert(!JSON.stringify(result).includes('private'));
  } finally { await transport.close(); }
});
