/**
 * T46 (founder 25 Nov 2026: "Suzi/Nexeo should have same access of Inbox and Sent, because these 2 combine build the
 * complete trail of information"). Agreed with Suzi-Builder 25 Nov 13:06.
 *
 *  email.search {q?, box: inbox | sent | all (default all), from?, to?, since? (YYYY-MM-DD), limit? (default 20, max 50)}
 *    → {emails: [{thread_id, email_id, from, to, cc, subject, snippet, date, direction: in | out}], query}
 *  GET /v1/email (readThread) adds messages[]: every message in the thread, oldest first, each with direction.
 *
 * Read live from his Gmail, so Sent and Inbox are searched alike and nothing depends on what Nexeo stored.
 */
type Args = Record<string, unknown>;
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** An address or a plain name for Gmail's from:/to:, never a way to add search operators. */
const term = (v: string) => v.replace(/[^\p{L}\p{N}@._+\- ]/gu, '').trim().slice(0, 120);

export type Direction = 'in' | 'out';
export const directionOf = (labels: string[] | undefined): Direction => ((labels ?? []).includes('SENT') ? 'out' : 'in');

/** Gmail search string for the agreed arguments. Drafts are never results; Gmail leaves out spam and trash itself. */
export function searchQuery(a: Args): { q: string } | { error: string } {
  const box = text(a.box) || 'all';
  if (!['inbox', 'sent', 'all'].includes(box)) return { error: 'box is inbox, sent or all' };
  const since = text(a.since);
  if (since && (!DAY.test(since) || isNaN(Date.parse(`${since}T00:00:00Z`)))) return { error: 'since is YYYY-MM-DD' };
  const parts = [
    box === 'inbox' ? 'in:inbox' : box === 'sent' ? 'in:sent' : '-in:drafts',
    term(text(a.from)) ? `from:(${term(text(a.from))})` : '',
    term(text(a.to)) ? `to:(${term(text(a.to))})` : '',
    since ? `after:${since.replace(/-/g, '/')}` : '',
    text(a.q).replace(/\s+/g, ' ').slice(0, 300),
  ];
  return { q: parts.filter(Boolean).join(' ') };
}

export async function emailSearch(userId: number, a: Args): Promise<{ ok: true; item: unknown } | { ok: false; error: string; detail?: string }> {
  const built = searchQuery(a);
  if ('error' in built) return { ok: false, error: 'bad_args', detail: built.error };
  const n = Number(a.limit);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : 20;
  const { searchEmails } = await import('../gmailService');
  const r = await searchEmails(userId, built.q, limit);
  if (r.error && !r.emails?.length) return { ok: false, error: 'gmail_unavailable', detail: 'his Gmail could not be searched' };
  return {
    ok: true,
    item: {
      query: built.q,
      emails: (r.emails ?? []).map((e) => ({
        thread_id: e.threadId, email_id: e.id, from: e.from, to: e.to, cc: e.cc || null, subject: e.subject,
        snippet: e.snippet, date: e.date, direction: directionOf(e.labels),
      })),
    },
  };
}

/** Every message of a Gmail thread, oldest first, with direction. Empty when the thread can't be read. */
export async function threadMessages(userId: number, gmailThreadId: string | null): Promise<Array<{ direction: Direction; from: string; to: string; cc: string | null; subject: string; date: string; text: string }>> {
  if (!gmailThreadId) return [];
  const { fetchEmailThreadContext } = await import('../gmailService');
  const msgs = await fetchEmailThreadContext(userId, gmailThreadId).catch(() => []);
  return msgs.map((m) => ({
    direction: m.from === 'me' ? 'out' as const : 'in' as const,
    from: m.fromName ?? '', to: m.to ?? '', cc: m.cc || null, subject: m.subject,
    date: m.timestamp ? new Date(m.timestamp).toISOString() : '', text: m.text,
  }));
}
