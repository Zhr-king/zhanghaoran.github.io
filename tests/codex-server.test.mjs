import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CodexService, CodexError, parseCodexOutput, validateTask, validateExtraction, runCodex } from '../server/codex-service.mjs';
import { createApp } from '../server/app.mjs';

const task = { title: 'Review report', duration: 45, deadline: '2026-11-05T17:00', start: '2026-11-05T14:00', priority: 'high', location: 'Room 2', notes: null };
const input = { text: 'Tomorrow at 2pm review the report for 45 minutes; due at 5pm, urgent, Room 2', now: '2026-11-04T10:00', timeZone: 'Asia/Shanghai' };
const evidence = { title: 'review the report', duration: '45 minutes', deadline: input.text, start: 'Tomorrow at 2pm', priority: 'urgent', location: 'Room 2', notes: null };
const output = (value, quotes = evidence) => ['{"type":"thread.started","thread_id":"test"}', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ task: value, evidence: quotes }) } }), '{"type":"turn.completed"}'].join('\n');
const code = expected => error => error.code === expected;

test('extraction uses stdin and an isolated read-only run, validates output and cleans temporary files', async () => {
  let directory;
  const service = new CodexService({ codexProxyUrl: 'direct' }, { run: async (command, args, options) => {
    directory = options.cwd;
    assert(existsSync(directory)); assert(!directory.startsWith(process.cwd()));
    assert(args.includes('--ignore-user-config')); assert(args.includes('--ephemeral'));
    assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
    assert.equal(args.at(-1), '-'); assert(!args.includes(input.text));
    assert(options.input.includes(input.text)); assert(options.input.includes(input.timeZone));
    return { stdout: output(task), stderr: '' };
  } });
  assert.deepEqual((await service.extract(input)).task, task);
  assert(service.verifiedAt); assert.equal(service.busy, false); assert(!existsSync(directory));
});

test('missing details remain null and malformed, out-of-range or incomplete model output is rejected', () => {
  const partial = { ...task, title: null, duration: null, deadline: null, start: null, priority: null, location: null };
  assert.deepEqual(parseCodexOutput(output(partial), input.text), partial);
  assert.deepEqual(parseCodexOutput('{"type":"error","message":"Reconnecting..."}\n' + output(task), input.text), task);
  for (const value of [{ ...task, extra: 'ignored?' }, { ...task, title: '' }, { ...task, priority: 'low' }, { ...task, duration: 0 }, { ...task, duration: 45.5 }, { ...task, deadline: '2026-02-30T17:00' }, { ...task, start: '2026-11-05' }, { ...task, notes: {} }, { ...task, title: '<script>'.repeat(100) }]) {
    assert.throws(() => validateTask(value), code('CODEX_INVALID_RESPONSE'));
  }
  assert.throws(() => parseCodexOutput(output(task).replace('{"type":"turn.completed"}', '')), code('CODEX_INVALID_RESPONSE'));
  assert.throws(() => parseCodexOutput(output(task) + '\n{"type":"turn.failed"}'), code('CODEX_INVALID_RESPONSE'));
});

test('fields without a supporting source quote remain empty, including priority', () => {
  const source = 'Read a book';
  const quotes = { title: source, duration: '30 minutes', deadline: null, start: '', priority: null, location: 'library', notes: null };
  const result = validateExtraction({ task: { ...task, title: source, priority: 'normal' }, evidence: quotes }, source);
  assert.deepEqual(result, { title: source, duration: null, deadline: null, start: null, priority: null, location: null, notes: null });
  for (const value of [{ task, evidence: {} }, { task, evidence: { ...evidence, priority: 1 } }, { task, evidence, extra: true }, { task }]) {
    assert.throws(() => validateExtraction(value, input.text), code('CODEX_INVALID_RESPONSE'));
  }
});

test('invalid requests never launch Codex; duplicate requests are rejected while a turn is running', async () => {
  let calls = 0, release;
  const service = new CodexService({ codexProxyUrl: 'direct' }, { run: async () => { calls++; await new Promise(resolve => { release = resolve; }); return { stdout: output(task) }; } });
  for (const value of [null, { ...input, text: '' }, { ...input, text: 'x'.repeat(301) }, { ...input, now: 'yesterday' }, { ...input, timeZone: 'Invalid/Zone' }]) await assert.rejects(service.extract(value), code('CODEX_INVALID_INPUT'));
  assert.equal(calls, 0);
  const first = service.extract(input);
  await assert.rejects(service.extract(input), code('CODEX_BUSY'));
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  release(); await first; assert.equal(calls, 1);
});

test('failure clears verified state and releases the runner for retry', async () => {
  let fail = true, directory;
  const service = new CodexService({ codexProxyUrl: 'direct' }, { run: async (_, args, options) => {
    directory = options.cwd;
    if (fail) throw new CodexError('CODEX_TIMEOUT', 504);
    return { stdout: output(task) };
  } });
  service.verifiedAt = 'old';
  await assert.rejects(service.extract(input), code('CODEX_TIMEOUT'));
  assert.equal(service.busy, false); assert.equal(service.verifiedAt, null); assert(!existsSync(directory));
  fail = false; assert.equal((await service.test()).connected, true);
});

test('status distinguishes missing CLI and missing login without exposing command output', async () => {
  const service = new CodexService({}, { run: async () => ({ stdout: '', stderr: 'Logged in using ChatGPT' }) });
  assert.equal((await service.status()).authenticated, true);
  service.run = async () => { throw new CodexError('CODEX_NOT_INSTALLED'); };
  assert.equal((await service.status()).installed, false);
  service.run = async () => { throw new CodexError('CODEX_SIGN_IN_REQUIRED'); };
  assert.equal((await service.status()).error, 'CODEX_SIGN_IN_REQUIRED');
});

test('subprocess runner passes task text literally and bounds hung processes', async () => {
  const literal = '`echo unsafe` $(echo unsafe) & <tag> "quotes"\nsecond line';
  const result = await runCodex({ file: process.execPath, args: [] }, ['-e', 'process.stdin.pipe(process.stdout)'], { input: literal });
  assert.equal(result.stdout, literal);
  await assert.rejects(runCodex({ file: process.execPath, args: [] }, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 50 }), code('CODEX_TIMEOUT'));
});

test('Codex inherits existing system proxy settings only in its child environment', async () => {
  const original = { ...process.env };
  let resolutions = 0;
  const service = new CodexService({}, { resolveProxy: async destination => {
    resolutions++; assert.equal(destination, 'https://chatgpt.com');
    return { source: 'system', url: 'http://127.0.0.1:7890/' };
  }, run: async () => ({ stdout: 'Logged in using ChatGPT', stderr: '' }) });
  await service.status(); assert.equal(resolutions, 0, 'Status does not resolve or probe network settings');
  const child = await service.environment();
  assert.equal(child.HTTPS_PROXY, 'http://127.0.0.1:7890/'); assert.deepEqual({ ...process.env }, original);
  service.resolveProxy = async () => ({ source: 'environment', url: '' });
  assert.deepEqual(await service.environment(), original, 'Keep environment proxy and bypass rules intact');
  service.resolveProxy = async () => { throw new Error('Private resolver details'); };
  await assert.rejects(service.environment(), code('CODEX_PROXY_CONFIGURATION_FAILED'));
});

test('Codex HTTP endpoints work without Google OAuth and enforce local origin, session and CSRF', async t => {
  let calls = 0;
  const codex = { status: async () => ({ available: true, installed: true, authenticated: true }),
    test: async () => { calls++; return { connected: true }; },
    extract: async value => { calls++; assert.deepEqual(value, input); return { provider: 'codex', task }; } };
  const server = createApp({ root: path.resolve('.'), dataDirectory: path.resolve('server/.data/test') }, {
    codex, oauth: { configured: false }, transport: { status: () => ({}), close: async () => {} }, service: {}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = await fetch(base + '/api/codex/status');
  const cookie = status.headers.get('set-cookie').split(';')[0], { csrf } = await status.json();
  assert(csrf); assert.match(status.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/api\/codex/);
  const post = (route, headers = {}) => fetch(base + '/api/codex/' + route, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', 'X-ForgeOS-CSRF': csrf, ...headers }, body: JSON.stringify(input) });
  assert.equal((await post('extract', { Cookie: '' })).status, 401);
  assert.equal((await post('extract', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('extract', { 'X-ForgeOS-CSRF': 'wrong' })).status, 403);
  assert.equal((await post('extract', { Origin: '' })).status, 403);
  assert.equal(calls, 0);
  assert.deepEqual((await (await post('extract')).json()).task, task);
  assert.equal((await (await post('test')).json()).connected, true); assert.equal(calls, 2);
  assert.equal((await fetch(base + '/server/codex-service.mjs')).status, 404);
});
