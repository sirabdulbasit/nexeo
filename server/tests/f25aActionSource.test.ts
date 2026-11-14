/**
 * F-2.5a (charter, agreed 13 Nov 2026; founder: "from where it comes?"): each pending action carries where it came
 * from, for Suzi's "From" line. Left out when unknown, never guessed; never body text; subject at most 120.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ feeds: [] as any[], wiki: [] as any[], fail: false }));
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: async (q: string) => { if (s.fail) throw new Error('db'); return /wiki_sources/.test(q) ? s.wiki : s.feeds; } } }));

import { actionSources, displayFrom } from '../src/services/suzi/actionSource';

const TZ = 'Asia/Karachi';
beforeEach(() => { s.feeds = []; s.wiki = []; s.fail = false; });

describe('F-2.5a actions[].source', () => {
  it('display name from the sender, else the address', () => {
    expect(displayFrom(null, '"Finance @ Tridorian" <messaging-service@post.xero.com>')).toBe('Finance @ Tridorian');
    expect(displayFrom(null, 'Mirza Nabeel <mirza.nabeel@tmcltd.com>')).toBe('Mirza Nabeel');
    expect(displayFrom(null, 'mirza.nabeel@tmcltd.com')).toBe('mirza.nabeel@tmcltd.com');
    expect(displayFrom('Sofia Rana', 'sofia@x.com')).toBe('Sofia Rana');
    expect(displayFrom(null, null)).toBeNull();
  });
  it('email: from, subject (≤120), at with the offset, thread id; no body', async () => {
    s.feeds = [{ id: 'fe1', source_type: 'gmail', sender_name: null, sender_email: '"Finance @ Tridorian" <m@post.xero.com>', subject: 'Invoice INV-4770 ' + 'x'.repeat(200), from_raw: null, thread_id: 't1', event_at: new Date('2026-11-10T05:00:00Z'), created_at: null }];
    const m = await actionSources('TMC-0001', 2, [{ id: 'a', sourceFeed: 'gmail', sourceFeedEventId: 'fe1', metadata: { derivedFrom: { threadId: 'x' } } }], TZ);
    const src = m.get('a')!;
    expect(src).toMatchObject({ kind: 'email', from: 'Finance @ Tridorian', at: '2026-11-10T10:00:00+05:00', thread_id: 't1' });
    expect(src.subject!.length).toBe(120);
    expect(Object.keys(src).sort()).toEqual(['at', 'from', 'kind', 'subject', 'thread_id']);
  });
  it('the feed id can come from derivedFrom', async () => {
    s.feeds = [{ id: 'fe2', source_type: 'gmail', sender_name: 'Nabeel', sender_email: null, subject: 'RE: login', from_raw: null, thread_id: null, event_at: null, created_at: new Date('2026-11-11T07:00:00Z') }];
    const m = await actionSources('TMC-0001', 2, [{ id: 'b', sourceFeed: 'gmail', metadata: { derivedFrom: { feedEventId: 'fe2', threadId: 'th2' } } }], TZ);
    expect(m.get('b')).toEqual({ kind: 'email', from: 'Nabeel', subject: 'RE: login', at: '2026-11-11T12:00:00+05:00', thread_id: 'th2' });
  });
  it('suzi / manual: the kind and when it was made', async () => {
    const m = await actionSources('TMC-0001', 2, [{ id: 'c', sourceFeed: 'suzi', createdAt: new Date('2026-11-12T04:00:00Z') }, { id: 'd', sourceFeed: 'manual', createdAt: null }], TZ);
    expect(m.get('c')).toEqual({ kind: 'suzi', at: '2026-11-12T09:00:00+05:00' });
    expect(m.get('d')).toEqual({ kind: 'manual' });
  });
  it('meeting: the meeting id and when it was held', async () => {
    const m = await actionSources('TMC-0001', 2, [{ id: 'e', sourceFeed: 'meeting', sourceRef: 'mm1', metadata: { source: { kind: 'meeting', meetingMinutesId: 'mm1', heldAt: '2026-11-12T06:00:00Z' } } }], TZ);
    expect(m.get('e')).toEqual({ kind: 'meeting', meeting_id: 'mm1', at: '2026-11-12T11:00:00+05:00' });
  });
  it('unknown origin, or a feed read that fails: no source, never a guess', async () => {
    s.fail = true;
    const m = await actionSources('TMC-0001', 2, [{ id: 'f', sourceFeed: 'gmail', sourceFeedEventId: 'fe9' }, { id: 'g', sourceFeed: 'commitment', sourceRef: 'email:1' }, { id: 'h', sourceFeed: null }], TZ);
    expect(m.size).toBe(0);
  });
  it('Wiki first: the exact message (by feed id or message id) wins over the feed row', async () => {
    s.wiki = [{ feed_event_id: null, external_id: 'msg1', thread_key: 'th1', title: '\uFEFFPBC Order Details', from_raw: 'Reganon, Pedro <p@sap.com>', occurred_at: new Date('2026-11-06T12:19:13Z') }];
    s.feeds = [{ id: 'fe1', source_type: 'gmail', sender_name: 'Someone Else', sender_email: null, subject: 'other', from_raw: null, thread_id: 'th1', event_at: null, created_at: null }];
    const m = await actionSources('TMC-0001', 2, [{ id: 'a', sourceFeed: 'gmail', sourceRef: 'msg1', sourceFeedEventId: 'fe1' }], TZ);
    expect(m.get('a')).toEqual({ kind: 'email', from: 'Reganon, Pedro', subject: 'PBC Order Details', at: '2026-11-06T17:19:13+05:00', thread_id: 'th1' });
  });
  it('feed row gone, Wiki has only the thread: subject and thread, no from, no at', async () => {
    s.wiki = [{ feed_event_id: 'other', external_id: 'm9', thread_key: '19e2a9d00b51a95a', title: 'Re: Din Textile - Way forward', from_raw: 'Kashif <k@x>', occurred_at: new Date() }];
    const m = await actionSources('TMC-0001', 2, [{ id: 'b', sourceFeed: 'gmail', sourceRef: 'gone', sourceFeedEventId: 'gone-fe', metadata: { derivedFrom: { threadId: '19e2a9d00b51a95a' } } }], TZ);
    expect(m.get('b')).toEqual({ kind: 'email', subject: 'Re: Din Textile - Way forward', thread_id: '19e2a9d00b51a95a' });
  });
});
