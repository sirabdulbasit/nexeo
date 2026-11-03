/**
 * DEF-385 — owner on Suzi, 2026-11-03 12:47 PKT: "Brief my day" → "I can't access
 * your calendar right now". His Google Calendar was connected in Nexeo; Suzi's
 * calendar tool was a NOT_CONNECTED stub. Nexeo's half: a read-only day-brief
 * route that gives Suzi's server the brief as facts in present_report-shaped blocks.
 *
 * Pinned:
 *  1. meetings are TODAY in the user's zone: dedup by eventId, all-day first, then by start;
 *     yesterday's and tomorrow's events are dropped (DST-free zone check via Asia/Karachi);
 *  2. a bad timezone falls back instead of throwing;
 *  3. the route refuses anything not loopback-direct (Apache adds X-Forwarded-For);
 *  4. the route refuses a wrong or missing secret, and a user outside the named tenant;
 *  5. the brief carries no wording: no `say` field anywhere (Suzi's model writes it);
 *  6. a disconnected calendar is reported as not connected, never as an empty day.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const findUnique = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { user: { findUnique: (...a: any[]) => findUnique(...a) } } }));
const verify = vi.fn();
vi.mock('../src/services/suzi/gatewayAdminClient', () => ({ verifyGatewaySecret: (t: any) => verify(t) }));
const build = vi.fn();
vi.mock('../src/services/suzi/dayBriefFacts', async (orig) => {
  const real: any = await (orig as any)();
  return { ...real, buildDayBriefFacts: (...a: any[]) => build(...a) };
});

import { meetingsForDay, safeTimezone, localDate } from '../src/services/suzi/dayBriefFacts';
import router, { isLoopbackDirect } from '../src/routes/suziGatewayRoutes';

const app = express();
app.use('/suzi/gateway', router);

beforeEach(() => {
  findUnique.mockReset(); verify.mockReset(); build.mockReset();
  verify.mockImplementation(async (t: string | undefined) => t === 'right-secret');
  findUnique.mockResolvedValue({ clientNumber: 'TMC-0001', isActive: true });
  build.mockResolvedValue({ date: '2026-11-03', timezone: 'Asia/Karachi', generatedAt: 'x', sources: { calendar: true, email: true, businessKpis: false }, blocks: [{ type: 'kpis', items: [] }, { type: 'list', items: [] }] });
});

describe('DEF-385 meetings are today in the user\'s zone', () => {
  const tz = 'Asia/Karachi';
  it('dedups by eventId, keeps only today, all-day first then by start time', () => {
    const out = meetingsForDay([
      { eventId: 'b', title: 'TMC System Catalogue -> BigQuery', start: '2026-11-03T16:00:00+05:00', attendees: [1, 2, 3, 4] },
      { eventId: 'b', title: 'TMC System Catalogue -> BigQuery', start: '2026-11-03T16:00:00+05:00', attendees: [1, 2, 3, 4] },
      { eventId: 'a', title: 'UAT session', start: '2026-11-03T15:00:00+05:00', attendees: [1, 2, 3, 4, 5, 6, 7] },
      { eventId: 'o', title: 'Office', start: '2026-11-03', isAllDay: true },
      { eventId: 'y', title: 'Yesterday', start: '2026-11-02T23:30:00+05:00' },
      { eventId: 't', title: 'Tomorrow', start: '2026-11-04T00:30:00+05:00' },
      { eventId: 'z', title: 'Late UTC, still today in PKT', start: '2026-11-03T18:30:00Z' },
    ], '2026-11-03', tz);
    expect(out.map((m) => m.title)).toEqual(['Office', 'UAT session', 'TMC System Catalogue -> BigQuery', 'Late UTC, still today in PKT']);
    expect(out[1]).toMatchObject({ time: '15:00', attendees: 7 });
    expect(out[0]).toMatchObject({ time: 'all day', allDay: true });
  });
  it('a bad timezone falls back instead of throwing', () => {
    expect(safeTimezone('Not/AZone')).toBe('Asia/Karachi');
    expect(safeTimezone('Europe/London')).toBe('Europe/London');
    expect(localDate(new Date('2026-11-03T20:00:00Z'), 'Asia/Karachi')).toBe('2026-11-04');
  });
});

describe('DEF-385 the gateway route trusts only the gateway', () => {
  it('Apache-forwarded requests are refused even with the right secret', async () => {
    const r = await request(app).get('/suzi/gateway/day-brief?user_id=2&tenant_id=TMC-0001')
      .set('Authorization', 'Bearer right-secret').set('X-Forwarded-For', '203.0.113.9');
    expect(r.status).toBe(403);
    expect(build).not.toHaveBeenCalled();
  });
  it('isLoopbackDirect: only a direct loopback socket qualifies', () => {
    expect(isLoopbackDirect({ headers: {}, socket: { remoteAddress: '127.0.0.1' } } as any)).toBe(true);
    expect(isLoopbackDirect({ headers: {}, socket: { remoteAddress: '10.0.0.5' } } as any)).toBe(false);
    expect(isLoopbackDirect({ headers: { 'x-forwarded-for': '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } } as any)).toBe(false);
  });
  it('a wrong or missing secret is 401', async () => {
    expect((await request(app).get('/suzi/gateway/day-brief?user_id=2&tenant_id=TMC-0001')).status).toBe(401);
    expect((await request(app).get('/suzi/gateway/day-brief?user_id=2&tenant_id=TMC-0001').set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect(build).not.toHaveBeenCalled();
  });
  it('a user outside the named tenant is 404, never served', async () => {
    findUnique.mockResolvedValue({ clientNumber: 'OTHER-01', isActive: true });
    const r = await request(app).get('/suzi/gateway/day-brief?user_id=2&tenant_id=TMC-0001').set('Authorization', 'Bearer right-secret');
    expect(r.status).toBe(404);
    expect(build).not.toHaveBeenCalled();
  });
  it('the right secret, loopback, matching tenant → the facts for THAT user and tenant', async () => {
    const r = await request(app).get('/suzi/gateway/day-brief?user_id=2&tenant_id=TMC-0001&timezone=Asia/Karachi').set('Authorization', 'Bearer right-secret');
    expect(r.status).toBe(200);
    expect(build).toHaveBeenCalledWith('TMC-0001', 2, { timezone: 'Asia/Karachi' });
    expect(JSON.stringify(r.body)).not.toContain('"say"');
  });
});

describe('DEF-385 the facts carry no wording and report a missing calendar as missing', () => {
  it('buildDayBriefFacts source: no say field, and meetings say not connected when the calendar is not', async () => {
    const fs = await import('fs'); const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/services/suzi/dayBriefFacts.ts'), 'utf8');
    expect(src).not.toMatch(/\bsay\s*:/);
    expect(src).toContain("value: calendar ? meetings.length : 'not connected'");
    expect(src).toContain("type: 'list', id: 'meetings', title: 'Meetings today', connected: calendar");
  });
  it('emails come from My Attention (the Day Brief partition), capped so a cold build reports loading, not 0', async () => {
    const fs = await import('fs'); const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/services/suzi/dayBriefFacts.ts'), 'utf8');
    expect(src).toContain("computeBriefPartition(clientNumber, userId, 100, 100)");
    expect(src).toContain("filter((i) => i.itemType === 'email')");
    expect(src).toMatch(/Promise\.race\(\[\s*computeBriefPartition/);
    expect(src).toContain("emailsLoading ? 'still loading' : emailsNeedingReply");
  });
});
