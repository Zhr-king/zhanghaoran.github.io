import { randomBytes, createHash } from 'node:crypto';
import { CalendarError } from './google-mcp.mjs';

const random = () => randomBytes(32).toString('base64url');
export const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events'];
export class GoogleOAuth {
  constructor(config, request = fetch) { this.config = config; this.request = request; }
  get configured() { return Boolean(this.config.clientId && this.config.clientSecret); }
  begin(session) {
    if (!this.configured) throw new CalendarError('GOOGLE_NOT_CONFIGURED', 503);
    const state = random(), verifier = random();
    session.oauth = { state, verifier, expires: Date.now() + 10 * 60000 };
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri,
      response_type: 'code', scope: SCOPES.join(' '), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' }).toString();
    return url.href;
  }
  async token(fields) {
    const response = await this.request('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...fields }), signal: AbortSignal.timeout(20000)
    });
    const data = await response.json();
    if (!response.ok || typeof data.access_token !== 'string') throw new CalendarError('GOOGLE_AUTH_FAILED', 401);
    return { ...data, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  }
  async finish(session, params) {
    const pending = session.oauth; delete session.oauth;
    if (!pending || pending.expires < Date.now() || params.get('state') !== pending.state || params.has('error') || !params.get('code')) throw new CalendarError('GOOGLE_AUTH_FAILED', 401);
    const tokens = await this.token({ code: params.get('code'), code_verifier: pending.verifier, redirect_uri: this.config.redirectUri, grant_type: 'authorization_code' });
    const response = await this.request('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(20000) });
    const user = await response.json();
    if (!response.ok || typeof user.sub !== 'string') throw new CalendarError('GOOGLE_AUTH_FAILED', 401);
    // Tokens stay in this local service's memory, never in browser storage or on disk.
    session.tokens = tokens; session.user = { id: user.sub, email: user.email || '' };
  }
  async accessToken(session) {
    if (!session.tokens) throw new CalendarError('SIGN_IN_REQUIRED', 401);
    if (session.tokens.expiresAt > Date.now() + 60000) return session.tokens.access_token;
    if (!session.tokens.refresh_token) { delete session.tokens; throw new CalendarError('SIGN_IN_REQUIRED', 401); }
    if (!session.refreshing) session.refreshing = this.token({ grant_type: 'refresh_token', refresh_token: session.tokens.refresh_token })
      .then(next => { session.tokens = { ...session.tokens, ...next }; return session.tokens.access_token; })
      .catch(error => { delete session.tokens; throw error; }).finally(() => { delete session.refreshing; });
    return session.refreshing;
  }
}
