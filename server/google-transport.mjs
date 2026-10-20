import { ProxyAgent } from 'undici';
import { CalendarError } from './google-mcp.mjs';
import { discoverLocalProxies } from './proxy-discovery.mjs';

const hosts = new Set(['oauth2.googleapis.com', 'openidconnect.googleapis.com', 'www.googleapis.com']);
const probes = [
  ['https://oauth2.googleapis.com/token', [400, 404, 405]],
  ['https://openidconnect.googleapis.com/v1/userinfo', [401]],
  ['https://www.googleapis.com/calendar/v3/users/me/calendarList', [401]]
];
// No account credentials are sent while testing the route. An expected HTTP
// rejection proves HTTPS reached Google; it does not mean the user is signed in.
export async function probeGoogleRoute(request) {
  const results = await Promise.all(probes.map(async ([url, statuses]) => {
    try {
      const response = await request(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(4000) });
      const ok = statuses.includes(response.status);
      await response.body?.cancel();
      return ok;
    } catch { return false; }
  }));
  return results.every(Boolean);
}

// Only Google traffic uses this dispatcher; local pages and cookies stay local.
export function createGoogleTransport(proxyUrl = '', request = fetch, dependencies = {}) {
  const mode = proxyUrl === 'auto' ? 'auto' : !proxyUrl || proxyUrl === 'direct' ? 'direct' : 'manual';
  const discover = dependencies.discover || discoverLocalProxies;
  const probe = dependencies.probe || probeGoogleRoute;
  const makeDispatcher = dependencies.makeDispatcher || (url => new ProxyAgent(url));
  const now = dependencies.now || Date.now;
  const dispatchers = new Set();
  let route, checking, checkedAt = 0, closed = false;
  let state = { mode, state: 'unchecked', kind: '', endpoint: '', source: '' };
  function makeRoute(url, source) {
    if (!url) return { url: '', source, request: (url, options) => request(url, { ...options, redirect: 'error' }) };
    let proxy;
    try { proxy = new URL(url); } catch { throw new Error('GOOGLE_PROXY_URL must be auto, direct, or an HTTP(S) proxy URL.'); }
    if (!['http:', 'https:'].includes(proxy.protocol)) throw new Error('GOOGLE_PROXY_URL must be auto, direct, or an HTTP(S) proxy URL.');
    const dispatcher = makeDispatcher(proxy.href); dispatchers.add(dispatcher);
    return { url: proxy.href, source, dispatcher, request: (url, options) => request(url, { ...options, redirect: 'error', dispatcher }) };
  }
  async function retire(candidate, force = false) {
    if (candidate?.dispatcher) {
      await (force && candidate.dispatcher.destroy ? candidate.dispatcher.destroy() : candidate.dispatcher.close()).catch(() => {});
      dispatchers.delete(candidate.dispatcher);
    }
  }
  if (mode !== 'auto') route = makeRoute(mode === 'manual' ? proxyUrl : '', mode === 'manual' ? 'manual' : 'system-network');
  async function chooseRoute() {
    if (mode !== 'auto') return await probe(route.request) ? route : null;
    const candidates = await discover();
    // Bound concurrency; test configured local listeners instead of scanning ports.
    for (let index = 0; index < candidates.length; index += 3) {
      const tested = await Promise.all(candidates.slice(index, index + 3).map(async candidate => {
        const item = makeRoute(candidate.url, candidate.source);
        return { item, ok: await probe(item.request) };
      }));
      const winner = tested.find(result => result.ok)?.item;
      await Promise.all(tested.filter(result => result.item !== winner).map(result => retire(result.item, true)));
      if (winner) return winner;
    }
    // A VPN in TUN mode may already carry the system network without a proxy port.
    const direct = makeRoute('', 'system-network');
    return await probe(direct.request) ? direct : null;
  }
  async function check(force = false) {
    if (closed) throw new CalendarError('GOOGLE_NETWORK_UNAVAILABLE', 502);
    if (checking) return checking;
    if (!force && state.state === 'ready' && now() - checkedAt < 60000) return { ...state };
    if (!force && state.state === 'error' && now() - checkedAt < 5000) throw new CalendarError('GOOGLE_NETWORK_UNAVAILABLE', 502);
    state = { ...state, state: 'checking' };
    checking = (async () => {
      try {
        const next = await chooseRoute();
        if (!next) throw new CalendarError('GOOGLE_NETWORK_UNAVAILABLE', 502);
        const previous = route; route = next;
        if (previous !== route) void retire(previous);
        const endpoint = route.url ? new URL(route.url).host : '';
        state = { mode, state: 'ready', kind: route.url ? 'proxy' : 'system', endpoint, source: route.source };
        checkedAt = now();
        return { ...state };
      } catch {
        state = { mode, state: 'error', kind: '', endpoint: '', source: '' }; checkedAt = now();
        throw new CalendarError('GOOGLE_NETWORK_UNAVAILABLE', 502);
      } finally { checking = null; }
    })();
    return checking;
  }
  return {
    check, status: () => ({ ...state }),
    async request(url, options = {}) {
      const destination = new URL(url);
      if (destination.protocol !== 'https:' || !hosts.has(destination.hostname) || destination.port || destination.username || destination.password) throw new Error('Unexpected Google API destination.');
      if (closed) throw new CalendarError('GOOGLE_NETWORK_UNAVAILABLE', 502);
      if (mode === 'auto') await check();
      const selected = route;
      try { return await selected.request(url, options); }
      catch (error) {
        // Never replay token exchanges or event writes after a network failure.
        // The next user request discovers a fresh route; writes reconcile first.
        if (route === selected) { checkedAt = 0; state = { ...state, state: 'unchecked' }; }
        throw error;
      }
    },
    async close() {
      closed = true;
      if (checking) await checking.catch(() => {});
      await Promise.all([...dispatchers].map(dispatcher => (dispatcher.destroy ? dispatcher.destroy() : dispatcher.close()).catch(() => {})));
      dispatchers.clear();
    }
  };
}
