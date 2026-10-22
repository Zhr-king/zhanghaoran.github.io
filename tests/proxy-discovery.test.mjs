import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSystemProxy } from '../server/proxy-discovery.mjs';
import { createGoogleTransport } from '../server/google-transport.mjs';

const calendar = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
test('Windows resolves its existing per-destination configuration without inspecting VPN processes or ports', async () => {
  let calls = 0;
  const result = await resolveSystemProxy(calendar, { platform: 'win32', environment: {}, run: async (file, args, options) => {
    calls++; assert.equal(file, 'powershell.exe'); assert.equal(options.windowsHide, true);
    assert.equal(options.env.FORGEOS_PROXY_DESTINATION, 'https://www.googleapis.com/');
    assert.match(args.at(-1), /GetSystemWebProxy/);
    assert.doesNotMatch(args.at(-1), /Get-Process|Get-NetTCPConnection|Set-Item|Start-Process|UniClash/);
    return { stdout: '{"url":"http://127.0.0.1:7994/"}' };
  } });
  assert.deepEqual(result, { url: 'http://127.0.0.1:7994/', source: 'system' }); assert.equal(calls, 1);
  const direct = await resolveSystemProxy(calendar, { platform: 'win32', environment: {}, run: async () => ({stdout: '{"url":""}'}) });
  assert.equal(direct.url, '', 'An OS-selected direct/TUN route is respected');
  await assert.rejects(resolveSystemProxy(calendar, { platform: 'win32', environment: {}, run: async () => {throw Error('unavailable');} }), {code:'GOOGLE_PROXY_CONFIGURATION_FAILED'});
});

test('explicit environment proxies and bypass rules are respected without discovery or silent fallback', async () => {
  const run = async () => { throw Error('Must not invoke Windows resolver'); };
  for (const no_proxy of ['.googleapis.com', 'www.googleapis.com:443', '*']) {
    assert.equal((await resolveSystemProxy(calendar, {environment:{https_proxy:'http://localhost:8888',no_proxy},run})).url, '');
  }
  assert.equal((await resolveSystemProxy(calendar, {environment:{HTTPS_PROXY:'http://localhost:8888',NO_PROXY:'.example.com'},run})).url, 'http://localhost:8888/');
  await assert.rejects(resolveSystemProxy(calendar, {environment:{HTTPS_PROXY:'socks5://localhost:1080'},run}), {code:'GOOGLE_PROXY_CONFIGURATION_FAILED'});
});

function fixture(mode = 'auto') {
  const f = { clock:10000, resolved:0, requests:[], destroyed:[], proxy:'http://localhost:7994/', fail:null };
  f.transport = createGoogleTransport(mode, async (url, options) => {
    f.requests.push({url,options});
    if (f.fail) throw f.fail;
    return Response.json({ok:true});
  }, {
    now:()=>f.clock,
    resolve:async()=>{ f.resolved++; return {url:f.proxy,source:'system'}; },
    makeDispatcher:url=>({url,async destroy(){f.destroyed.push(url);}})
  });
  return f;
}

test('startup/status are offline; the first real operation is sent once with no probes', async () => {
  const f=fixture();
  assert.equal(f.transport.status().state,'idle'); assert.equal(f.resolved,0); assert.equal(f.requests.length,0);
  try {
    await f.transport.request(calendar,{method:'POST',body:'{}'});
    assert.equal(f.resolved,1); assert.equal(f.requests.length,1); assert.equal(f.requests[0].options.method,'POST');
    assert.equal(f.requests[0].options.dispatcher.url,f.proxy); assert.equal(f.requests[0].options.redirect,'error');
    assert.equal(f.transport.status().state,'ready');
  } finally {await f.transport.close();}
});

test('concurrent operations share configuration resolution; settings refresh on the next operation after expiry', async () => {
  const f=fixture();
  try {
    await Promise.all([f.transport.request(calendar),f.transport.request(calendar)]);
    assert.equal(f.resolved,1); assert.equal(f.requests.length,2);
    f.clock+=5001; f.proxy='http://localhost:7890/';
    await f.transport.request(calendar);
    assert.equal(f.resolved,2); assert.equal(f.requests[2].options.dispatcher.url,f.proxy);
  } finally {await f.transport.close();}
  assert.equal(f.destroyed.length,2);
});

test('lost writes are never replayed; the next deliberate operation rereads current settings', async () => {
  const f=fixture();
  try {
    f.fail=Object.assign(new Error('private details'),{cause:{code:'ECONNRESET'}});
    await assert.rejects(f.transport.request(calendar,{method:'POST',body:'{}'}), {code:'GOOGLE_NETWORK_UNAVAILABLE'});
    assert.equal(f.requests.length,1);
    f.fail=null; f.proxy='';
    await f.transport.request(calendar);
    assert.equal(f.resolved,2); assert.equal(f.requests.length,2); assert.equal(f.requests[1].options.dispatcher.url,'');
  } finally {await f.transport.close();}
});

test('manual/direct modes use only their selected route and status never exposes proxy credentials', async () => {
  for (const mode of ['direct','http://name:private@localhost:8888']) {
    const f=fixture(mode);
    try {
      await f.transport.request(calendar);
      assert.equal(f.resolved,0);
      assert.equal(f.requests[0].options.dispatcher.url,mode==='direct'?'':'http://name:private@localhost:8888/');
      assert(!JSON.stringify(f.transport.status()).includes('private'));
      await assert.rejects(f.transport.request('https://unexpected.example/'));
      assert.equal(f.requests.length,1);
    } finally {await f.transport.close();}
  }
});

test('network errors distinguish refused proxy, timeout, proxy authentication and TLS failures', async () => {
  for (const [failure,code] of [
    [{cause:{code:'ECONNREFUSED'}},'GOOGLE_PROXY_UNAVAILABLE'],
    [{name:'TimeoutError'},'GOOGLE_REQUEST_TIMEOUT'],
    [{cause:{message:'Proxy response (407)'}},'GOOGLE_PROXY_AUTH_REQUIRED'],
    [{cause:{code:'DEPTH_ZERO_SELF_SIGNED_CERT'}},'GOOGLE_TLS_FAILED']
  ]) {
    const f=fixture(); f.fail=failure;
    try {
      await assert.rejects(f.transport.request(calendar),{code});
      assert.equal(f.requests.length,1); assert.equal(f.transport.status().error,code);
    } finally {await f.transport.close();}
  }
});
