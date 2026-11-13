/**
 * DEF-463 (owner 13 Nov: "none of email should be missed"; Wiki-Knowledge §0.12.1). Pinned:
 *  COMPARE   the day's inbox and sent ids from Gmail against what the Wiki holds;
 *  LAND      a missing inbox email through the feed ingest (triage judges it); a missing sent email through the Wiki's
 *            intake with no feed row, marked attention {class:'own'} by landing:sent;
 *  RECORD    one 'record' source per day ('mailbox-census:gmail:<day>') with the counts;
 *  DAY       his local day's bounds, today and yesterday.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let heldIds = new Set<string>();
const saveSource = vi.fn(async () => ({ id: 'rec', created: true }));
vi.mock('../src/services/wiki/wikiSources', () => ({
  sourceId: (_c: string, _u: number, _k: string, g: string) => `src_${g}`,
  sourcesHeld: async (_c: string, _u: number, ids: string[]) => new Map(ids.filter((i) => heldIds.has(i)).map((i) => [i, { hasText: true }])),
  saveSource: (...a: any[]) => (saveSource as any)(...a),
}));
const landEmailText = vi.fn(async (p: any) => { heldIds.add(`src_${p.gmailMessageId}`); return `src_${p.gmailMessageId}`; });
vi.mock('../src/services/wiki/wikiIntake', () => ({ landEmailText: (...a: any[]) => (landEmailText as any)(...a) }));
const markSource = vi.fn(async () => ({ changed: true }));
vi.mock('../src/services/wiki/wikiStore', () => ({ markSource: (...a: any[]) => (markSource as any)(...a), countUnmarked: async () => ({ total: 4, unmarked: 1 }) }));
const ingest = vi.fn(async (i: any) => { heldIds.add(`src_${i.sourceId}`); return { status: 'new' }; });
vi.mock('../src/services/feed/feedIngestionService', () => ({ ingest: (...a: any[]) => (ingest as any)(...a) }));
vi.mock('../src/db/prisma', () => ({ default: {} }));

import { censusDay, dayBounds, daysToCheck, SENT_MARK_BY } from '../src/jobs/mailboxCensusJob';

const deps = {
  ids: { list: async (box: 'INBOX' | 'SENT') => (box === 'INBOX' ? ['i1', 'i2'] : ['s1', 's2']) },
  readEmail: async (_u: number, id: string) => ({ email: { id, threadId: `t_${id}`, from: id.startsWith('s') ? 'me@x.com' : 'a@x.com', to: 'b@x.com', cc: '', subject: `S ${id}`, snippet: 'snip', date: 'Thu, 13 Nov 2026 09:00:00 +0500', body: 'full text' } }),
};
beforeEach(() => { heldIds = new Set(['src_i1', 'src_s1']); saveSource.mockClear(); landEmailText.mockClear(); markSource.mockClear(); ingest.mockClear(); });

describe('the daily check', () => {
  it('lands what is missing by the right door, marks sent mail own, and records the day', async () => {
    const r = await censusDay({ clientNumber: 'T', userId: 2 }, '2026-11-13', 'Asia/Karachi', deps as any, { late: 50 });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect((ingest.mock.calls[0] as any[])[0]).toMatchObject({ sourceType: 'gmail', sourceId: 'i2' });
    expect(landEmailText).toHaveBeenCalledTimes(1);
    expect((landEmailText.mock.calls[0] as any[])[0]).toMatchObject({ gmailMessageId: 's2', bodyText: 'full text', from: 'me@x.com', labels: ['SENT'] });
    expect(markSource).toHaveBeenCalledWith({ clientNumber: 'T', userId: 2 }, 'src_s1', { kind: 'attention', value: { class: 'own' }, by: SENT_MARK_BY });
    expect(markSource).toHaveBeenCalledWith({ clientNumber: 'T', userId: 2 }, 'src_s2', { kind: 'attention', value: { class: 'own' }, by: SENT_MARK_BY });
    expect(r).toMatchObject({ inbox: 2, sent: 2, held: 4, stillMissing: 0, fetchedLate: ['i2', 's2'], marked: 3, unmarked: 1 });
    const rec = (saveSource.mock.calls[0] as any[])[0];
    expect(rec).toMatchObject({ kind: 'record', externalId: 'mailbox-census:gmail:2026-11-13', details: { type: 'mailbox_census', in_mailbox: { inbox: 2, sent: 2 }, held: 4, still_missing: 0 } });
  });
  it('a run past its budget counts the rest as still missing', async () => {
    const r = await censusDay({ clientNumber: 'T', userId: 2 }, '2026-11-13', 'Asia/Karachi', deps as any, { late: 1 });
    expect(r.fetchedLate).toHaveLength(1);
    expect(r.stillMissing).toBe(1);
  });
});

describe('his day', () => {
  it('bounds are his local midnight to midnight; today and yesterday are checked', () => {
    const { start, end } = dayBounds('2026-11-13', 'Asia/Karachi');
    expect(start.toISOString()).toBe('2026-11-12T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-13T19:00:00.000Z');
    expect(daysToCheck(new Date('2026-11-13T09:00:00Z'), 'Asia/Karachi')).toEqual(['2026-11-12', '2026-11-13']);
  });
});
