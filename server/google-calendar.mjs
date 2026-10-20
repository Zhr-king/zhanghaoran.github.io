import { CalendarError } from './google-mcp.mjs';

// Standard Calendar v3 works with a personal Google account. No remote MCP
// preview enrollment or Workspace subscription is involved in this adapter.
export class GoogleCalendar {
  constructor(accessToken, request = fetch) { this.accessToken = accessToken; this.request = request; }
  async run(work) {
    const token = await this.accessToken();
    const request = async (resource, parameters = {}, body) => {
      const url = new URL('https://www.googleapis.com/calendar/v3/' + resource);
      for (const [key, value] of Object.entries(parameters)) if (value !== undefined) url.searchParams.set(key, String(value));
      let response;
      try {
        response = await this.request(url, {
          method: body === undefined ? 'GET' : 'POST', redirect: 'error',
          headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000)
        });
      } catch { throw new CalendarError('CALENDAR_CONNECTION_FAILED', 502); }
      let data;
      try { data = await response.json(); } catch { throw new CalendarError('CALENDAR_INVALID_RESPONSE', 502); }
      if (!response.ok) {
        const reasons = data?.error?.errors?.map(item => item.reason) || [];
        let code = 'CALENDAR_API_FAILED', status = 502;
        if (response.status === 401) { code = 'SIGN_IN_REQUIRED'; status = 401; }
        else if (response.status === 429 || reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'].includes(reason))) { code = 'CALENDAR_RATE_LIMITED'; status = 429; }
        else if (response.status === 403) { code = reasons.includes('accessNotConfigured') ? 'CALENDAR_API_DISABLED' : 'CALENDAR_ACCESS_DENIED'; status = 403; }
        else if (response.status === 404) { code = 'CALENDAR_NOT_ACCESSIBLE'; status = 404; }
        else if (response.status === 400) { code = 'INVALID_EVENT'; status = 422; }
        const error = new CalendarError(code, status);
        // Google explicitly rejected these requests. A network timeout / 5xx
        // remains uncertain and must still be reconciled by CalendarService.
        error.writeRejected = [400, 401, 403, 404, 429].includes(response.status);
        throw error;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CalendarError('CALENDAR_INVALID_RESPONSE', 502);
      return data;
    };
    return work(async (name, args) => {
      const calendarPath = 'calendars/' + encodeURIComponent(args.calendarId) + '/events';
      if (name === 'list_calendars') {
        const data = await request('users/me/calendarList', { maxResults: args.pageSize, pageToken: args.pageToken });
        return { ...data, calendars: data.items ?? [] };
      }
      if (name === 'list_events') {
        const data = await request(calendarPath, { timeMin: args.startTime, timeMax: args.endTime, timeZone: args.timeZone,
          singleEvents: true, maxResults: args.pageSize, pageToken: args.pageToken });
        return { ...data, events: data.items ?? [] };
      }
      if (name === 'get_event') return request(calendarPath + '/' + encodeURIComponent(args.eventId));
      if (name === 'create_event') return request(calendarPath, {}, {
        summary: args.summary, description: args.description, location: args.location,
        start: { dateTime: args.startTime, timeZone: args.timeZone }, end: { dateTime: args.endTime, timeZone: args.timeZone },
        ...(args.colorId ? { colorId: args.colorId } : {})
      });
      throw new CalendarError('CALENDAR_OPERATION_UNAVAILABLE', 400);
    });
  }
}
