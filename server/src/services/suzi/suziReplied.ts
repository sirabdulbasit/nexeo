/**
 * Link T23 (both AGREE, 6 Nov 2026): has the user already answered this email?
 *
 * Asked of Gmail itself, by its SENT label, so a reply counts whichever address of the mailbox
 * and whichever app sent it (phone, web, Suzi). The older check (gmailReadStateSyncJob) learns of
 * a reply minutes late and only from the connected address; this one is live.
 *
 * A thread counts as answered when the user's latest sent message on it is newer than the latest
 * message anyone else sent there. Someone writing after him puts it back. Reads only: no AI call,
 * no cost beyond Google's free quota.
 *
 *   reply_checked: false  — Gmail couldn't be asked (not connected, an error, too slow, or the
 *                           email isn't a Gmail thread). Suzi then says she can't tell.
 *   replied_at            — ISO time of his latest sent message on the thread, or null.
 */
import { getAuthenticatedClient } from '../integrationService';

export interface ReplyState { replied_at: string | null; reply_checked: boolean }

type ThreadMessage = { labelIds?: string[] | null; internalDate?: string | null };
export interface GmailLike {
  users: {
    messages: { list(p: { userId: string; q: string; maxResults: number; pageToken?: string }): Promise<{ data: { messages?: Array<{ threadId?: string | null }>; nextPageToken?: string | null } }> };
    threads: { get(p: { userId: string; id: string; format: string }): Promise<{ data: { messages?: ThreadMessage[] } }> };
  };
}

export const UNCHECKED: ReplyState = { replied_at: null, reply_checked: false };
/** "Emails to answer" goes back 7 days; a day more so a reply at the edge isn't missed. */
export const SENT_WINDOW = 'newer_than:8d';
export const REPLY_CHECK_TIMEOUT_MS = 4_000;
const SENT_PAGES = 2;
const CACHE_MS = 30_000;

let gmailFor = async (userId: number): Promise<GmailLike | null> => {
  const { client, error } = await getAuthenticatedClient(userId);
  if (!client || error) return null;
  const { google } = await import('googleapis');
  return google.gmail({ version: 'v1', auth: client }) as unknown as GmailLike;
};
/** Tests only. */
export function setGmailFactory(f: (userId: number) => Promise<GmailLike | null>): void { gmailFor = f; sentCache.clear(); }

/** His latest sent time on the thread, when it is newer than everyone else's latest. Drafts don't count. */
export function repliedAt(messages: ThreadMessage[]): string | null {
  let sent = 0; let other = 0;
  for (const m of messages) {
    const t = Number(m.internalDate);
    if (!Number.isFinite(t) || t <= 0) continue;
    const labels = m.labelIds ?? [];
    if (labels.includes('DRAFT')) continue;
    if (labels.includes('SENT')) sent = Math.max(sent, t); else other = Math.max(other, t);
  }
  return sent > 0 && sent > other ? new Date(sent).toISOString() : null;
}

async function threadState(gmail: GmailLike, threadId: string): Promise<ReplyState> {
  const t = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'minimal' });
  return { replied_at: repliedAt(t.data.messages ?? []), reply_checked: true };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => { const t = setTimeout(() => r(null), ms); (t as any).unref?.(); })]);
}

/** One email, always fresh: `GET /v1/email` and `email.draft` must count a reply sent a minute ago. */
export async function replyStateOf(userId: number, threadId: string | null | undefined, timeoutMs = REPLY_CHECK_TIMEOUT_MS): Promise<ReplyState> {
  if (!threadId) return UNCHECKED;
  try {
    const gmail = await gmailFor(userId);
    if (!gmail) return UNCHECKED;
    return (await withTimeout(threadState(gmail, threadId), timeoutMs)) ?? UNCHECKED;
  } catch {
    return UNCHECKED;
  }
}

/** Threads he has sent on lately. The brief and the pack ask within seconds of each other, so it's kept 30 s. */
const sentCache = new Map<number, { at: number; threads: Promise<Set<string>> }>();
async function sentThreads(gmail: GmailLike, userId: number, now: number): Promise<Set<string>> {
  const hit = sentCache.get(userId);
  if (hit && now - hit.at < CACHE_MS) return hit.threads;
  const threads = (async () => {
    const out = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; page < SENT_PAGES; page++) {
      const r = await gmail.users.messages.list({ userId: 'me', q: `in:sent ${SENT_WINDOW}`, maxResults: 500, ...(pageToken ? { pageToken } : {}) });
      for (const m of r.data.messages ?? []) if (m.threadId) out.add(m.threadId);
      pageToken = r.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
    return out;
  })();
  sentCache.set(userId, { at: now, threads });
  threads.catch(() => { if (sentCache.get(userId)?.threads === threads) sentCache.delete(userId); });
  return threads;
}

/**
 * Many emails at once, for the list of emails to answer. One list of his recent Sent, then a light
 * thread read only where he has sent something. Whatever isn't known in time stays unchecked.
 */
export async function replyStates(userId: number, threadIds: Array<string | null | undefined>, opts: { timeoutMs?: number; now?: number } = {}): Promise<Map<string, ReplyState>> {
  const out = new Map<string, ReplyState>();
  const ids = [...new Set(threadIds.filter((t): t is string => typeof t === 'string' && t.length > 0))];
  if (!ids.length) return out;
  const run = (async () => {
    const gmail = await gmailFor(userId);
    if (!gmail) return;
    const sent = await sentThreads(gmail, userId, opts.now ?? Date.now());
    for (const id of ids) if (!sent.has(id)) out.set(id, { replied_at: null, reply_checked: true });
    await Promise.all(ids.filter((id) => sent.has(id)).map(async (id) => {
      try { out.set(id, await threadState(gmail, id)); } catch { /* stays unchecked */ }
    }));
  })().catch(() => {});
  await withTimeout(run, opts.timeoutMs ?? REPLY_CHECK_TIMEOUT_MS);
  // A snapshot: anything still running after the timeout can't change what was answered.
  return new Map(out);
}
