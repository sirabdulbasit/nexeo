/**
 * T46 email.search and two-way threads (founder 25 Nov 2026; Suzi-Builder AGREE 13:06). Pinned:
 *  BOX     inbox → in:inbox, sent → in:sent, all (default) → every box but drafts.
 *  ARGS    from/to/since become Gmail terms; bad box or date is refused; operators can't be injected via from/to.
 *  DIR     a SENT-labelled message is "out", anything else "in"; limit defaults to 20, never above 50.
 *  THREAD  thread messages carry direction, oldest first.
 */
import { describe, it, expect, vi } from 'vitest';

const calls = vi.hoisted(() => ({ search: [] as Array<[string, number]> }));
vi.mock('../src/services/gmailService', () => ({
  searchEmails: async (_u: number, q: string, n: number) => {
    calls.search.push([q, n]);
    return { emails: [
      { id: 'm1', threadId: 't1', from: 'Ali <ali@x.com>', to: 'me@x.com', cc: '', subject: 'Vision Metrics', snippet: 's1', date: 'd1', labels: ['INBOX'] },
      { id: 'm2', threadId: 't1', from: 'me@x.com', to: 'ali@x.com', cc: '', subject: 'Re: Vision Metrics', snippet: 's2', date: 'd2', labels: ['SENT'] },
    ] };
  },
  fetchEmailThreadContext: async () => [
    { from: 'them', fromName: 'Ali', to: 'me@x.com', cc: '', subject: 'VM', text: 'question', timestamp: 1 },
    { from: 'me', fromName: 'Basit', to: 'ali@x.com', cc: '', subject: 'Re: VM', text: 'answer', timestamp: 2 },
  ],
}));

import { searchQuery, emailSearch, threadMessages, directionOf } from '../src/services/suzi/suziEmailSearch';

describe('T46 email.search', () => {
  it('BOX: inbox, sent, and all by default', () => {
    expect(searchQuery({ box: 'inbox' })).toEqual({ q: 'in:inbox' });
    expect(searchQuery({ box: 'sent' })).toEqual({ q: 'in:sent' });
    expect(searchQuery({})).toEqual({ q: '-in:drafts' });
  });
  it('ARGS: from, to, since and q; refuses bad box or date; no operator injection', () => {
    expect(searchQuery({ box: 'sent', to: 'ali@x.com', since: '2026-11-01', q: 'Vision Metrics' })).toEqual({ q: 'in:sent to:(ali@x.com) after:2026/11/01 Vision Metrics' });
    expect(searchQuery({ box: 'spam' })).toEqual({ error: 'box is inbox, sent or all' });
    expect(searchQuery({ since: '1 Nov' })).toEqual({ error: 'since is YYYY-MM-DD' });
    expect(searchQuery({ from: 'ali) OR in:(spam' })).toEqual({ q: '-in:drafts from:(ali OR inspam)' });
  });
  it('DIR: direction from the SENT label; limit 20 by default, capped at 50', async () => {
    calls.search = [];
    const r: any = await emailSearch(2, { q: 'VM' });
    expect(r.ok).toBe(true);
    expect(r.item.emails.map((e: any) => e.direction)).toEqual(['in', 'out']);
    expect(r.item.emails[1]).toMatchObject({ thread_id: 't1', email_id: 'm2', subject: 'Re: Vision Metrics' });
    await emailSearch(2, { limit: 500 });
    expect(calls.search.map((c) => c[1])).toEqual([20, 50]);
    expect(directionOf(undefined)).toBe('in');
  });
  it('THREAD: both sides with direction, oldest first', async () => {
    const m = await threadMessages(2, 't1');
    expect(m.map((x) => [x.direction, x.text])).toEqual([['in', 'question'], ['out', 'answer']]);
    expect(await threadMessages(2, null)).toEqual([]);
  });
});
