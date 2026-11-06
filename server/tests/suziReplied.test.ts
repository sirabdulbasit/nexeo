/**
 * Link T23 (both AGREE, 6 Nov 2026): has he already answered this email? Pinned:
 *  1. answered = his latest SENT message on the thread is newer than anyone else's latest; drafts don't count;
 *     someone writing after him puts it back;
 *  2. the list of emails to answer leaves answered threads out, and says per email whether Gmail was asked;
 *  3. anything not known in time, or not a Gmail thread, or with Gmail unreachable, is "not checked", never "not answered";
 *  4. Gmail is asked with one Sent list, and a thread is read only when he has sent something on it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/prisma', () => ({ default: {} }));
vi.mock('../src/services/integrationService', () => ({ getAuthenticatedClient: async () => ({ client: null, error: 'test' }) }));
const partition = vi.fn();
vi.mock('../src/services/triage/briefPartitionService', () => ({ computeBriefPartition: (...a: any[]) => partition(...a) }));

import { repliedAt, replyStates, replyStateOf, setGmailFactory, type GmailLike } from '../src/services/suzi/suziReplied';
import { loadAttentionEmails } from '../src/services/suzi/dayBriefFacts';

const T = (iso: string) => String(Date.parse(iso));
const SENT = (iso: string) => ({ labelIds: ['SENT'], internalDate: T(iso) });
const IN = (iso: string) => ({ labelIds: ['INBOX'], internalDate: T(iso) });

function fakeGmail(sentThreads: string[], threads: Record<string, any[]>, opts: { listFails?: boolean; slowThread?: string } = {}) {
  const list = vi.fn(async (_p: any) => {
    if (opts.listFails) throw new Error('quota');
    return { data: { messages: sentThreads.map((threadId) => ({ id: `m-${threadId}`, threadId })) } };
  });
  const get = vi.fn(async (p: any) => {
    if (p.id === opts.slowThread) await new Promise((r) => setTimeout(r, 200));
    return { data: { messages: threads[p.id] ?? [] } };
  });
  const gmail: GmailLike = { users: { messages: { list }, threads: { get } } };
  return { gmail, list, get };
}

let now = 1_000_000;
beforeEach(() => { partition.mockReset(); now += 60_000; });

describe('repliedAt', () => {
  it('his reply after the email: answered, at the time he sent it', () => {
    expect(repliedAt([IN('2026-11-06T05:00:00Z'), SENT('2026-11-06T06:00:00Z')])).toBe('2026-11-06T06:00:00.000Z');
  });
  it('someone wrote after him: not answered', () => {
    expect(repliedAt([IN('2026-11-06T05:00:00Z'), SENT('2026-11-06T06:00:00Z'), IN('2026-11-06T07:00:00Z')])).toBeNull();
  });
  it('a draft is not a reply', () => {
    expect(repliedAt([IN('2026-11-06T05:00:00Z'), { labelIds: ['DRAFT'], internalDate: T('2026-11-06T06:00:00Z') }])).toBeNull();
  });
  it('nothing sent: not answered', () => {
    expect(repliedAt([IN('2026-11-06T05:00:00Z')])).toBeNull();
  });
});

describe('replyStates (the list)', () => {
  it('one Sent list; a thread is read only when he has sent on it', async () => {
    const f = fakeGmail(['a', 'b'], { a: [IN('2026-11-06T05:00:00Z'), SENT('2026-11-06T06:00:00Z')], b: [SENT('2026-11-06T04:00:00Z'), IN('2026-11-06T05:00:00Z')] });
    setGmailFactory(async () => f.gmail);
    const s = await replyStates(2, ['a', 'b', 'c', null], { now });
    expect(s.get('a')).toEqual({ replied_at: '2026-11-06T06:00:00.000Z', reply_checked: true });
    expect(s.get('b')).toEqual({ replied_at: null, reply_checked: true });
    expect(s.get('c')).toEqual({ replied_at: null, reply_checked: true });
    expect(f.list).toHaveBeenCalledTimes(1);
    expect(f.list.mock.calls[0][0].q).toBe('in:sent newer_than:8d');
    expect(f.get.mock.calls.map((c: any[]) => c[0].id).sort()).toEqual(['a', 'b']);
    expect(f.get.mock.calls[0][0].format).toBe('minimal');
  });
  it('Gmail not connected: nothing is checked', async () => {
    setGmailFactory(async () => null);
    const s = await replyStates(2, ['a'], { now });
    expect(s.get('a')).toBeUndefined();
  });
  it('the Sent list fails: nothing is checked', async () => {
    const f = fakeGmail([], {}, { listFails: true });
    setGmailFactory(async () => f.gmail);
    const s = await replyStates(2, ['a'], { now });
    expect(s.get('a')).toBeUndefined();
  });
  it('a thread too slow to read stays unchecked; the rest are answered', async () => {
    const f = fakeGmail(['a', 'slow'], { a: [IN('2026-11-06T05:00:00Z'), SENT('2026-11-06T06:00:00Z')], slow: [] }, { slowThread: 'slow' });
    setGmailFactory(async () => f.gmail);
    const s = await replyStates(2, ['a', 'slow'], { now, timeoutMs: 50 });
    expect(s.get('a')?.reply_checked).toBe(true);
    expect(s.get('slow')).toBeUndefined();
  });
});

describe('replyStateOf (one email, always fresh)', () => {
  it('reads the thread directly, with no Sent list', async () => {
    const f = fakeGmail([], { a: [IN('2026-11-06T05:00:00Z'), SENT('2026-11-06T06:00:00Z')] });
    setGmailFactory(async () => f.gmail);
    expect(await replyStateOf(2, 'a')).toEqual({ replied_at: '2026-11-06T06:00:00.000Z', reply_checked: true });
    expect(f.list).not.toHaveBeenCalled();
  });
  it('no Gmail thread id: not checked', async () => {
    expect(await replyStateOf(2, null)).toEqual({ replied_at: null, reply_checked: false });
  });
  it('a Gmail error: not checked, never "not answered"', async () => {
    setGmailFactory(async () => ({ users: { messages: { list: vi.fn() }, threads: { get: async () => { throw new Error('x'); } } } }) as any);
    expect(await replyStateOf(2, 'a')).toEqual({ replied_at: null, reply_checked: false });
  });
});

describe('the list of emails to answer', () => {
  const item = (id: string, threadId: string | null) => ({ feedEventId: id, itemType: 'email', threadId, from: 'x', subject: id, receivedAt: '2026-11-06T05:00:00Z' });
  it('leaves answered threads out and says for each of the rest whether it was checked', async () => {
    const shared = [item('answered', 'a'), item('open', 'b'), item('outlook', null), { ...item('wa', null), itemType: 'whatsapp' }];
    partition.mockResolvedValue({ myAttention: shared });
    const f = fakeGmail(['a'], { a: [IN('2026-11-06T05:00:00Z'), SENT('2026-11-06T06:00:00Z')] });
    setGmailFactory(async () => f.gmail);
    const r: any = await loadAttentionEmails('T', 2, 1000);
    expect(r.items.map((i: any) => i.feedEventId)).toEqual(['open', 'outlook']);
    expect(r.items[0].reply).toEqual({ replied_at: null, reply_checked: true });
    expect(r.items[1].reply).toEqual({ replied_at: null, reply_checked: false });
    // The triage cache's own objects are left untouched.
    expect((shared[1] as any).reply).toBeUndefined();
  });
  it('with Gmail unreachable nothing is dropped, and every email says it was not checked', async () => {
    partition.mockResolvedValue({ myAttention: [item('one', 'a')] });
    setGmailFactory(async () => null);
    const r: any = await loadAttentionEmails('T', 2, 1000);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].reply.reply_checked).toBe(false);
  });
});
