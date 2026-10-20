import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { Temporal } from '@js-temporal/polyfill';
import { CalendarError, allPages } from './google-mcp.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, status = 422) => { throw new CalendarError(code, status); };
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 300;
const overlap = (a, b) => a.start < b.end && b.start < a.end;
const eventValue = result => result.event || result;
function instant(value, zone) {
  if (value?.dateTime) return Temporal.Instant.from(value.dateTime).epochMilliseconds;
  if (value?.date) return Temporal.PlainDate.from(value.date.slice(0, 10)).toZonedDateTime(value.timeZone || zone).epochMilliseconds;
  fail('CALENDAR_INVALID_EVENT');
}
export function normalizeEvent(event, calendarId, zone) {
  if (event.status === 'cancelled' || event.attendees?.some(a => a.self && a.responseStatus === 'declined')) return null;
  if (event.recurrence?.length && !event.recurringEventId) fail('UNEXPANDED_RECURRENCE');
  try {
    const start = instant(event.start, zone), end = instant(event.end, zone);
    if (!safeId(event.id) || !(end > start)) fail('CALENDAR_INVALID_EVENT');
    return { id: event.id, calendarId, title: event.summary || 'Untitled', start, end,
      allDay: Boolean(event.start.date), busy: event.transparency !== 'transparent' && event.availability !== 'AVAILABILITY_FREE',
      colorId: event.colorId || '', location: event.location || '', htmlLink: event.htmlLink || '' };
  } catch (error) { if (error instanceof CalendarError) throw error; fail('CALENDAR_INVALID_EVENT'); }
}
export function validateWindow(input) {
  if (!input || !safeId(input.calendarId)) fail('INVALID_CALENDAR_SELECTION');
  const start = Date.parse(input.startTime), end = Date.parse(input.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 32 * 86400000) fail('INVALID_WINDOW');
  if (typeof input.timeZone !== 'string' || !input.timeZone) fail('INVALID_TIMEZONE');
  try { Temporal.Now.zonedDateTimeISO(input.timeZone); } catch { fail('INVALID_TIMEZONE'); }
  return { calendarId: input.calendarId, startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(), timeZone: input.timeZone };
}
export class Journal {
  constructor(directory) { this.directory = directory; }
  async load(userId) {
    try {
      const value = JSON.parse(await readFile(path.join(this.directory, hash(userId) + '.json'), 'utf8'));
      if (value.version !== 1 || !value.records || typeof value.records !== 'object') fail('JOURNAL_INVALID', 500);
      return value.records;
    } catch (error) { if (error.code === 'ENOENT') return {}; throw new CalendarError('JOURNAL_INVALID', 500); }
  }
  async save(userId, records) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const destination = path.join(this.directory, hash(userId) + '.json'), temporary = destination + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify({ version: 1, records }), { mode: 0o600 });
    await rename(temporary, destination);
  }
}
export class CalendarService {
  constructor(journal) { this.journal = journal; this.writing = false; }
  async calendars(mcp) {
    return mcp.run(async call => (await allPages(call, 'list_calendars', {}, 'calendars')).calendars.map(c => ({ id: c.id, title: c.summary || c.id, timeZone: c.timeZone })));
  }
  async snapshot(call, input) {
    const options = validateWindow(input);
    const calendars = (await allPages(call, 'list_calendars', {}, 'calendars')).calendars;
    if (!calendars.some(c => c.id === options.calendarId)) fail('CALENDAR_NOT_ACCESSIBLE', 403);
    const page = await allPages(call, 'list_events', options, 'events');
    if (!['reader', 'writer', 'owner'].includes(page.accessRole)) fail('CALENDAR_NOT_READABLE', 403);
    const unique = new Map();
    for (const item of page.events) {
      const event = normalizeEvent(item, options.calendarId, page.timeZone || options.timeZone);
      if (event && event.end > Date.parse(options.startTime) && event.start < Date.parse(options.endTime)) unique.set(event.id, event);
    }
    return { ...options, events: [...unique.values()].sort((a, b) => a.start - b.start), canWrite: ['writer', 'owner'].includes(page.accessRole) };
  }
  async read(mcp, userId, input) { return mcp.run(call => this.snapshot(call, input)); }
  async create(mcp, userId, input) {
    const thisService = this;
    const options = validateWindow(input);
    if (!/^[a-f0-9-]{36}$/i.test(input.requestId || '') || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300 || typeof input.description !== 'string' || input.description.length > 8000 || typeof input.location !== 'string' || input.location.length > 1000) fail('INVALID_EVENT');
    const payload = { ...options, title: input.title.trim(), description: input.description, location: input.location.trim() };
    const key = hash(input.requestId), signature = hash(payload);
    if (this.writing) fail('WRITE_IN_PROGRESS', 409);
    this.writing = true;
    let attempted = false, creating = false, records;
    try {
      records = await this.journal.load(userId);
      let record = records[key];
      if (record && record.signature !== signature) fail('REQUEST_CHANGED', 409);
      if (record?.result) return record.result;
      return await mcp.run(async call => {
        if (record) {
          // A timed-out create may already exist. Never blindly repeat it.
          const rows = record.eventId ? [eventValue(await call('get_event', { calendarId: options.calendarId, eventId: record.eventId }))]
            : (await allPages(call, 'list_events', options, 'events')).events.filter(e => e.description?.includes(record.marker));
          const matches = rows.filter(e => e.description?.includes(record.marker));
          if (matches.length !== 1) fail('UNCERTAIN_WRITE', 409);
          return await finish(matches[0]);
        }
        const snapshot = await this.snapshot(call, options);
        if (!snapshot.canWrite) fail('CALENDAR_READ_ONLY', 403);
        const interval = { start: Date.parse(options.startTime), end: Date.parse(options.endTime) };
        const conflicts = snapshot.events.filter(e => e.busy && overlap(e, interval));
        record = { signature, marker: '[ForgeOS:' + hash([userId, input.requestId]) + ']', conflicts };
        records[key] = record;
        await this.journal.save(userId, records);
        attempted = true;
        creating = true;
        const result = eventValue(await call('create_event', {
          calendarId: options.calendarId, summary: payload.title,
          startTime: options.startTime, endTime: options.endTime, timeZone: 'UTC',
          description: payload.description + '\n\n' + record.marker, location: payload.location,
          ...(conflicts.length ? { colorId: '11' } : {})
        }));
        creating = false;
        if (!safeId(result.id)) fail('UNCERTAIN_WRITE', 502);
        record.eventId = result.id; await this.journal.save(userId, records);
        return await finish(eventValue(await call('get_event', { calendarId: options.calendarId, eventId: result.id })));
        async function finish(event) {
          const normalized = normalizeEvent(event, options.calendarId, 'UTC');
          if (!normalized || !event.description?.includes(record.marker) || normalized.start !== Date.parse(options.startTime) || normalized.end !== Date.parse(options.endTime) || event.summary !== payload.title || (record.conflicts.length && event.colorId !== '11')) fail('UNCERTAIN_WRITE', 502);
          record.eventId = event.id;
          record.result = { event: normalized, conflicts: record.conflicts, overlap: Boolean(record.conflicts.length) };
          await thisService.journal.save(userId, records);
          return record.result;
        }
      });
    } catch (error) {
      if (creating && error.writeRejected) {
        delete records[key];
        try { await this.journal.save(userId, records); }
        catch { throw new CalendarError('UNCERTAIN_WRITE', 502); }
        throw error;
      }
      if (attempted) throw new CalendarError('UNCERTAIN_WRITE', 502);
      throw error;
    } finally { this.writing = false; }
  }
}
