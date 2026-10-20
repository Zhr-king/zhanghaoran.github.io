import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const MCP_URL = 'https://calendarmcp.googleapis.com/mcp/v1';
export class CalendarError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function unpack(result) {
  if (result.isError) throw new CalendarError('MCP_TOOL_FAILED', 502);
  if (result.structuredContent) return result.structuredContent;
  for (const item of result.content || []) {
    if (item.type === 'text') { try { return JSON.parse(item.text); } catch {} }
  }
  throw new CalendarError('MCP_INVALID_RESPONSE', 502);
}
// Calendar MCP may return a recurrence master. Google Calendar's official REST
// API expands instances (including exceptions), using the same OAuth grant.
export async function expandedEvents(token, args, request = fetch) {
  const events = [], seen = new Set(); let pageToken, metadata;
  do {
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(args.calendarId) + '/events');
    url.search = new URLSearchParams({ singleEvents: 'true', timeMin: args.startTime, timeMax: args.endTime, timeZone: args.timeZone, maxResults: '250', ...(pageToken ? { pageToken } : {}) });
    const response = await request(url, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new CalendarError('MCP_TOOL_FAILED', 502);
    metadata = await response.json();
    if (metadata.items !== undefined && !Array.isArray(metadata.items)) throw new CalendarError('MCP_INVALID_RESPONSE', 502);
    events.push(...(metadata.items || [])); pageToken = metadata.nextPageToken;
    if (pageToken && (seen.has(pageToken) || seen.size >= 40)) throw new CalendarError('CALENDAR_TOO_LARGE', 422);
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return { ...metadata, events, nextPageToken: undefined };
}
// Only this fixed, Google-owned endpoint receives OAuth tokens.
export class GoogleMcp {
  constructor(accessToken, transportFactory) { this.accessToken = accessToken; this.transportFactory = transportFactory; }
  async run(work) {
    const token = await this.accessToken();
    const client = new Client({ name: 'forgeos-schedule', version: '0.1.0' });
    const transport = this.transportFactory ? this.transportFactory(token) : new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    });
    try {
      await client.connect(transport, { timeout: 20000 });
      const tools = new Map(), cursors = new Set(); let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 20000 });
        for (const tool of page.tools) tools.set(tool.name.replace(/^calendar\./, ''), tool.name);
        cursor = page.nextCursor;
        if (cursor && (cursors.has(cursor) || cursors.size >= 20)) throw new CalendarError('MCP_INVALID_RESPONSE', 502);
        if (cursor) cursors.add(cursor);
      } while (cursor);
      const call = async (name, args) => {
        if (!tools.has(name)) throw new CalendarError('MCP_TOOL_UNAVAILABLE', 502);
        const result = unpack(await client.callTool({ name: tools.get(name), arguments: args }, undefined, { timeout: 30000 }));
        if (name === 'list_events' && result.events?.some(e => e.recurrence?.length && !e.recurringEventId)) return expandedEvents(token, args);
        return result;
      };
      return await work(call);
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      // Do not expose provider responses, tokens, event text or request headers.
      throw new CalendarError('MCP_CONNECTION_FAILED', 502);
    } finally { await client.close().catch(() => {}); }
  }
}

export async function allPages(call, tool, args, field) {
  const rows = [], seen = new Set(); let pageToken, metadata;
  do {
    const page = await call(tool, { ...args, pageSize: 250, ...(pageToken ? { pageToken } : {}) });
    if (page[field] !== undefined && !Array.isArray(page[field])) throw new CalendarError('MCP_INVALID_RESPONSE', 502);
    rows.push(...(page[field] || [])); metadata = { ...metadata, ...page };
    pageToken = page.nextPageToken;
    if (pageToken && (seen.has(pageToken) || seen.size >= 40)) throw new CalendarError('CALENDAR_TOO_LARGE', 422);
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return { ...metadata, [field]: rows };
}
