import { Agent, ProxyAgent, fetch as googleFetch } from 'undici';
import { CalendarError } from './google-mcp.mjs';
import { resolveSystemProxy, proxyUrl as normalizeProxy } from './proxy-discovery.mjs';

const hosts = new Set(['oauth2.googleapis.com', 'openidconnect.googleapis.com', 'www.googleapis.com']);
export const NETWORK_ERRORS = new Set(['GOOGLE_NETWORK_UNAVAILABLE', 'GOOGLE_PROXY_UNAVAILABLE',
  'GOOGLE_PROXY_AUTH_REQUIRED', 'GOOGLE_PROXY_CONFIGURATION_FAILED', 'GOOGLE_REQUEST_TIMEOUT', 'GOOGLE_TLS_FAILED']);

function networkError(error, proxy) {
  if (NETWORK_ERRORS.has(error.code)) return error;
  const codes = [error.code, error.cause?.code, error.name];
  let code = 'GOOGLE_NETWORK_UNAVAILABLE';
  if (codes.some(c => ['TimeoutError', 'AbortError', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'ETIMEDOUT'].includes(c))) code = 'GOOGLE_REQUEST_TIMEOUT';
  else if (codes.some(c => /CERT|TLS|SELF_SIGNED/.test(c || ''))) code = 'GOOGLE_TLS_FAILED';
  else if (proxy && /407/.test(String(error.cause?.message || error.message))) code = 'GOOGLE_PROXY_AUTH_REQUIRED';
  else if (proxy && codes.includes('ECONNREFUSED')) code = 'GOOGLE_PROXY_UNAVAILABLE';
  return new CalendarError(code, 502);
}

// Resolve settings lazily, then send the ONE requested Google operation.
// Authentication and writes are never preceded by probes or automatically replayed.
export function createGoogleTransport(proxyUrl = 'auto', request = googleFetch, dependencies = {}) {
  const mode = !proxyUrl || proxyUrl === 'auto' ? 'auto' : proxyUrl === 'direct' ? 'direct' : 'manual';
  const resolve = dependencies.resolve || resolveSystemProxy;
  const makeDispatcher = dependencies.makeDispatcher || (url => url ? new ProxyAgent(url) : new Agent());
  const now = dependencies.now || Date.now;
  const routes = new Map(), resolving = new Map(), dispatchers = new Map();
  const manual = mode === 'manual' ? normalizeProxy(proxyUrl) : '';
  let closed = false;
  let state = { mode, state: 'idle', kind: '', source: '', error: '' };
  async function routeFor(destination) {
    if (mode !== 'auto') return { url: manual, source: mode === 'manual' ? 'manual' : 'system' };
    const key = destination.origin, cached = routes.get(key);
    if (cached && now() - cached.at < 5000) return cached.route;
    if (resolving.has(key)) return resolving.get(key);
    const pending = Promise.resolve().then(() => resolve(destination)).then(route => {
      const selected = { url: route.url ? normalizeProxy(route.url) : '', source: route.source };
      routes.set(key, { route: selected, at: now() });
      return selected;
    }).finally(() => resolving.delete(key));
    resolving.set(key, pending);
    return pending;
  }
  return {
    status: () => ({ ...state }),
    async request(url, options = {}) {
      const destination = new URL(url);
      if (destination.protocol !== 'https:' || !hosts.has(destination.hostname) || destination.port || destination.username || destination.password) throw new Error('Unexpected Google API destination.');
      if (closed) throw new CalendarError('GOOGLE_NETWORK_UNAVAILABLE', 502);
      let selected;
      try {
        selected = await routeFor(destination);
        if (closed) throw new CalendarError('GOOGLE_NETWORK_UNAVAILABLE', 502);
        options.signal?.throwIfAborted();
        let dispatcher = dispatchers.get(selected.url);
        if (!dispatcher) { dispatcher = makeDispatcher(selected.url); dispatchers.set(selected.url, dispatcher); }
        state = { mode, state: 'requesting', kind: selected.url ? 'proxy' : 'system', source: selected.source, error: '' };
        const response = await request(url, { ...options, dispatcher, redirect: 'error', signal: options.signal || AbortSignal.timeout(20000) });
        state = { ...state, state: 'ready' };
        return response;
      } catch (error) {
        routes.delete(destination.origin);
        const failure = networkError(error, !!selected?.url);
        state = { ...state, state: 'error', error: failure.code };
        throw failure;
      }
    },
    async close() {
      closed = true;
      await Promise.allSettled([...resolving.values()]);
      await Promise.allSettled([...dispatchers.values()].map(dispatcher => dispatcher.destroy()));
      dispatchers.clear(); routes.clear();
    }
  };
}
